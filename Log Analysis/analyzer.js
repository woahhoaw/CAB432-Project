const fs = require('fs');
const crypto = require('crypto');
const readline = require('readline');

// quick regex to roughly parse Apache Common Log Format lines
// (not perfect but handles typical CLF entries)
const CLF = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) ([^"]+) (\S+)" (\d{3}) (\d+|-) "([^"]*)" "([^"]*)"$/;

async function analyzeLogFile(filePath, jobId, store) {
  // mark the job as started in the external store
  await store.startJob(jobId);

  // create a SHA256 hasher to hash the entire file contents
  const sha = crypto.createHash('sha256');

  // counters to track stats while reading
  const counters = {
    total: 0,             // total lines read
    statusCounts: {},     // map of status code -> count
    ipCounts: {},         // map of IP -> count
    pathCounts: {},       // map of URL path -> count
    perMinute: new Map(), // map minute bucket -> count
    eventsBatch: []       // buffer of parsed events for batch insert
  };

  // create a streaming readline interface for the log file
  const rl = readline.createInterface({ input: fs.createReadStream(filePath) });
  for await (const line of rl) {
    sha.update(line);      // update running file hash
    counters.total++;      // increment total line count

    // try to parse the log line with regex
    const m = CLF.exec(line);
    if (!m) continue; // skip if line doesn’t match

    // destructure fields from regex groups
    const [, ip, rawTs, method, path, proto, statusStr, bytesStr] = m;
    const status = Number(statusStr);
    const bytes = bytesStr === '-' ? 0 : Number(bytesStr);

    // increment status code count
    counters.statusCounts[statusStr] = (counters.statusCounts[statusStr] || 0) + 1;
    // increment IP count
    counters.ipCounts[ip] = (counters.ipCounts[ip] || 0) + 1;
    // increment path count
    counters.pathCounts[path] = (counters.pathCounts[path] || 0) + 1;

    // group events by minute (just split timestamp text up to hours+minutes)
    const tsMinute = rawTs.split(':').slice(0, 2).join(':');
    counters.perMinute.set(tsMinute, (counters.perMinute.get(tsMinute) || 0) + 1);

    // add parsed event to batch buffer
    counters.eventsBatch.push({
      ts: rawTs, ip, method, path, status, bytes
    });

    // once buffer reaches 1000 events, flush to store
    if (counters.eventsBatch.length >= 1000) {
      await store.insertEvents(jobId, counters.eventsBatch);
      counters.eventsBatch = [];
    }
  }

  // flush any remaining events in the buffer
  if (counters.eventsBatch.length > 0) {
    await store.insertEvents(jobId, counters.eventsBatch);
    counters.eventsBatch = [];
  }

  // finalize SHA256 digest of the whole file
  const digest = sha.digest('hex');

  // prepare summary object with all the stats we gathered
  const summary = {
    totalLines: counters.total,
    sha256: digest,
    uniqueIps: Object.keys(counters.ipCounts).length,
    countsByStatus: counters.statusCounts,
    topIps: topN(counters.ipCounts, 10),
    topPaths: topN(counters.pathCounts, 10),
    errorsOverTime: Array.from(counters.perMinute.entries())
      .map(([minute, count]) => ({ minute, count }))
  };

  // save summary and mark job as finished
  await store.saveSummary(jobId, summary);
  await store.finishJob(jobId);
}

// helper to grab the top N items from a frequency map
function topN(obj, n) {
  return Object.entries(obj)
    .sort((a,b)=>b[1]-a[1])
    .slice(0,n)
    .map(([key,count])=>({ key, count }));
}

module.exports = { analyzeLogFile };
