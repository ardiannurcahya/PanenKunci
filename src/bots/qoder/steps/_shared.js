// Shared helpers used across all registration steps.
// Each step receives a `ctx` object with the common dependencies pre-bound.

const fs = require('fs');
const path = require('path');
const {
  sleep,
  rand,
  fillHuman,
  humanMouseMove,
  humanScroll,
  clickFirst,
  handleCookies: handleCookiesBase,
} = require('../../../lib/helpers');

const helpers = require('../../../lib/helpers');

// Cookies for Qoder flow use a 1000ms initial wait.
const handleCookies = (page) => handleCookiesBase(page, 1000);

// Screenshots are disabled in the current flow (kept as no-op for parity).
async function snap() {}

// Append a registration result row to the CSV output.
function saveResult(outputFile, data) {
  const csvHeaders = 'timestamp,platform,first_name,last_name,email,password,status';
  const csvRow = [
    new Date().toISOString(),
    'qoder',
    data.firstName,
    data.lastName,
    data.email,
    data.password,
    data.status || 'registered',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

  const exists = fs.existsSync(outputFile);
  if (!exists) {
    fs.writeFileSync(outputFile, csvHeaders + '\n', 'utf8');
  }
  fs.appendFileSync(outputFile, csvRow + '\n', 'utf8');
  console.log(`  Saved to: ${outputFile}`);
}

module.exports = {
  fs,
  path,
  sleep,
  rand,
  fillHuman,
  humanMouseMove,
  humanScroll,
  clickFirst,
  handleCookies,
  snap,
  saveResult,
  helpers,
};
