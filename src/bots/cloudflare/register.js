const { spawn } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { chromium: plainChromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { loadEnv } = require('../../lib/env');
const { sleep, rand, fillHuman } = require('../../lib/helpers');
const { createTask, getTaskResult } = require('../../lib/capmonster');

loadEnv();
chromium.use(stealth);

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  signupUrl: 'https://dash.cloudflare.com/sign-up',
  turnstileSitekey: '0x4AAAAAAAJel0iaAR3mgkjp',
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY || '',
  configJson: path.join(__dirname, '../../../data/config.json'),
  outputFile: path.join(__dirname, '../../../output/cloudflare.csv'),
  chromeDebugPort: 9222,
  profileDir: path.join(__dirname, '../../../output/chrome-cf-profile'),
  navigateTimeout: 30000,
  // Yahoo verification
  yahooEmail: process.env.YAHOO_EMAIL || '',
  yahooPassword: process.env.YAHOO_PASSWORD || '',
  yahooBaseAddress: process.env.YAHOO_BASE_ADDRESS || '',
  emailWaitMs: 180000,       // 3 minutes max to wait for Cloudflare email
  emailPollMs: 5000,         // poll Yahoo inbox every 5s
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

// ─── getVerificationLinkFromYahoo: extract Cloudflare verification URL ──
async function getVerificationLinkFromYahoo(targetEmail) {
  if (!CONFIG.yahooEmail || !CONFIG.yahooPassword) {
    console.log('  YAHOO_EMAIL/YAHOO_PASSWORD not set in .env — skipping auto verification.');
    return null;
  }

  console.log('  Launching headless browser for Yahoo Mail...');
  const yahooBrowser = await plainChromium.launch({ headless: true });
  let verifyUrl = null;

  try {
    const yahooContext = await yahooBrowser.newContext();
    const yahooPage = await yahooContext.newPage();

    console.log('  Logging in to Yahoo...');
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

    console.log('  Opening Yahoo inbox...');
    const inboxPromise = yahooPage.waitForEvent('popup');
    await yahooPage.getByRole('link', { name: 'Check your mail' }).click();
    const inbox = await inboxPromise;
    await sleep(rand(5000, 8000));

    console.log('  Searching for Cloudflare emails...');
    const searchUrl = 'https://mail.yahoo.com/n/search/keyword=cloudflare?src=ym&reason=myc';
    await inbox.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await sleep(rand(5000, 8000));

    const deadline = Date.now() + CONFIG.emailWaitMs;
    while (Date.now() < deadline) {
      console.log('  Checking for Cloudflare email...');

      const emailLink = inbox.locator('a[href*="cloudflare"], [data-test*="cloudflare"], *:has-text("cloudflare")').first();
      const found = await emailLink.isVisible({ timeout: 2000 }).catch(() => false);

      if (found) {
        console.log('  Cloudflare email found! Opening...');
        await emailLink.click();
        await sleep(rand(3000, 5000));

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
        await inbox.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await sleep(rand(3000, 5000));
      } else {
        const senderLink = inbox.locator('*:has-text("Cloudflare")').first();
        const senderFound = await senderLink.isVisible({ timeout: 1000 }).catch(() => false);
        if (senderFound) {
          console.log('  Found Cloudflare sender reference, clicking...');
          await senderLink.click();
          await sleep(rand(3000, 5000));
          const verifyLink = inbox.locator('a[href*="email-verification"]').first();
          const href = await verifyLink.getAttribute('href').catch(() => null);
          if (href) {
            verifyUrl = href;
            console.log(`  Verification URL found: ${href.slice(0, 80)}...`);
            break;
          }
        }
      }

      console.log(`  No Cloudflare email yet. Waiting ${CONFIG.emailPollMs / 1000}s...`);
      await sleep(CONFIG.emailPollMs);
      await inbox.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(rand(3000, 5000));
    }
  } catch (e) {
    console.log(`  Yahoo error: ${e.message}`);
  } finally {
    await yahooBrowser.close();
  }

  return verifyUrl;
}
// ─── MAIN ─────────────────────────────────────────────────
async function main() {
  console.log('=== Cloudflare Auto-Registration Bot (Phase 2) ===\n');

  // Determine email — from CLI arg or first unused from config.json
  const email = process.argv[2] || getNextEmail();
  const password = generatePassword();

  console.log(`Email:    ${email}`);
  console.log(`Password: ${password}`);
  console.log('');

  // Validate CapMonster key
  if (!CONFIG.capmonsterApiKey) {
    console.error('CAPMONSTER_API_KEY not found in .env');
    process.exit(1);
  }

  // Find Chrome
  const chromePath = findChromePath();
  if (!chromePath) {
    console.error('Chrome tidak ditemukan. Install Chrome dulu.');
    process.exit(1);
  }

  // Prepare profile directory
  if (!fs.existsSync(CONFIG.profileDir)) {
    fs.mkdirSync(CONFIG.profileDir, { recursive: true });
  }

  // Kill existing Chrome instances
  try {
    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
  } catch (_) {}
  await sleep(2000);

  // ─── Step 1: Launch Chrome via CDP ────────────────────
  console.log('[1/8] Launching Chrome (headed, CDP)...');
  const chromeProc = spawn(chromePath, [
    `--remote-debugging-port=${CONFIG.chromeDebugPort}`,
    `--user-data-dir=${CONFIG.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
    'about:blank',
  ], { stdio: 'ignore' });

  // Wait for CDP endpoint
  let browser = null;
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CONFIG.chromeDebugPort}`);
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!browser) {
    console.error('FATAL: Could not connect to Chrome CDP.');
    chromeProc.kill();
    process.exit(1);
  }
  console.log('  CDP connected.');
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();

  // ─── Step 2: Navigate to signup page ──────────────────
  console.log('[2/8] Navigating to signup page...');
  await page.goto(CONFIG.signupUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });

  // Wait for URL to stabilize (Cloudflare may redirect)
  let lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) break;
    lastUrl = currentUrl;
  }
  console.log(`  URL: ${page.url()}`);

  // ─── Step 3: Wait for React app + fill form ───────────
  console.log('[3/8] Waiting for React app to mount...');
  let formReady = false;
  for (let i = 0; i < 30; i++) {
    try {
      formReady = await page.locator('input[data-testid="signup-input-email"]').isVisible({ timeout: 500 }).catch(() => false);
      if (formReady) break;
    } catch (_) {}
    await sleep(1000);
  }
  if (!formReady) {
    console.error('  FATAL: Signup form not detected after 30s.');
    await browser.close();
    chromeProc.kill();
    process.exit(1);
  }
  console.log('  Form detected. Filling email + password...');

  const emailInput = page.locator('input[data-testid="signup-input-email"]');
  await fillHuman(page, emailInput, email);
  await sleep(rand(500, 1000));

  const passwordInput = page.locator('input[data-testid="signup-input-password"]');
  await fillHuman(page, passwordInput, password);
  await sleep(rand(500, 1000));
  console.log('  Form filled.');

  // ─── Step 4: Find Turnstile frame via page.frames() ──
  // The Turnstile iframe is NOT visible via document.querySelectorAll('iframe')
  // — it's only accessible via Playwright's page.frames() API.
  // The frame URL always contains "challenges.cloudflare.com".
  console.log('[4/8] Waiting for Turnstile frame...');
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

  if (!turnstileFrame) {
    console.log('  WARNING: Turnstile frame not found. Will try CapMonster fallback.');
  }

  // ─── Step 5: Click Turnstile checkbox ─────────────────
  console.log('[5/8] Clicking Turnstile checkbox...');
  let turnstileSolved = false;

  if (turnstileFrame) {
    try {
      // Get the iframe element's bounding box on the page
      const frameElement = await turnstileFrame.frameElement();
      const box = await frameElement.boundingBox();
      if (box) {
        console.log(`  Widget: x=${Math.round(box.x)}, y=${Math.round(box.y)}, w=${Math.round(box.width)}, h=${Math.round(box.height)}`);

        // Checkbox is on the left side of the widget, vertically centered
        const clickX = box.x + 30 + rand(-5, 5);
        const clickY = box.y + box.height / 2 + rand(-3, 3);

        // Human-like: move mouse to nearby, then to checkbox, then click
        console.log(`  Moving mouse to checkbox at (${Math.round(clickX)}, ${Math.round(clickY)})...`);
        await page.mouse.move(clickX - 100, clickY - 40, { steps: 5 });
        await sleep(rand(200, 500));
        await page.mouse.move(clickX, clickY, { steps: 10 });
        await sleep(rand(300, 800));
        await page.mouse.click(clickX, clickY);
        console.log('  Clicked.');

        // Wait for Turnstile to solve
        console.log('  Waiting for verification...');
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
          const enabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
          if (enabled) {
            turnstileSolved = true;
            console.log('  Turnstile solved! Submit button enabled.');
            break;
          }
          if (!page.url().includes('sign-up')) {
            turnstileSolved = true;
            console.log('  Page navigated — Turnstile likely solved.');
            break;
          }
          if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}/30)`);
        }

        // Retry if first click didn't work
        if (!turnstileSolved) {
          console.log('  First click did not solve. Retrying...');
          await sleep(rand(500, 1000));
          await page.mouse.move(clickX + rand(-3, 3), clickY + rand(-3, 3), { steps: 8 });
          await sleep(rand(300, 600));
          await page.mouse.click(clickX + rand(-3, 3), clickY + rand(-3, 3));
          console.log('  Retry click done.');
          for (let i = 0; i < 15; i++) {
            await sleep(2000);
            const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
            const enabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
            if (enabled) {
              turnstileSolved = true;
              console.log('  Turnstile solved on retry!');
              break;
            }
            if (!page.url().includes('sign-up')) {
              turnstileSolved = true;
              console.log('  Page navigated on retry.');
              break;
            }
          }
        }
      } else {
        console.log('  WARNING: Could not get frame bounding box.');
      }
    } catch (e) {
      console.log(`  Click error: ${e.message}`);
    }
  }

  // Fallback: try CapMonster if physical click failed
  if (!turnstileSolved) {
    console.log('  Physical click failed. Trying CapMonster as fallback...');
    let token = null;
    try {
      const taskId = await createTask(CONFIG.capmonsterApiKey, {
        type: 'TurnstileTaskProxyless',
        websiteURL: page.url(),
        websiteKey: CONFIG.turnstileSitekey,
      });
      console.log(`  CapMonster task: ${taskId}. Waiting...`);
      const solution = await getTaskResult(CONFIG.capmonsterApiKey, taskId, {
        timeoutMs: 120000,
        pollMs: 3000,
      });
      token = solution.token || (solution.data && solution.data.token) || solution.value;
      if (token) console.log(`  Token: ${token.slice(0, 50)}...`);
    } catch (e) {
      console.log(`  CapMonster error: ${e.message}`);
    }

    if (token) {
      // Inject via fetch interceptor
      await page.evaluate(FETCH_INTERCEPTOR(token));
      await page.evaluate((t) => {
        if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
          window.turnstile.getResponse = () => t;
        }
      }, token).catch(() => {});
      console.log('  Token injected via fetch interceptor.');
      await sleep(2000);
      turnstileSolved = true; // optimistic — will see if submit works
    } else {
      // Last resort: manual
      console.log('  >>> KLIK TURNSTILE CHECKBOX MANUAL DI CHROME <<<');
      for (let i = 0; i < 90; i++) {
        await sleep(2000);
        if (!page.url().includes('sign-up')) {
          turnstileSolved = true;
          console.log('  Page navigated — manual solve detected.');
          break;
        }
        const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
        const enabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
        if (enabled) {
          turnstileSolved = true;
          console.log('  Submit button enabled — manual solve detected.');
          break;
        }
      }
    }
  }

  // ─── Step 6: Click Sign up button ─────────────────────
  console.log('[6/8] Clicking Sign up button...');

  // Check if URL already changed (auto-submit after Turnstile solve)
  if (page.url().includes('sign-up')) {
    const submitBtn = page.locator('button[data-testid="signup-submit-button"]');
    const btnVisible = await submitBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (btnVisible) {
      // Wait for button to be enabled
      let btnEnabled = false;
      for (let i = 0; i < 10; i++) {
        btnEnabled = await submitBtn.isEnabled({ timeout: 500 }).catch(() => false);
        if (btnEnabled) break;
        await sleep(1000);
      }
      if (btnEnabled) {
        await sleep(rand(500, 1500)); // human-like pause
        await submitBtn.click();
        console.log('  Clicked submit.');
      } else {
        console.log('  Submit button still disabled. Trying JS click + Enter...');
        await submitBtn.evaluate(el => el.click()).catch(() => {});
        await passwordInput.press('Enter').catch(() => {});
      }
    } else {
      console.log('  Submit button not visible. Page may have changed.');
    }
  } else {
    console.log('  Already navigated past signup.');
  }

  // ─── Step 7: Wait for dashboard ───────────────────────
  console.log('[7/8] Waiting for dashboard...');
  await sleep(3000);
  let accountId = null;
  let signupError = null;

  for (let i = 0; i < 60; i++) {
    const currentUrl = page.url();
    // Success: URL pattern /{accountId}/home
    const match = currentUrl.match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
    if (match) {
      accountId = match[1];
      console.log(`  Dashboard reached! Account ID: ${accountId}`);
      break;
    }
    // Check for redirect to verification page
    if (currentUrl.includes('email-verification') || currentUrl.includes('?to=')) {
      await sleep(3000);
      const url2 = page.url();
      const match2 = url2.match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
      if (match2) {
        accountId = match2[1];
        console.log(`  Dashboard reached! Account ID: ${accountId}`);
        break;
      }
    }
    // Check for error message on signup page
    if (currentUrl.includes('sign-up')) {
      const errorEl = page.locator('p.text-kumo-danger').first();
      const errorText = await errorEl.textContent({ timeout: 500 }).catch(() => '');
      if (errorText && errorText.trim()) {
        signupError = errorText.trim();
        console.log(`  Form error: ${signupError}`);
        break;
      }
    }
    await sleep(2000);
  }

  // ─── Step 8: Save results ─────────────────────────────
  console.log('[8/10] Saving registration results...');
  if (accountId) {
    saveCloudflareCsv(CONFIG.outputFile, email, password, accountId, 'registered');
  } else {
    console.log('  Registration failed — email NOT marked as used. Can retry.');
  }

  // ─── Step 9: Get verification link from Yahoo ─────────
  let verified = false;
  if (accountId) {
    console.log('[9/10] Verifying email via Yahoo...');
    const verifyUrl = await getVerificationLinkFromYahoo(email);

    if (verifyUrl) {
      // ─── Step 10: Open verification link + handle Turnstile ──
      console.log('[10/10] Opening verification link in main browser...');
      try {
        // Open verification URL in a new tab (same browser = same Cloudflare session)
        const verifyPage = await context.newPage();
        console.log(`  Navigating to: ${verifyUrl.slice(0, 80)}...`);
        await verifyPage.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await sleep(3000);

        // The verification page may have a Turnstile captcha
        // Check if there's a Turnstile frame
        let hasTurnstile = false;
        for (const frame of verifyPage.frames()) {
          if (frame.url().includes('challenges.cloudflare.com') && frame.url().includes('turnstile')) {
            hasTurnstile = true;
            break;
          }
        }

        if (hasTurnstile) {
          console.log('  Turnstile detected on verification page. Solving...');
          const solved = await clickTurnstile(verifyPage, { timeoutS: 30, waitS: 30 });
          console.log(`  Turnstile solve result: ${solved}`);

          if (solved) {
            // Look for a "Verify" or "Continue" button to click
            const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
            if (await verifyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
              if (await verifyBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
                await verifyBtn.click();
                console.log('  Clicked verify button.');
              }
            }
          } else {
            // Fallback: wait for manual solve
            console.log('  >>> KLIK CAPTCHA MANUAL DI CHROME <<<');
            for (let i = 0; i < 60; i++) {
              await sleep(2000);
              if (!verifyPage.url().includes('email-verification')) {
                console.log('  Verification page navigated — likely solved.');
                break;
              }
            }
          }
        } else {
          console.log('  No Turnstile on verification page. Checking for verify button...');
          // Page might auto-verify or have a button to click
          const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
          if (await verifyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await verifyBtn.click();
            console.log('  Clicked verify button.');
          }
        }

        // Wait for verification to complete
        // Success indicators: URL changes to /{accountId}/home or PUT /api/v4/user/email-verification returns 200
        console.log('  Waiting for verification to complete...');
        for (let i = 0; i < 30; i++) {
          await sleep(2000);
          const currentUrl = verifyPage.url();
          // Check if redirected to dashboard
          if (currentUrl.match(/dash\.cloudflare\.com\/[a-f0-9]{32}\/home/)) {
            verified = true;
            console.log('  Email verified! Redirected to dashboard.');
            break;
          }
          // Check for success message
          const successEl = verifyPage.locator('text*="verified", text*="success", text*="confirmed"').first();
          const successText = await successEl.textContent({ timeout: 500 }).catch(() => '');
          if (successText && /verif|success|confirm/i.test(successText)) {
            verified = true;
            console.log('  Email verified! Success message found.');
            break;
          }
          if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}/30)`);
        }

        // Also check main page (dashboard) — sometimes verification updates the session
        if (!verified) {
          const mainUrl = page.url();
          if (mainUrl.match(/dash\.cloudflare\.com\/[a-f0-9]{32}\/home/)) {
            // Check if email_verified flag changed by reloading
            await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await sleep(3000);
          }
        }

        await verifyPage.close().catch(() => {});
      } catch (e) {
        console.log(`  Verification page error: ${e.message}`);
      }
    } else {
      console.log('  No verification link found in Yahoo. Manual verification needed.');
    }

    // Update CSV status
    if (verified) {
      // Update the CSV row to 'verified'
      try {
        const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(email) && lines[i].includes('registered')) {
            lines[i] = lines[i].replace('registered', 'verified');
            break;
          }
        }
        fs.writeFileSync(CONFIG.outputFile, lines.join('\n'), 'utf8');
        console.log('  CSV updated: status = verified');
      } catch (e) {
        console.log(`  CSV update error: ${e.message}`);
      }
    }
  } else {
    console.log('[9/10] Skipping verification — registration failed.');
    console.log('[10/10] Skipping verification — registration failed.');
  }

  // ─── Result ───────────────────────────────────────────
  console.log('');
  console.log('========================================');
  if (accountId && verified) {
    console.log('  REGISTRATION + VERIFICATION SUCCESSFUL!');
    console.log('  ========================================');
    console.log(`  Email:      ${email}`);
    console.log(`  Password:   ${password}`);
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Status:     verified`);
    console.log(`  Saved to:   ${CONFIG.outputFile}`);
    console.log('');
    console.log('  Chrome tetap terbuka. Tekan Ctrl+C untuk keluar.');
  } else if (accountId) {
    console.log('  REGISTRATION SUCCESSFUL (email not verified)');
    console.log('  ========================================');
    console.log(`  Email:      ${email}`);
    console.log(`  Password:   ${password}`);
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Status:     registered (needs verification)`);
    console.log(`  Saved to:   ${CONFIG.outputFile}`);
    console.log('');
    console.log('  >>> VERIFIKASI EMAIL MANUAL <<<');
    console.log('  Buka email Yahoo, klik link verifikasi Cloudflare.');
    console.log('  Tekan Ctrl+C untuk keluar.');
  } else {
    console.log('  REGISTRATION FAILED');
    console.log('  ========================================');
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}`);
    if (signupError) console.log(`  Error:    ${signupError}`);
    console.log(`  URL:      ${page.url()}`);
    console.log('');
    console.log('  Email tidak ditandai sebagai used — bisa retry.');
    console.log('  Tekan Ctrl+C untuk keluar.');
  }
  console.log('========================================');
  console.log('');

  // Keep Chrome open
  let saved = false;
  const cleanup = async () => {
    if (saved) return;
    saved = true;
    console.log('\nClosing...');
    try { await browser.close(); } catch (_) {}
    try { chromeProc.kill(); } catch (_) {}
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  chromeProc.on('exit', () => {
    if (!saved) { saved = true; process.exit(0); }
  });
}

// ─── CLI ─────────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG };
