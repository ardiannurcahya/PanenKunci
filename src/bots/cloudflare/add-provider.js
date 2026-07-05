const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { loadEnv } = require('../../lib/env');
const { sleep, rand } = require('../../lib/helpers');

loadEnv();

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  siteUrl:  process.env.PLATFORM_9ROUTER_URL,
  loginPassword: process.env.PLATFORM_9ROUTER_PASSWORD,
  csvFile: path.join(__dirname, '../../../output/cloudflare.csv'),
  trackingFile: path.join(__dirname, '../../../output/cloudflare_provider.csv'),
  // Set ADD_PROVIDER_HEADLESS=false to watch it run
  headless: process.env.ADD_PROVIDER_HEADLESS !== 'false',
  fieldFillDelayMs: 80,
  saveWaitMs: 2500,
};

// ─── CSV parsing ──────────────────────────────────────────
// cloudflare.csv columns: email,password,account_id,status,api_key
// Only rows that actually have an api_key (5th field) are uploaded.
// Handles both unquoted (a,b,c) and quoted ("a","b","c") CSV rows, including
// quoted fields containing commas.
function parseCsvLine(line) {
  const vals = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        vals.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  vals.push(cur);
  return vals;
}

function loadRowsWithApiKeys(csvFile) {
  if (!fs.existsSync(csvFile)) {
    console.error(`CSV not found: ${csvFile}`);
    process.exit(1);
  }
  const content = fs.readFileSync(csvFile, 'utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('email,'));
  const rows = [];
  for (const line of lines) {
    const vals = parseCsvLine(line);
    const email = (vals[0] || '').trim();
    const accountId = (vals[2] || '').trim();
    const apiKey = (vals[4] || '').trim(); // 5th column (api_key)
    if (email && accountId && apiKey) {
      rows.push({ email, accountId, apiKey, name: email });
    }
  }
  return rows;
}

// ─── Upload tracking (anti-duplikat) ──────────────────────
// cloudflare_provider.csv columns: email,status,timestamp
// Re-runs skip emails already marked "uploaded".
function loadUploaded(trackingFile) {
  const uploaded = new Set();
  if (!fs.existsSync(trackingFile)) return uploaded;
  const content = fs.readFileSync(trackingFile, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith('email,')) continue;
    const vals = parseCsvLine(line);
    const email = (vals[0] || '').trim();
    const status = (vals[1] || '').trim();
    if (email && status === 'uploaded') uploaded.add(email);
  }
  return uploaded;
}

function markUploaded(trackingFile, email) {
  const lockPath = trackingFile + '.lock';
  for (let i = 0; i < 10; i++) {
    try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); break; } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 30000) { fs.unlinkSync(lockPath); continue; }
        } catch (_) {}
        const start = Date.now();
        while (Date.now() - start < 250) {}
        continue;
      }
      throw e;
    }
  }
  try {
    const headers = 'email,status,timestamp';
    const row = `"${email}","uploaded",${new Date().toISOString()}`;
    if (!fs.existsSync(trackingFile)) {
      fs.writeFileSync(trackingFile, headers + '\n' + row + '\n', 'utf8');
    } else {
      fs.appendFileSync(trackingFile, row + '\n', 'utf8');
    }
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
}

// ─── Helpers ──────────────────────────────────────────────
// Clear a field explicitly, then input the value (the form can retain the
// previous entry's values when "Add" is clicked a second time).
async function clearAndFill(page, locator, value) {
  await locator.click();
  await sleep(rand(CONFIG.fieldFillDelayMs, CONFIG.fieldFillDelayMs + 80));
  try { await locator.fill(''); } catch (_) {}
  await sleep(rand(60, 140));
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await sleep(rand(60, 140));
  await locator.fill(value);
  await sleep(rand(80, 200));
}

// Try a list of locators, return the first visible one (or the last fallback).
async function firstVisible(page, candidates) {
  for (const make of candidates) {
    try {
      const loc = make(page).first();
      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) return loc;
    } catch (_) {}
  }
  return candidates[candidates.length - 1](page).first();
}

// ─── Field finders (robust — the count "13" in the provider link changes) ──
async function findAddButton(page) {
  return firstVisible(page, [
    (p) => p.getByRole('button', { name: 'add Add', exact: true }),
    (p) => p.getByRole('button', { name: /^Add$/ }),
    (p) => p.locator('button:has-text("Add")'),
  ]);
}

async function findSaveButton(page) {
  return firstVisible(page, [
    (p) => p.getByRole('button', { name: 'Save', exact: true }),
    (p) => p.getByRole('button', { name: /Save/ }),
    (p) => p.locator('button:has-text("Save")'),
  ]);
}

async function findNameField(page) {
  return firstVisible(page, [
    (p) => p.getByRole('textbox', { name: 'Production Key', exact: true }),
    (p) => p.getByRole('textbox', { name: /Production Key/i }),
    (p) => p.locator('input[type="text"]'),
  ]);
}

async function findApiKeyField(page) {
  return firstVisible(page, [
    (p) => p.locator('input[type="password"]'),
    (p) => p.locator('input[autocomplete*="password" i]'),
  ]);
}

async function findAccountIdField(page) {
  return firstVisible(page, [
    (p) => p.getByRole('textbox', { name: 'abc123def456...', exact: true }),
    (p) => p.getByRole('textbox', { name: /abc123/i }),
    // 2nd visible text input (1st is "Production Key")
    (p) => p.locator('input[type="text"]').nth(1),
  ]);
}

// ─── Add one entry: Add → fill name/api_key/account_id → Save ──
async function addOneEntry(page, row, index, total) {
  const tag = `[${index + 1}/${total}]`;
  console.log(`${tag} Adding: name=${row.name}  account=${row.accountId.slice(0, 8)}...  key=${row.apiKey.slice(0, 8)}...`);

  // 1. Click "Add"
  const addBtn = await findAddButton(page);
  await addBtn.click();
  await sleep(rand(1000, 2000));

  // 2. Fill the three fields (clear first — they may hold the previous entry)
  const nameField = await findNameField(page);
  await clearAndFill(page, nameField, row.name);

  const apiKeyField = await findApiKeyField(page);
  await clearAndFill(page, apiKeyField, row.apiKey);

  const accountIdField = await findAccountIdField(page);
  await clearAndFill(page, accountIdField, row.accountId);

  await sleep(rand(300, 700));

  // 3. Click "Save"
  const saveBtn = await findSaveButton(page);
  await saveBtn.click();
  await sleep(rand(CONFIG.saveWaitMs, CONFIG.saveWaitMs + 1500));

  // 4. Detect success: the form (name field) should be gone after a successful save.
  //    If it's still visible, the save likely failed (validation/error) — don't mark uploaded.
  let success = false;
  try {
    const nameFieldAfter = await findNameField(page);
    success = !await nameFieldAfter.isVisible({ timeout: 1500 }).catch(() => true);
  } catch (_) {}
  console.log(`${tag} ${success ? 'Saved.' : 'Save may have failed — will retry next run.'}`);
  return success;
}

// ─── MAIN ─────────────────────────────────────────────────
async function main() {
  const limit = process.argv[2] ? parseInt(process.argv[2], 10) : 0;

  const allRows = loadRowsWithApiKeys(CONFIG.csvFile);
  if (allRows.length === 0) {
    console.log('No rows with an api_key found in cloudflare.csv. Run get-api-key first.');
    return;
  }

  // Anti-duplikat: skip emails already marked uploaded in the tracking file.
  const uploaded = loadUploaded(CONFIG.trackingFile);
  const pending = allRows.filter(r => !uploaded.has(r.email));
  const skipped = allRows.length - pending.length;
  const todo = limit > 0 ? pending.slice(0, limit) : pending;

  console.log(`=== Cloudflare provider uploader ===`);
  console.log(`Rows with api_key: ${allRows.length}  |  already uploaded: ${skipped}  |  to do: ${todo.length}${limit > 0 ? ` (capped at ${todo.length})` : ''}`);
  if (todo.length === 0) {
    console.log('Nothing to do — all entries already uploaded.');
    return;
  }
  console.log(`Target: ${CONFIG.siteUrl}  (headless=${CONFIG.headless})\n`);

  const browser = await chromium.launch({ headless: CONFIG.headless });
  const page = await browser.newPage();

  try {
    // ── Login ──
    console.log('Logging in...');
    await page.goto(`${CONFIG.siteUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(1500, 3000));
    await page.getByRole('textbox', { name: 'Enter password' }).fill(CONFIG.loginPassword);
    await sleep(rand(300, 600));
    await page.getByRole('button', { name: 'Login' }).click();
    await sleep(rand(2500, 4000));

    // ── Providers → Cloudflare ──
    console.log('Opening Providers...');
    const providersLink = await firstVisible(page, [
      (p) => p.getByRole('link', { name: 'dns Providers', exact: true }),
      (p) => p.getByRole('link', { name: /Providers/i }),
    ]);
    await providersLink.click();
    await sleep(rand(1500, 3000));

    console.log('Opening Cloudflare provider...');
    // "Cloudflare Cloudflare 13" — the "13" is a count that changes; match by substring.
    const cfLink = await firstVisible(page, [
      (p) => p.getByRole('link', { name: /Cloudflare/ }),
      (p) => p.locator('a:has-text("Cloudflare")'),
    ]);
    await cfLink.click();
    await sleep(rand(2000, 3500));

    // ── Add each pending row ──
    let added = 0;
    let failed = 0;
    for (let i = 0; i < todo.length; i++) {
      const ok = await addOneEntry(page, todo[i], i, todo.length);
      if (ok) {
        markUploaded(CONFIG.trackingFile, todo[i].email);
        added++;
      } else {
        failed++;
      }
    }

    console.log(`\nDone. Added: ${added}  |  Failed (will retry next run): ${failed}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
  } finally {
    await sleep(2000);
    await browser.close();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG, loadRowsWithApiKeys };
