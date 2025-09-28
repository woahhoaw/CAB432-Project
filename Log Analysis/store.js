const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand,
  DeleteCommand, BatchWriteCommand, ScanCommand
} = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const s3 = new S3Client({ region: REGION });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const ssm = new SSMClient({ region: REGION });

// Resolve config from env or Parameter Store (env wins)
async function cfg() {
  async function readParam(name, fallback) {
    try {
      const out = await ssm.send(new GetParameterCommand({ Name: name }));
      return out.Parameter?.Value || fallback;
    } catch {
      return fallback;
    }
  }
  return {
    BUCKET: process.env.S3_BUCKET || await readParam('/loganalyzer/S3_BUCKET', ''),
    DDB_LOGS: process.env.DDB_LOGS || await readParam('/loganalyzer/DDB_LOGS', 'Logs'),
    DDB_SUMMARIES: process.env.DDB_SUMMARIES || await readParam('/loganalyzer/DDB_SUMMARIES', 'LogSummaries'),
    DDB_EVENTS: process.env.DDB_EVENTS || await readParam('/loganalyzer/DDB_EVENTS', 'LogEvents'),
    DDB_JOBS: process.env.DDB_JOBS || await readParam('/loganalyzer/DDB_JOBS', 'Jobs'),
  };
}

/* ---------------- Logs ---------------- */

async function saveLogFile(owner, multerFile) {
  const { BUCKET, DDB_LOGS } = await cfg();
  const id = uuidv4();
  const key = `logs/${id}.log`;

  const sha256 = await fileSha256(multerFile.path);

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: fs.createReadStream(multerFile.path)
  }));

  await ddb.send(new PutCommand({
    TableName: DDB_LOGS,
    Item: {
      logId: id,
      owner,
      filename: multerFile.originalname,
      bytes: multerFile.size,
      sha256,
      s3Key: key,
      uploadedAt: new Date().toISOString()
    }
  }));

  return id;
}

// Called by /logs/register-upload after browser PUT to S3
async function registerUploadedMetadata(owner, { logId, key, filename, size }) {
  const { DDB_LOGS } = await cfg();

  // Upsert simple metadata row; analyzer can fill details later
  await ddb.send(new PutCommand({
    TableName: DDB_LOGS,
    Item: {
      logId,
      owner,
      filename,
      bytes: size || null,
      s3Key: key,
      uploadedAt: new Date().toISOString()
    }
  }));

  return logId;
}

async function getLog(logId) {
  const { DDB_LOGS } = await cfg();
  const res = await ddb.send(new GetCommand({ TableName: DDB_LOGS, Key: { logId } }));
  return res.Item || null;
}

// List logs (optionally filter by owner)
async function listLogs(owner = null, limit = 100) {
  const { DDB_LOGS } = await cfg();
  const params = { TableName: DDB_LOGS, Limit: limit };
  if (owner) {
    params.FilterExpression = '#o = :owner';
    params.ExpressionAttributeNames = { '#o': 'owner' };
    params.ExpressionAttributeValues = { ':owner': owner };
  }
  const res = await ddb.send(new ScanCommand(params));
  return res.Items || [];
}

// Download from S3 to /tmp for analyzer
async function ensureLocalLogCopy(logId) {
  const { BUCKET } = await cfg();
  const m = await getLog(logId);
  if (!m) return null;
  const outDir = '/tmp/logs';
  fs.mkdirSync(outDir, { recursive: true });
  const dest = path.join(outDir, `${logId}.log`);

  const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: m.s3Key }));
  await streamToFile(obj.Body, dest);
  return dest;
}

/* ---------------- Jobs ---------------- */

async function createJob(logId) {
  const { DDB_JOBS } = await cfg();
  const id = uuidv4();
  const job = { jobId: id, logId, status: 'queued', createdAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: DDB_JOBS, Item: job }));
  return job;
}

async function startJob(jobId) {
  const { DDB_JOBS } = await cfg();
  await ddb.send(new PutCommand({
    TableName: DDB_JOBS,
    Item: { jobId, status: 'running', startedAt: new Date().toISOString() },
    ConditionExpression: 'attribute_exists(jobId)'
  }));
}

async function finishJob(jobId) {
  const { DDB_JOBS } = await cfg();
  await ddb.send(new PutCommand({
    TableName: DDB_JOBS,
    Item: { jobId, status: 'done', finishedAt: new Date().toISOString() },
    ConditionExpression: 'attribute_exists(jobId)'
  }));
}

async function failJob(jobId, message) {
  const { DDB_JOBS } = await cfg();
  await ddb.send(new PutCommand({
    TableName: DDB_JOBS,
    Item: { jobId, status: 'error', error: message, finishedAt: new Date().toISOString() }
  }));
}

async function findJobsByLogId(logId, limit = 5) {
  const { DDB_JOBS } = await cfg();
  const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
  const res = await ddb.send(new ScanCommand({
    TableName: DDB_JOBS,
    FilterExpression: '#lid = :lid',
    ExpressionAttributeNames: { '#lid': 'logId' },
    ExpressionAttributeValues: { ':lid': logId },
    Limit: limit
  }));
  // latest first (by createdAt desc if present)
  return (res.Items || []).sort((a,b) => (b.createdAt||'').localeCompare(a.createdAt||''));
}

async function getJob(jobId) {
  const { DDB_JOBS } = await cfg();
  const { GetCommand } = require('@aws-sdk/lib-dynamodb');
  const res = await ddb.send(new GetCommand({ TableName: DDB_JOBS, Key: { jobId } }));
  return res.Item || null;
}

/* --------- Events & Summaries --------- */

async function insertEvents(jobId, events) {
  const { DDB_JOBS, DDB_EVENTS } = await cfg();
  const jres = await ddb.send(new GetCommand({ TableName: DDB_JOBS, Key: { jobId } }));
  if (!jres.Item) throw new Error('Job not found');
  const logId = jres.Item.logId;

  // Batch write (25 at a time). Ensure each event has ISO ts at e.ts
  const chunks = chunk(events.map(e => ({
    PutRequest: {
      Item: {
        logId,
        eventTs: e.ts, // ISO timestamp as RANGE key
        ...e
      }
    }
  })), 25);

  for (const batch of chunks) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [DDB_EVENTS]: batch } }));
  }
}

async function saveSummary(jobId, summary) {
  const { DDB_JOBS, DDB_SUMMARIES } = await cfg();
  const jres = await ddb.send(new GetCommand({ TableName: DDB_JOBS, Key: { jobId } }));
  if (!jres.Item) throw new Error('Job not found');
  const logId = jres.Item.logId;

  await ddb.send(new PutCommand({
    TableName: DDB_SUMMARIES,
    Item: { logId, ...summary }
  }));
}

async function getSummary(logId) {
  const { DDB_SUMMARIES } = await cfg();
  const res = await ddb.send(new GetCommand({ TableName: DDB_SUMMARIES, Key: { logId } }));
  return res.Item || null;
}

async function queryEvents(logId, opts) {
  const { DDB_EVENTS } = await cfg();
  const { page = 1, limit = 100, ip = null, status = null, timeFrom = null, timeTo = null, sort = 'eventTs' } = opts;

  const KeyConditionExpression = ['logId = :id'];
  const ExpressionAttributeValues = { ':id': logId };
  if (timeFrom && timeTo) {
    KeyConditionExpression.push('eventTs BETWEEN :from AND :to');
    ExpressionAttributeValues[':from'] = timeFrom;
    ExpressionAttributeValues[':to'] = timeTo;
  } else if (timeFrom) {
    KeyConditionExpression.push('eventTs >= :from');
    ExpressionAttributeValues[':from'] = timeFrom;
  } else if (timeTo) {
    KeyConditionExpression.push('eventTs <= :to');
    ExpressionAttributeValues[':to'] = timeTo;
  }

  const need = page * limit;
  let items = [], lastKey = undefined;

  while (items.length < need) {
    const res = await ddb.send(new QueryCommand({
      TableName: DDB_EVENTS,
      KeyConditionExpression: KeyConditionExpression.join(' AND '),
      ExpressionAttributeValues,
      ScanIndexForward: !String(sort).startsWith('-'), // asc unless sort starts with '-'
      ExclusiveStartKey: lastKey
    }));
    items = items.concat(res.Items || []);
    lastKey = res.LastEvaluatedKey;
    if (!lastKey) break;
  }

  if (ip) items = items.filter(e => e.ip === ip);
  if (status !== null) items = items.filter(e => e.status === status);

  const total = items.length;
  const slice = items.slice((page - 1) * limit, (page - 1) * limit + limit);
  return { page, limit, total, items: slice };
}

async function deleteLog(logId) {
  const { BUCKET, DDB_LOGS, DDB_SUMMARIES, DDB_EVENTS } = await cfg();

  const m = await getLog(logId);
  if (m) {
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: m.s3Key }));
    await ddb.send(new DeleteCommand({ TableName: DDB_LOGS, Key: { logId } }));
  }
  await ddb.send(new DeleteCommand({ TableName: DDB_SUMMARIES, Key: { logId } }));

  // delete all events for this log
  const res = await ddb.send(new QueryCommand({
    TableName: DDB_EVENTS,
    KeyConditionExpression: 'logId = :id',
    ExpressionAttributeValues: { ':id': logId }
  }));
  const chunks = chunk((res.Items || []).map(it => ({
    DeleteRequest: { Key: { logId, eventTs: it.eventTs } }
  })), 25);
  for (const batch of chunks) {
    await ddb.send(new BatchWriteCommand({ RequestItems: { [DDB_EVENTS]: batch } }));
  }
}

/* --------------- Helpers --------------- */

function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', d => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

function streamToFile(stream, dest) {
  return new Promise((resolve, reject) => {
    const w = fs.createWriteStream(dest);
    stream.pipe(w);
    w.on('finish', resolve);
    w.on('error', reject);
  });
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

module.exports = {
  saveLogFile, getLog, ensureLocalLogCopy,
  createJob, startJob, finishJob, failJob,
  insertEvents, saveSummary, getSummary, queryEvents, deleteLog,
  listLogs, registerUploadedMetadata,
  findJobsByLogId, getJob           
};
