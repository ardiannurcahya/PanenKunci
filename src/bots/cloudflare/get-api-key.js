const fs = require('fs');
const { sleep, rand, fillHuman } = require('../../lib/helpers');

// Timeouts (ms)
const AI_GATEWAY_TIMEOUT = 30000; // wait for "Create authentication token" button
const TOKEN_WAIT_TIMEOUT = 60000; // wait for the token to appear after submit

// Recursively search a JSON body for a token-like string keyed by a token-ish name.
function findTokenInObject(obj, accountId) {
  if (!obj || typeof obj !== 'object') return null;
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }
    for (const [k, v] of Object.entries(cur || {})) {
      if (v && typeof v === 'object') { stack.push(v); continue; }
      if (typeof v === 'string' && v.length >= 16 && /^[\w.:\-]{16,}$/.test(v)) {
        if (accountId && v === accountId) continue;
        if (/token|secret|auth|value|key/i.test(k)) return v;
      }
    }
  }
  return null;
}

// Scrape the page for a token shown after creation (readonly input / code block / text).
async function scrapeTokenFromPage(page, accountId) {
  const inputs = await page.locator('input[readonly]').all();
  for (const inp of inputs) {
    try {
      const val = await inp.inputValue({ timeout: 1000 }).catch(() => '');
      if (val && val.length >= 16 && val !== accountId && /^[\w.:\-]{16,}$/.test(val)) return val;
    } catch (_) {}
  }
  const codeEls = await page.locator('code, pre, [class*="mono" i], [data-testid*="token" i]').all();
  for (const el of codeEls) {
    try {
      const txt = ((await el.textContent({ timeout: 1000 }).catch(() => '')) || '').trim();
      if (txt && txt.length >= 16 && txt !== accountId && /^[\w.:\-]{16,}$/.test(txt)) return txt;
    } catch (_) {}
  }
  try {
    const body = await page.locator('body').textContent({ timeout: 2000 }).catch(() => '');
    if (body) {
      const matches = body.match(/[\w.:\-]{24,}/g) || [];
      for (const m of matches) {
        if (m === accountId) continue;
        if (/^[a-f0-9]{32}$/.test(m)) continue; // skip account-id-shaped hashes
        if (/^[a-f0-9\-]{36}$/.test(m)) continue; // skip UUIDs
        if (!/^[a-f0-9]+$/.test(m)) return m; // prefer non-pure-hex
      }
    }
  } catch (_) {}
  return null;
}

// Append the api_key as a 5th column on the matching email row (migrates the header once).
function appendApiKeyToCsv(outputFile, email, token) {
  if (!fs.existsSync(outputFile)) return;
  const lockPath = outputFile + '.lock';
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
    const content = fs.readFileSync(outputFile, 'utf8');
    const lines = content.split('\n');
    if (lines.length && lines[0].startsWith('email,password,account_id,status') && !lines[0].includes('api_key')) {
      lines[0] = lines[0].trim() + ',api_key';
    }
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes(email) && !line.includes(token)) {
        lines[i] = line.replace(/\r?\n?$/, '') + `,"${token}"`;
        break;
      }
    }
    fs.writeFileSync(outputFile, lines.join('\n'), 'utf8');
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
}

// ─── createApiKey ─────────────────────────────────────────
// Creates an AI Gateway authentication token (API key) for an already-logged-in
// Cloudflare account. Opens its own tab in the shared CDP context so the caller's
// main page (used for logout) is left untouched.
//
// Flow: AI menu → AI Gateway → "Create authentication token" → name → submit → capture token.
//
// @param {object} opts
// @param {import('playwright').BrowserContext} opts.context — shared CDP context (logged in)
// @param {string} opts.accountId — 32-hex account id (from dashboard URL)
// @param {string} [opts.email] — used to persist the token back to the CSV row
// @param {string} [opts.name] — token name (default: auto-<timestamp>)
// @param {string} [opts.outputFile] — cloudflare.csv path; if set + email, token is appended
// @returns {Promise<{name: string, token: string} | null>}
async function createApiKey({ context, accountId, email, name, outputFile } = {}) {
  if (!accountId) {
    console.log('  [API] No accountId available — skipping API key creation.');
    return null;
  }
  const tokenName = name || ('auto-' + Date.now().toString(36));
  console.log(`  [API] Creating AI Gateway auth token "${tokenName}"...`);

  let apiPage;
  try {
    apiPage = await context.newPage();
  } catch (e) {
    console.log(`  [API] Could not open tab: ${e.message}`);
    return null;
  }

  try {
    // 1. Navigate to AI Gateway (direct URL is more reliable than sidebar clicks).
    const gatewayUrl = `https://dash.cloudflare.com/${accountId}/ai/ai-gateway`;
    await apiPage.goto(gatewayUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => {
      console.log(`  [API] Navigation warning: ${e.message}`);
    });
    await sleep(rand(3000, 5000));

    // Wait for the "Create authentication token" button; fall back to sidebar clicks.
    let createBtn = apiPage.locator('button:has-text("Create authentication token")').first();
    if (!await createBtn.isVisible({ timeout: AI_GATEWAY_TIMEOUT }).catch(() => false)) {
      console.log('  [API] Button not found via direct nav — trying sidebar menu...');
      try {
        const aiMenu = apiPage.locator('[data-sidebar="menu-button"]:has-text("AI")').first();
        if (await aiMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
          await aiMenu.click();
          await sleep(rand(1000, 2000));
        }
        const gwLink = apiPage.locator('a[href*="/ai/ai-gateway"]').first();
        if (await gwLink.isVisible({ timeout: 5000 }).catch(() => false)) {
          await gwLink.click();
          await sleep(rand(3000, 5000));
        } else {
          await apiPage.goto(gatewayUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
          await sleep(rand(3000, 5000));
        }
      } catch (e) {
        console.log(`  [API] Sidebar fallback error: ${e.message}`);
      }
      createBtn = apiPage.locator('button:has-text("Create authentication token")').first();
    }

    if (!await createBtn.isVisible({ timeout: 10000 }).catch(() => false)) {
      console.log('  [API] "Create authentication token" button not found. Skipping.');
      return null;
    }

    // 2. Click "Create authentication token".
    await createBtn.click();
    console.log('  [API] Clicked "Create authentication token".');
    await sleep(rand(1500, 3000));

    // 3. Fill the token name (#name, with robust fallbacks).
    let filled = false;
    const nameSelectors = [
      '#name',
      'input[name="name"]',
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'form input[type="text"]',
    ];
    for (const sel of nameSelectors) {
      try {
        const loc = apiPage.locator(sel).first();
        if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fillHuman(apiPage, loc, tokenName);
          filled = true;
          console.log(`  [API] Filled name via: ${sel}`);
          break;
        }
      } catch (_) {}
    }
    if (!filled) console.log('  [API] Name input not found — submitting anyway.');
    await sleep(rand(500, 1000));

    // 4. Capture the token from the create-token API response, then submit.
    let capturedToken = null;
    const onResponse = async (response) => {
      try {
        const url = response.url();
        if (!/ai-gateway|gateway|auth|token/i.test(url)) return;
        if (response.status() >= 400) return;
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const body = await response.json().catch(() => null);
        if (!body) return;
        const found = findTokenInObject(body, accountId);
        if (found && !capturedToken) {
          capturedToken = found;
          console.log('  [API] Token captured from API response.');
        }
      } catch (_) {}
    };
    apiPage.on('response', onResponse);

    // Submit (obfuscated c_ classes are not stable — target the form's submit button).
    let submitted = false;
    const submitSelectors = [
      'form button[type="submit"]',
      '[role="dialog"] button[type="submit"]',
      'form button',
    ];
    for (const sel of submitSelectors) {
      try {
        const loc = apiPage.locator(sel).last();
        if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
          if (await loc.isEnabled({ timeout: 1000 }).catch(() => false)) {
            await loc.click();
            submitted = true;
            console.log(`  [API] Clicked submit via: ${sel}`);
            break;
          }
        }
      } catch (_) {}
    }
    if (!submitted) {
      console.log('  [API] Submit button not found — pressing Enter.');
      try { await apiPage.keyboard.press('Enter'); } catch (_) {}
    }

    // 5. Wait for the token (API response first, page scrape as fallback).
    let token = null;
    const deadline = Date.now() + TOKEN_WAIT_TIMEOUT;
    while (Date.now() < deadline) {
      await sleep(2000);
      if (capturedToken) { token = capturedToken; break; }
      token = await scrapeTokenFromPage(apiPage, accountId);
      if (token) { console.log('  [API] Token scraped from page.'); break; }
    }
    apiPage.off('response', onResponse);

    if (!token) {
      console.log('  [API] Could not capture the token (manual copy may be needed).');
      return null;
    }
    console.log(`  [API] Token: ${token.slice(0, 12)}...${token.slice(-4)}`);

    // 6. Persist the token back to the account's CSV row (appends an api_key column).
    if (outputFile && email) {
      try {
        appendApiKeyToCsv(outputFile, email, token);
        console.log(`  [API] Saved token to ${outputFile}`);
      } catch (e) {
        console.log(`  [API] CSV save error: ${e.message}`);
      }
    }

    // Close any success dialog so the caller's logout isn't blocked.
    try { await apiPage.keyboard.press('Escape'); } catch (_) {}

    return { name: tokenName, token };
  } finally {
    try { await apiPage.close(); } catch (_) {}
  }
}

module.exports = { createApiKey, CONFIG: { AI_GATEWAY_TIMEOUT, TOKEN_WAIT_TIMEOUT } };
