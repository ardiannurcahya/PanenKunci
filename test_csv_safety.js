const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { saveToCsv, updateCsvApiKey, parseCsvLine } = require('./src/lib/csv');
const { appendApiKeyToCsv } = require('./src/bots/cloudflare/get-api-key');
const { redact } = require('./src/lib/helpers');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'panenkunci-csv-'));

const csv = path.join(tmp, 'nested', 'fireworks.csv');
saveToCsv(csv, 'bob@example.com', 'pw1', '');
saveToCsv(csv, 'ob@example.com', 'pw2', '');
updateCsvApiKey(csv, 'ob@example.com', 'KEY2');

let rows = fs.readFileSync(csv, 'utf8').trim().split('\n').map(parseCsvLine);
assert.strictEqual(rows[1][0], 'bob@example.com');
assert.strictEqual(rows[1][2], '');
assert.strictEqual(rows[2][0], 'ob@example.com');
assert.strictEqual(rows[2][2], 'KEY2');

const cloudflareCsv = path.join(tmp, 'cloudflare.csv');
fs.writeFileSync(cloudflareCsv, [
  'email,password,account_id,status',
  '"alice@example.com","pw","acct1","verified"',
  '"ice@example.com","pw","acct2","verified"',
  '',
].join('\n'), 'utf8');

appendApiKeyToCsv(cloudflareCsv, 'ice@example.com', 'TOKEN1');
appendApiKeyToCsv(cloudflareCsv, 'ice@example.com', 'TOKEN2');
rows = fs.readFileSync(cloudflareCsv, 'utf8').trim().split('\n').map(parseCsvLine);
assert.deepStrictEqual(rows[0], ['email', 'password', 'account_id', 'status', 'api_key']);
assert.deepStrictEqual(rows[1], ['alice@example.com', 'pw', 'acct1', 'verified']);
assert.deepStrictEqual(rows[2], ['ice@example.com', 'pw', 'acct2', 'verified', 'TOKEN2']);
assert.strictEqual(rows[2].length, 5);

assert.strictEqual(redact('secret-token'), 'secr...oken');
assert.strictEqual(redact('short'), '*****');

fs.rmSync(tmp, { recursive: true, force: true });
