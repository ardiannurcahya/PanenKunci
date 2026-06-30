const fs = require('fs');
const path = require('path');

const LOCK_MAX_RETRIES = 10;
const LOCK_RETRY_MS = 200;
const LOCK_STALE_MS = 30000;

function acquireLock(lockPath) {
  for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch (_) {}
        const wait = LOCK_RETRY_MS + Math.floor(Math.random() * 100);
        const start = Date.now();
        while (Date.now() - start < wait) {}
        continue;
      }
      throw e;
    }
  }
  try { fs.unlinkSync(lockPath); } catch (_) {}
  fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  return true;
}

function releaseLock(lockPath) {
  try { fs.unlinkSync(lockPath); } catch (_) {}
}

function saveToCsv(outputFile, email, password, apiKey) {
  const lockPath = outputFile + '.lock';
  acquireLock(lockPath);
  try {
    const csvHeaders = 'email,password,apikey';
    const csvRow = [email, password, apiKey || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');

    if (!fs.existsSync(outputFile)) {
      fs.writeFileSync(outputFile, csvHeaders + '\n' + csvRow + '\n', 'utf8');
    } else {
      let content = fs.readFileSync(outputFile, 'utf8');
      if (!content.endsWith('\n')) {
        content += '\n';
        fs.writeFileSync(outputFile, content, 'utf8');
      }
      fs.appendFileSync(outputFile, csvRow + '\n', 'utf8');
    }
    console.log(`  Saved to: ${outputFile}`);
  } finally {
    releaseLock(lockPath);
  }
}

function updateCsvApiKey(outputFile, email, apiKey) {
  const lockPath = outputFile + '.lock';
  acquireLock(lockPath);
  try {
    if (!fs.existsSync(outputFile)) return;
    const content = fs.readFileSync(outputFile, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes(email)) continue;
      const matches = lines[i].match(/"[^"]*"/g);
      if (matches && matches.length >= 3) {
        matches[2] = `"${String(apiKey || 'NOT_FOUND').replace(/"/g, '""')}"`;
        lines[i] = matches.join(',');
      }
      break;
    }
    let result = lines.join('\n');
    if (!result.endsWith('\n')) result += '\n';
    fs.writeFileSync(outputFile, result, 'utf8');
    console.log(`  Updated CSV with API key: ${apiKey || 'NOT_FOUND'}`);
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = { saveToCsv, updateCsvApiKey };
