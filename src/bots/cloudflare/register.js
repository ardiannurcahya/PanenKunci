const { spawn } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

const { loadEnv } = require('../../lib/env');
const { sleep, rand, fillHuman } = require('../../lib/helpers');
const { createTask, getTaskResult } = require('../../lib/capmonster');
const { createApiKey } = require('./get-api-key');

loadEnv();
chromium.use(stealth);

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  signupUrl: 'https://dash.cloudflare.com/sign-up',
  turnstileSitekey: '0x4AAAAAAAJel0iaAR3mgkjp',
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY || '',
  configJson: path.join(__dirname, '../../../data/config2.json'),
  outputFile: path.join(__dirname, '../../../output/cloudflare.csv'),
  chromeDebugPort: 9222,
  profileDir: path.join(__dirname, '../../../output/chrome-cf-profile'),
  navigateTimeout: 30000,
  // Yahoo verification
  yahooEmail: process.env.YAHOO_EMAIL || '',
  yahooPassword: process.env.YAHOO_PASSWORD || '',
  yahooBaseAddress: process.env.YAHOO_BASE_ADDRESS || '',
  emailWaitMs: 300000,       // 5 minutes max to wait for Cloudflare email
  emailPollMs: 10000,        // poll Yahoo inbox every 10s
  emailInitialWaitMs: 15000, // wait 15s before first check (give Cloudflare time to send)
};

// ─── CSV writer (4 columns: email,password,account_id,status) ──
function saveCloudflareCsv(outputFile, email, password, accountId, status) {
  const lockPath = outputFile + '.lock';
  for (let i = 0; i < 10; i++) {
    try {
      fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
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
    const headers = 'email,password,account_id,status';
    const row = [email, password, accountId || '', status || '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',');
    if (!fs.existsSync(outputFile)) {
      fs.writeFileSync(outputFile, headers + '\n' + row + '\n', 'utf8');
    } else {
      let content = fs.readFileSync(outputFile, 'utf8');
      if (!content.endsWith('\n')) {
        content += '\n';
        fs.writeFileSync(outputFile, content, 'utf8');
      }
      fs.appendFileSync(outputFile, row + '\n', 'utf8');
    }
    console.log(`  Saved to: ${outputFile}`);
  } finally {
    try { fs.unlinkSync(lockPath); } catch (_) {}
  }
}

// ─── HELPERS ──────────────────────────────────────────────
function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  const specials = '#!@';
  let pw = '';
  for (let i = 0; i < 8; i++) pw += chars[rand(0, chars.length)];
  for (let i = 0; i < 3; i++) pw += nums[rand(0, nums.length)];
  pw += specials[rand(0, specials.length)];
  return pw;
}

function loadEmails() {
  if (!fs.existsSync(CONFIG.configJson)) {
    console.error(`Config file not found: ${CONFIG.configJson}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG.configJson, 'utf8'));
  const emails = raw.emails.split(',').map(e => e.trim()).filter(e => e.length > 0);
  if (emails.length === 0) {
    console.error('No emails found in config.json');
    process.exit(1);
  }
  return emails;
}

function getUsedEmails() {
  if (!fs.existsSync(CONFIG.outputFile)) return new Set();
  const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('email,'));
  const used = new Set();
  for (const line of lines) {
    const match = line.match(/^"([^"]+)"/);
    if (match) used.add(match[1]);
  }
  return used;
}

function getNextEmail() {
  const emails = loadEmails();
  const used = getUsedEmails();
  for (const email of emails) {
    if (!used.has(email)) return email;
  }
  console.error('All emails in config.json have been used. Add more emails.');
  process.exit(1);
}

function getUnusedEmails() {
  const emails = loadEmails();
  const used = getUsedEmails();
  return emails.filter(e => !used.has(e));
}

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ─── Fetch interceptor — injects cf_challenge_response into signup API call ───
// This runs in the page's main world. It patches window.fetch to intercept
// POST requests to /api/v4/user/create and inject the Turnstile token.
const FETCH_INTERCEPTOR = (token) => `
(function() {
  var TOKEN = ${JSON.stringify(token)};
  var origFetch = window.fetch;
  var origXHROpen = XMLHttpRequest.prototype.open;
  var origXHRSend = XMLHttpRequest.prototype.send;

  // Patch fetch
  window.fetch = function(input, init) {
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/api/v4/user/create') !== -1 && init && init.body) {
        var body = JSON.parse(init.body);
        body.cf_challenge_response = TOKEN;
        init.body = JSON.stringify(body);
        console.log('[CF-BOT] Injected cf_challenge_response into fetch');
      }
    } catch(e) {}
    return origFetch.apply(this, arguments);
  };

  // Patch XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__cfUrl = url;
    return origXHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    try {
      if (this.__cfUrl && this.__cfUrl.indexOf('/api/v4/user/create') !== -1 && body) {
        var parsed = JSON.parse(body);
        parsed.cf_challenge_response = TOKEN;
        body = JSON.stringify(parsed);
        console.log('[CF-BOT] Injected cf_challenge_response into XHR');
      }
    } catch(e) {}
    return origXHRSend.call(this, body);
  };
})();
`;

// ─── clickTurnstile: find Turnstile frame and click checkbox ──
async function clickTurnstile(page, opts = {}) {
  const { timeoutS = 60, waitS = 30 } = opts;

  let turnstileFrame = null;
  for (let i = 0; i < timeoutS; i++) {
    for (const frame of page.frames()) {
      const url = frame.url();
      if (url.includes('challenges.cloudflare.com') && url.includes('turnstile')) {
        turnstileFrame = frame;
        break;
      }
    }
    if (turnstileFrame) break;
    await sleep(1000);
  }
  if (!turnstileFrame) return false;

  try {
    const frameElement = await turnstileFrame.frameElement();
    const box = await frameElement.boundingBox();
    if (!box) return false;

    const clickX = box.x + 30 + rand(-5, 5);
    const clickY = box.y + box.height / 2 + rand(-3, 3);

    await page.mouse.move(clickX - 100, clickY - 40, { steps: 5 });
    await sleep(rand(200, 500));
    await page.mouse.move(clickX, clickY, { steps: 10 });
    await sleep(rand(300, 800));
    await page.mouse.click(clickX, clickY);

    for (let i = 0; i < waitS; i++) {
      await sleep(2000);
      const submitBtn = page.locator('button[data-testid="signup-submit-button"]').first();
      if (await submitBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await submitBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
      const currentUrl = page.url();
      if (!currentUrl.includes('sign-up') && !currentUrl.includes('email-verification')) return true;
      const verifyBtn = page.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm")').first();
      if (await verifyBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await verifyBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
    }

    // Retry click
    await sleep(500);
    await page.mouse.click(clickX + rand(-3, 3), clickY + rand(-3, 3));
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const submitBtn = page.locator('button[data-testid="signup-submit-button"]').first();
      if (await submitBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await submitBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
      const currentUrl = page.url();
      if (!currentUrl.includes('sign-up') && !currentUrl.includes('email-verification')) return true;
      const verifyBtn = page.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm")').first();
      if (await verifyBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await verifyBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
    }
  } catch (_) {}
  return false;
}

// ─── getVerificationLinkFromYahoo: extract verification URL via CDP tab ──
// Uses a new tab in the SAME CDP browser (visible) instead of a separate headless browser.
async function getVerificationLinkFromYahoo(context) {
  if (!CONFIG.yahooEmail || !CONFIG.yahooPassword) {
    console.log('  YAHOO_EMAIL/YAHOO_PASSWORD not set in .env — skipping auto verification.');
    return null;
  }

  console.log('  Opening Yahoo Mail in new tab...');
  let verifyUrl = null;
  let yahooPage = null;

  try {
    yahooPage = await context.newPage();

    // Go directly to unread inbox URL — if already logged in (persistent profile),
    // we'll land in the unread inbox and can skip login entirely.
    const unreadUrl = 'https://mail.yahoo.com/n/search/referrer=unread&keyword=is%253Aunread&accountIds=1&excludefolders=ARCHIVE?src=ym&reason=myc';
    console.log('  Checking Yahoo Mail session (unread inbox)...');
    await yahooPage.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(rand(3000, 5000));

    let inbox = yahooPage;
    const currentUrl = yahooPage.url();

    if (currentUrl.includes('mail.yahoo.com') && !currentUrl.includes('login.yahoo.com')) {
      // Already logged in — already on unread inbox!
      console.log('  Yahoo session active — skipping login.');
    } else {
      // Need to login
      console.log('  Yahoo session expired — logging in...');
      await yahooPage.goto('https://login.yahoo.com/', { waitUntil: 'load', timeout: 30000 });
      await sleep(rand(3000, 5000));

      await yahooPage.getByRole('textbox', { name: 'Username, email or phone' }).fill(CONFIG.yahooEmail);
      await sleep(rand(500, 1000));
      await yahooPage.getByRole('button', { name: 'Next' }).click();
      await sleep(rand(2000, 4000));

      await yahooPage.getByRole('textbox', { name: 'Password' }).click();
      await sleep(rand(300, 600));
      await yahooPage.getByRole('textbox', { name: 'Password' }).fill(CONFIG.yahooPassword);
      await sleep(rand(500, 1000));
      await yahooPage.getByRole('button', { name: 'Next' }).click();
      await sleep(rand(3000, 6000));

      await yahooPage.getByRole('button', { name: 'Lewati' }).click().catch(() => {});
      await sleep(rand(2000, 4000));

      // Open inbox
      const checkMailLink = yahooPage.getByRole('link', { name: 'Check your mail' });
      if (await checkMailLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        const inboxPromise = yahooPage.waitForEvent('popup');
        await checkMailLink.click();
        inbox = await inboxPromise;
      }
      // Navigate to unread inbox
      await inbox.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    }
    await sleep(rand(3000, 5000));
    console.log(`  Yahoo unread inbox: ${inbox.url().slice(0, 60)}`);

    // Wait before first check — give Cloudflare time to send the email
    console.log(`  Waiting ${CONFIG.emailInitialWaitMs / 1000}s for Cloudflare email to arrive...`);
    await sleep(CONFIG.emailInitialWaitMs);

    const deadline = Date.now() + CONFIG.emailWaitMs;
    while (Date.now() < deadline) {
      console.log('  Checking unread inbox for Cloudflare email...');

      // In unread inbox, find email list items that mention "Cloudflare"
      // Yahoo Mail renders each email as a row/list-item. We look for rows
      // containing "Cloudflare" text (sender name or subject) and click those.
      // This avoids clicking on unrelated unread emails.
      let found = false;

      // Strategy 1: Yahoo email rows containing "Cloudflare" in sender/subject
      // Yahoo uses [data-test="message-item"] or similar for email rows
      const rowSelectors = [
        '[data-test="message-item"]:has-text("Cloudflare")',
        '[data-testid="message-item"]:has-text("Cloudflare")',
        'li:has-text("Cloudflare")',
        'tr:has-text("Cloudflare")',
        '[role="listitem"]:has-text("Cloudflare")',
        '[role="row"]:has-text("Cloudflare")',
        'div[data-test-id]:has-text("Cloudflare")',
      ];

      for (const sel of rowSelectors) {
        try {
          const loc = inbox.locator(sel).first();
          if (await loc.isVisible({ timeout: 1000 }).catch(() => false)) {
            console.log(`  Cloudflare email row found via: ${sel}`);
            await loc.click();
            found = true;
            break;
          }
        } catch (_) {}
      }

      // Strategy 2: broader — any clickable element with "Cloudflare" in text
      // but exclude navigation/toolbar elements
      if (!found) {
        try {
          // Find elements that contain "Cloudflare" and look like email rows
          const candidates = inbox.locator('*:has-text("Cloudflare")');
          const count = await candidates.count().catch(() => 0);
          for (let j = 0; j < Math.min(count, 10); j++) {
            const el = candidates.nth(j);
            const tagName = await el.evaluate(e => e.tagName).catch(() => '');
            const isClickable = await el.evaluate(e => {
              // Skip if it's a tiny element (likely icon/text fragment)
              const rect = e.getBoundingClientRect();
              if (rect.width < 100 || rect.height < 20) return false;
              // Skip if it contains other Cloudflare elements (parent, not the row itself)
              const cloudflareChildren = e.querySelectorAll('*:has-text("Cloudflare")');
              // Check if this is a direct email row (has clickable behavior)
              return e.onclick !== null || e.getAttribute('role') === 'button' || e.tagName === 'A' || rect.width > 200;
            }).catch(() => false);
            if (isClickable) {
              console.log(`  Cloudflare email found via broad search (${tagName})`);
              await el.click();
              found = true;
              break;
            }
          }
        } catch (_) {}
      }

      if (found) {
        console.log('  Opening email...');
        await sleep(rand(3000, 5000));

        // Extract verification URL from opened email
        const verifyLink = inbox.locator('a[href*="dash.cloudflare.com/email-verification"]').first();
        const href = await verifyLink.getAttribute('href').catch(() => null);

        if (href && href.includes('email-verification')) {
          verifyUrl = href;
          console.log(`  Verification URL found: ${href.slice(0, 80)}...`);
          break;
        }

        const allLinks = await inbox.locator('a[href*="email-verification"]').all();
        for (const link of allLinks) {
          const h = await link.getAttribute('href').catch(() => null);
          if (h && h.includes('dash.cloudflare.com')) {
            verifyUrl = h;
            console.log(`  Verification URL found (fallback): ${h.slice(0, 80)}...`);
            break;
          }
        }
        if (verifyUrl) break;

        const bodyText = await inbox.locator('body').textContent().catch(() => '');
        const match = bodyText.match(/https:\/\/dash\.cloudflare\.com\/email-verification\?token=[^\s"'<>]+/);
        if (match) {
          verifyUrl = match[0];
          console.log(`  Verification URL found (text): ${verifyUrl.slice(0, 80)}...`);
          break;
        }

        console.log('  Email opened but no verification link found. Will retry...');
        await inbox.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await sleep(rand(3000, 5000));
      } else {
        console.log(`  No Cloudflare email in unread. Waiting ${CONFIG.emailPollMs / 1000}s...`);
        await sleep(CONFIG.emailPollMs);
        await inbox.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await sleep(rand(3000, 5000));
      }
    }
  } catch (e) {
    console.log(`  Yahoo error: ${e.message}`);
  } finally {
    // Keep Yahoo tab open for a few seconds so user can see
    if (verifyUrl) {
      console.log('  Closing Yahoo tab in 5s...');
      await sleep(5000);
    }
    if (yahooPage) {
      try { await yahooPage.close(); } catch (_) {}
    }
  }

  return verifyUrl;
}

// ─── registerOne: full flow for one email (steps 2-11) ──
async function registerOne(context, page, email, password, index, total) {
  const tag = `[${index + 1}/${total}]`;
  console.log(`\n${'='.repeat(50)}`);
  console.log(`${tag} Registering: ${email}`);
  console.log(`${tag} Password: ${password}`);
  console.log(`${'='.repeat(50)}\n`);

  let accountId = null;
  let verified = false;
  let signupError = null;

  // ─── Step 2: Navigate to signup page ──────────────────
  console.log(`${tag} [2/11] Navigating to signup page...`);
  await page.goto(CONFIG.signupUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });

  let lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) break;
    lastUrl = currentUrl;
  }
  console.log(`  URL: ${page.url()}`);

  // ─── Step 3: Wait for React app + fill form ───────────
  console.log(`${tag} [3/11] Waiting for React app to mount...`);
  let formReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      formReady = await page.locator('input[data-testid="signup-input-email"]').isVisible({ timeout: 500 }).catch(() => false);
      if (formReady) break;
    } catch (_) {}
    await sleep(1000);
  }
  if (!formReady) {
    console.log(`  FATAL: Signup form not detected after 30s. Skipping.`);
    return { email, password, accountId: null, verified: false, error: 'form not found' };
  }
  console.log('  Form detected. Filling email + password...');

  const emailInput = page.locator('input[data-testid="signup-input-email"]');
  await fillHuman(page, emailInput, email);
  await sleep(rand(500, 1000));

  const passwordInput = page.locator('input[data-testid="signup-input-password"]');
  await fillHuman(page, passwordInput, password);
  await sleep(rand(500, 1000));
  console.log('  Form filled.');

  // ─── Step 4: Find Turnstile frame ─────────────────────
  console.log(`${tag} [4/11] Waiting for Turnstile frame...`);
  let turnstileFrame = null;
  for (let i = 0; i < 60; i++) {
    for (const frame of page.frames()) {
      const url = frame.url();
      if (url.includes('challenges.cloudflare.com') && url.includes('turnstile')) {
        turnstileFrame = frame;
        console.log(`  Frame found (${i + 1}s): ${url.slice(0, 80)}`);
        break;
      }
    }
    if (turnstileFrame) break;
    if (i % 10 === 9) console.log(`  Still waiting... (${i + 1}/60)`);
    await sleep(1000);
  }
  if (!turnstileFrame) console.log('  WARNING: Turnstile frame not found.');

  // ─── Step 5: Click Turnstile checkbox ─────────────────
  console.log(`${tag} [5/11] Clicking Turnstile checkbox...`);
  let turnstileSolved = false;

  if (turnstileFrame) {
    try {
      const frameElement = await turnstileFrame.frameElement();
      const box = await frameElement.boundingBox();
      if (box) {
        console.log(`  Widget: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);
        const clickX = box.x + 30 + rand(-5, 5);
        const clickY = box.y + box.height / 2 + rand(-3, 3);
        console.log(`  Moving mouse to checkbox at (${Math.round(clickX)}, ${Math.round(clickY)})...`);
        await page.mouse.move(clickX - 100, clickY - 40, { steps: 5 });
        await sleep(rand(200, 500));
        await page.mouse.move(clickX, clickY, { steps: 10 });
        await sleep(rand(300, 800));
        await page.mouse.click(clickX, clickY);
        console.log('  Clicked.');

        console.log('  Waiting for verification...');
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
          const enabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
          if (enabled) { turnstileSolved = true; console.log('  Turnstile solved!'); break; }
          if (!page.url().includes('sign-up')) { turnstileSolved = true; console.log('  Page navigated.'); break; }
          if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}/30)`);
        }

        if (!turnstileSolved) {
          console.log('  First click did not solve. Retrying...');
          await sleep(rand(500, 1000));
          await page.mouse.move(clickX + rand(-3, 3), clickY + rand(-3, 3), { steps: 8 });
          await sleep(rand(300, 600));
          await page.mouse.click(clickX + rand(-3, 3), clickY + rand(-3, 3));
          for (let i = 0; i < 15; i++) {
            await sleep(2000);
            const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
            const enabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
            if (enabled) { turnstileSolved = true; console.log('  Solved on retry!'); break; }
            if (!page.url().includes('sign-up')) { turnstileSolved = true; console.log('  Navigated on retry.'); break; }
          }
        }
      }
    } catch (e) {
      console.log(`  Click error: ${e.message}`);
    }
  }

  // Fallback: CapMonster
  if (!turnstileSolved) {
    console.log('  Physical click failed. Trying CapMonster...');
    let token = null;
    try {
      const taskId = await createTask(CONFIG.capmonsterApiKey, {
        type: 'TurnstileTaskProxyless',
        websiteURL: page.url(),
        websiteKey: CONFIG.turnstileSitekey,
      });
      console.log(`  CapMonster task: ${taskId}. Waiting...`);
      const solution = await getTaskResult(CONFIG.capmonsterApiKey, taskId, { timeoutMs: 120000, pollMs: 3000 });
      token = solution.token || (solution.data && solution.data.token) || solution.value;
      if (token) console.log(`  Token: ${token.slice(0, 50)}...`);
    } catch (e) { console.log(`  CapMonster error: ${e.message}`); }

    if (token) {
      await page.evaluate(FETCH_INTERCEPTOR(token));
      await page.evaluate((t) => {
        if (window.turnstile && typeof window.turnstile.getResponse === 'function') window.turnstile.getResponse = () => t;
      }, token).catch(() => {});
      console.log('  Token injected.');
      await sleep(2000);
      turnstileSolved = true;
    } else {
      console.log('  >>> KLIK TURNSTILE MANUAL DI CHROME <<<');
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        if (!page.url().includes('sign-up')) { turnstileSolved = true; console.log('  Manual solve detected.'); break; }
        const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
        if (await submitBtn.isEnabled({ timeout: 500 }).catch(() => false)) { turnstileSolved = true; console.log('  Manual solve detected.'); break; }
      }
    }
  }

  // ─── Step 6: Click Sign up button ─────────────────────
  console.log(`${tag} [6/11] Clicking Sign up button...`);
  if (page.url().includes('sign-up')) {
    const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
    if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      let btnEnabled = false;
      for (let i = 0; i < 10; i++) {
        btnEnabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
        if (btnEnabled) break;
        await sleep(1000);
      }
      if (btnEnabled) {
        await sleep(rand(500, 1500));
        await submitBtn.click();
        console.log('  Clicked submit.');
      } else {
        console.log('  Submit disabled. Trying JS click + Enter...');
        await submitBtn.evaluate(el => el.click()).catch(() => {});
        await passwordInput.press('Enter').catch(() => {});
      }
    }
  } else {
    console.log('  Already navigated past signup.');
  }

  // ─── Step 7: Wait for dashboard ───────────────────────
  console.log(`${tag} [7/11] Waiting for dashboard...`);
  await sleep(3000);
  for (let i = 0; i < 60; i++) {
    const currentUrl = page.url();
    const match = currentUrl.match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
    if (match) { accountId = match[1]; console.log(`  Dashboard! Account ID: ${accountId}`); break; }
    if (currentUrl.includes('email-verification') || currentUrl.includes('?to=')) {
      await sleep(3000);
      const match2 = page.url().match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
      if (match2) { accountId = match2[1]; console.log(`  Dashboard! Account ID: ${accountId}`); break; }
    }
    if (currentUrl.includes('sign-up')) {
      const errorEl = page.locator('p.text-kumo-danger').first();
      const errorText = await errorEl.textContent({ timeout: 500 }).catch(() => '');
      if (errorText && errorText.trim()) { signupError = errorText.trim(); console.log(`  Form error: ${signupError}`); break; }
    }
    await sleep(2000);
  }

  // ─── Step 8: Save results ─────────────────────────────
  console.log(`${tag} [8/11] Saving registration results...`);
  if (accountId) {
    saveCloudflareCsv(CONFIG.outputFile, email, password, accountId, 'registered');
  } else {
    console.log('  Registration failed — email NOT marked as used. Can retry.');
    return { email, password, accountId: null, verified: false, error: signupError };
  }

  // ─── Step 9: Get verification link from Yahoo ─────────
  console.log(`${tag} [9/11] Verifying email via Yahoo...`);
  const verifyUrl = await getVerificationLinkFromYahoo(context);

  if (verifyUrl) {
    // ─── Step 10: Open verification link ──────────────────
    console.log(`${tag} [10/11] Opening verification link...`);
    try {
      const verifyPage = await context.newPage();
      console.log(`  Navigating to: ${verifyUrl.slice(0, 80)}...`);
      await verifyPage.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);

      let hasTurnstile = false;
      for (const frame of verifyPage.frames()) {
        if (frame.url().includes('challenges.cloudflare.com') && frame.url().includes('turnstile')) { hasTurnstile = true; break; }
      }

      if (hasTurnstile) {
        console.log('  Turnstile on verification page. Solving...');
        const solved = await clickTurnstile(verifyPage, { timeoutS: 30, waitS: 30 });
        console.log(`  Turnstile: ${solved}`);
        if (solved) {
          const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
          if (await verifyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            if (await verifyBtn.isEnabled({ timeout: 1000 }).catch(() => false)) { await verifyBtn.click(); console.log('  Clicked verify button.'); }
          }
        } else {
          console.log('  >>> KLIK CAPTCHA MANUAL DI CHROME <<<');
          for (let i = 0; i < 60; i++) {
            await sleep(2000);
            if (!verifyPage.url().includes('email-verification')) { console.log('  Navigated — likely solved.'); break; }
          }
        }
      } else {
        console.log('  No Turnstile on verification page.');
        const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
        if (await verifyBtn.isVisible({ timeout: 5000 }).catch(() => false)) { await verifyBtn.click(); console.log('  Clicked verify button.'); }
      }

      console.log('  Waiting for verification to complete...');
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        const currentUrl = verifyPage.url();
        if (currentUrl.match(/dash\.cloudflare\.com\/[a-f0-9]{32}\/home/)) { verified = true; console.log('  Email verified! Dashboard.'); break; }
        if (!currentUrl.includes('email-verification') && currentUrl.includes('dash.cloudflare.com')) { verified = true; console.log(`  Email verified! ${currentUrl.slice(0, 60)}`); break; }
        try {
          const bodyText = await verifyPage.locator('body').textContent({ timeout: 1000 }).catch(() => '');
          if (bodyText && /email.*verif|verif.*success|account.*activ|successfully.*verif/i.test(bodyText)) { verified = true; console.log('  Email verified! Success text.'); break; }
        } catch (_) {}
        if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}/45) URL: ${currentUrl.slice(0, 60)}`);
      }
      // Keep verification page open for a few seconds so user can see
      console.log('  Closing verification page in 5s...');
      await sleep(5000);
      await verifyPage.close().catch(() => {});
    } catch (e) {
      console.log(`  Verification page error: ${e.message}`);
    }
  } else {
    console.log('  No verification link found in Yahoo.');
  }

  // Update CSV status
  if (verified) {
    try {
      const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(email) && lines[i].includes('registered')) { lines[i] = lines[i].replace('registered', 'verified'); break; }
      }
      fs.writeFileSync(CONFIG.outputFile, lines.join('\n'), 'utf8');
      console.log('  CSV updated: status = verified');
    } catch (e) { console.log(`  CSV update error: ${e.message}`); }
  }

  // ─── Step 10.5: Create API key (AI Gateway auth token) ──
  if (verified && accountId) {
    console.log(`${tag} Creating AI Gateway auth token...`);
    const apiKeyResult = await createApiKey({ context, accountId, email, outputFile: CONFIG.outputFile });
    if (apiKeyResult) console.log(`${tag} API key created: ${apiKeyResult.name}`);
    else console.log(`${tag} API key creation skipped/failed.`);
  }

  // ─── Step 11: Logout from Cloudflare ──────────────────
  console.log(`${tag} [11/11] Logging out from Cloudflare...`);
  try {
    // Click user menu button → click "Log out" menu item
    const userMenuBtn = page.locator('button[data-testid="kumo-user-dropdown-button"]').first();
    if (await userMenuBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await userMenuBtn.click();
      console.log('  Clicked user menu.');
      await sleep(2000);

      const logoutItem = page.locator('[data-testid="kumo-user-dropdown-logout"]').first();
      if (await logoutItem.isVisible({ timeout: 5000 }).catch(() => false)) {
        await logoutItem.click();
        console.log('  Clicked Log out.');
        await sleep(2000);
      } else {
        const logoutByText = page.locator('text="Log out"').first();
        if (await logoutByText.isVisible({ timeout: 3000 }).catch(() => false)) {
          await logoutByText.click();
          console.log('  Clicked Log out (by text).');
          await sleep(2000);
        } else {
          console.log('  Logout button not found. Trying API fallback...');
          await page.evaluate(() => fetch('/api/v4/user/sessions/current', { method: 'DELETE' })).catch(() => {});
        }
      }
    } else {
      console.log('  User menu not found. Trying API logout...');
      await page.evaluate(() => fetch('/api/v4/user/sessions/current', { method: 'DELETE' })).catch(() => {});
    }

    // Wait for redirect to login page
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      const currentUrl = page.url();
      if (currentUrl.includes('/login') || currentUrl === 'https://dash.cloudflare.com/') { console.log(`  Logged out!`); break; }
      if (i === 14) { await page.goto('https://dash.cloudflare.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {}); console.log('  Forced logout.'); }
    }
  } catch (e) {
    console.log(`  Logout error: ${e.message}`);
    try { await page.goto('https://dash.cloudflare.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {}); } catch (_) {}
  }

  // ─── Result for this email ────────────────────────────
  console.log('');
  console.log(`${'─'.repeat(50)}`);
  if (accountId && verified) {
    console.log(`  ${tag} ✅ VERIFIED: ${email} | ${accountId}`);
  } else if (accountId) {
    console.log(`  ${tag} ⚠️ REGISTERED (not verified): ${email} | ${accountId}`);
  } else {
    console.log(`  ${tag} ❌ FAILED: ${email} | ${signupError || 'unknown'}`);
  }
  console.log(`${'─'.repeat(50)}\n`);

  return { email, password, accountId, verified, error: signupError };
}

// ─── MAIN ─────────────────────────────────────────────────
async function main() {
  console.log('=== Cloudflare Auto-Registration Bot (Loop Mode) ===\n');

  // Validate CapMonster key
  if (!CONFIG.capmonsterApiKey) {
    console.error('CAPMONSTER_API_KEY not found in .env');
    process.exit(1);
  }

  const chromePath = findChromePath();
  if (!chromePath) {
    console.error('Chrome tidak ditemukan. Install Chrome dulu.');
    process.exit(1);
  }

  // Determine emails to register
  // CLI arg: single email | no arg: all unused emails from config.json
  let emailsToRegister = [];
  if (process.argv[2]) {
    emailsToRegister = [process.argv[2]];
  } else {
    emailsToRegister = getUnusedEmails();
  }

  if (emailsToRegister.length === 0) {
    console.error('No unused emails found in config.json. Add more emails.');
    process.exit(1);
  }

  console.log(`Emails to register: ${emailsToRegister.length}`);
  emailsToRegister.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  console.log('');

  // Prepare profile directory
  if (!fs.existsSync(CONFIG.profileDir)) {
    fs.mkdirSync(CONFIG.profileDir, { recursive: true });
  }

  // Kill existing Chrome instances
  try {
    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
  } catch (_) {}
  await sleep(2000);

  // ─── Step 1: Launch Chrome via CDP (once for all emails) ──
  console.log('[1/11] Launching Chrome (headed, CDP)...');
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${CONFIG.chromeDebugPort}`,
    `--user-data-dir=${CONFIG.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
    'about:blank',
  ], { stdio: 'ignore' });

  let browser = null;
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CONFIG.chromeDebugPort}`);
      break;
    } catch { await sleep(500); }
  }
  if (!browser) {
    console.error('FATAL: Could not connect to Chrome CDP.');
    chromeProc.kill();
    process.exit(1);
  }
  console.log('  CDP connected.');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // ─── Loop through all emails ──────────────────────────
  let successCount = 0;
  let failCount = 0;
  let verifiedCount = 0;

  for (let i = 0; i < emailsToRegister.length; i++) {
    const email = emailsToRegister[i];
    const password = generatePassword();

    const result = await registerOne(context, page, email, password, i, emailsToRegister.length);

    if (result.accountId) {
      successCount++;
      if (result.verified) verifiedCount++;
    } else {
      failCount++;
    }

    // Delay between registrations (except last)
    if (i < emailsToRegister.length - 1) {
      const delay = rand(40000, 80000);
      console.log(`\nWaiting ${Math.round(delay / 1000)}s before next registration...\n`);
      await sleep(delay);
    }
  }

  // ─── Final Summary ────────────────────────────────────
  console.log('\n');
  console.log('='.repeat(50));
  console.log('  FINAL SUMMARY');
  console.log('='.repeat(50));
  console.log(`  Total:     ${emailsToRegister.length}`);
  console.log(`  Success:   ${successCount}`);
  console.log(`  Verified:  ${verifiedCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Output:    ${CONFIG.outputFile}`);
  console.log('='.repeat(50));
  console.log('');

  // Close Chrome
  console.log('Closing Chrome...');
  try { await browser.close(); } catch (_) {}
  try { chromeProc.kill(); } catch (_) {}
  process.exit(0);
}

// ─── CLI ─────────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG };
