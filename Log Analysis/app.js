require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');

const { initCognito, authMiddleware, requireRole } = require('./auth');
const { analyzeLogFile } = require('./analyzer');
const store = require('./store');

const app = express();
app.use(cors());
app.use(express.json());


initCognito({ userPoolId: process.env.COGNITO_USERPOOL_ID }).catch(console.error);


// Keep multer so legacy /logs/upload still works if you want:
const upload = multer({ dest: path.join('/tmp', 'uploads') });

// --- Pre-signed upload (Additional: S3 Pre-signed URLs) ---
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-southeast-2' });

app.get('/logs/upload-url', authMiddleware, async (_req, res) => {
  const BUCKET = process.env.S3_BUCKET;
  const logId = require('uuid').v4();
  const key = `logs/${logId}.log`;
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 3600 });
  res.json({ logId, key, url });
});

// After client PUTs to S3, register metadata + compute SHA
app.post('/logs/register-upload', authMiddleware, async (req, res) => {
  const { logId, key, filename, size } = req.body || {};
  if (!logId || !key || !filename) return res.status(400).json({ message: 'Missing fields' });



  //call saveLogFile-like logic: we didn't upload file here; instead write a Logs record now:
  const logMeta = await store.getLog(logId);
  if (!logMeta) {
    // create a Logs record referencing S3 key (sha computed later by analyzer or a background step)
    await require('@aws-sdk/lib-dynamodb').DynamoDBDocumentClient.from(
      new (require('@aws-sdk/client-dynamodb').DynamoDBClient)({ region: process.env.AWS_REGION || 'ap-southeast-2' })
    ).send(new (require('@aws-sdk/lib-dynamodb').PutCommand)({
      TableName: process.env.DDB_LOGS || 'Logs',
      Item: {
        logId, owner: req.user.sub, filename, bytes: size || null, s3Key: key, uploadedAt: new Date().toISOString()
      }
    }));
  }
  res.json({ ok: true, logId });
});

// --- Legacy upload still works  ---
app.post('/logs/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const logId = await store.saveLogFile(req.user.sub, req.file);
    res.json({ logId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// --- Analyze log ---
app.post('/logs/:logId/analyze', authMiddleware, async (req, res) => {
  try {
    const { logId } = req.params;
    const log = await store.getLog(logId);
    if (!log) return res.status(404).json({ message: 'Log not found' });

    const job = await store.createJob(logId);
    (async () => {
      try {
        const localPath = await store.ensureLocalLogCopy(logId);  // NEW: download from S3
        await analyzeLogFile(localPath, job.jobId, store);
      } catch (e) {
        await store.failJob(job.jobId, e.message);
        return;
      }
    })();

    res.json({ jobId: job.jobId, status: 'queued' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Analyze failed' });
  }
});

// --- Get summary ---
app.get('/logs/:logId/summary', authMiddleware, async (req, res) => {
  const s = await store.getSummary(req.params.logId);
  if (!s) return res.status(404).json({ message: 'No summary for this log' });
  res.json(s);
});

// --- Get events ---
app.get('/logs/:logId/events', authMiddleware, async (req, res) => {
  const { page = 1, limit = 100, ip, status, from, to, sort } = req.query;
  try {
    const result = await store.queryEvents(req.params.logId, {
      page: Number(page), limit: Number(limit), ip: ip || null,
      status: status ? Number(status) : null, timeFrom: from || null, timeTo: to || null, sort: sort || 'eventTs'
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error reading events' });
  }
});

// --- Delete log ---
app.delete('/logs/:logId', authMiddleware, requireRole('admin'), async (req, res) => {
  try {
    await store.deleteLog(req.params.logId);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Delete failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
