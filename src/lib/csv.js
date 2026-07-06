const fs = require('fs');
const path = require('path');
const { redact } = require('./helpers');

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

function ensureOutputDir(outputFile) {
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let inQuotes = false;
  const input = String(line).replace(/\r$/, '');

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { value += '"'; i++; }
        else inQuotes = false;
      } else {
        value += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      values.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  values.push(value);
  return values;
}

function stringifyCsvRow(values) {
  return values.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
}

function saveToCsv(outputFile, email, password, apiKey) {
  ensureOutputDir(outputFile);
  const lockPath = outputFile + '.lock';
  acquireLock(lockPath);
  try {
    const csvHeaders = 'email,password,apikey';
    const csvRow = stringifyCsvRow([email, password, apiKey || '']);

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
  if (!fs.existsSync(outputFile)) return;
  ensureOutputDir(outputFile);
  const lockPath = outputFile + '.lock';
  acquireLock(lockPath);
  try {
    const content = fs.readFileSync(outputFile, 'utf8');
    const lines = content.split('\n');
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCsvLine(lines[i]);
      if (cols[0] !== email) continue;
      cols[2] = apiKey || 'NOT_FOUND';
      lines[i] = stringifyCsvRow(cols);
      break;
    }
    let result = lines.join('\n');
    if (!result.endsWith('\n')) result += '\n';
    fs.writeFileSync(outputFile, result, 'utf8');
    console.log(`  Updated CSV with API key: ${apiKey ? redact(apiKey) : 'NOT_FOUND'}`);
  } finally {
    releaseLock(lockPath);
  }
}

module.exports = { saveToCsv, updateCsvApiKey, parseCsvLine, stringifyCsvRow, ensureOutputDir };
