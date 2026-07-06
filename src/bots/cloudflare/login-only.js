const { spawn } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');

const { loadEnv } = require('../../lib/env');
const { sleep, rand, fillHuman, redact } = require('../../lib/helpers');
const { parseCsvLine, stringifyCsvRow } = require('../../lib/csv');
const { createApiKey } = require('./get-api-key');

loadEnv();
chromium.use(stealth);

// ─── CONFIG ───────────────────────────────────────────────
const CONFIG = {
  loginUrl: 'https://dash.cloudflare.com/login',
  configJson: path.join(__dirname, '../../../data/config.json'),
  outputFile: path.join(__dirname, '../../../output/cloudflare.csv'),
  chromeDebugPort: 9222,
  profileDir: path.join(__dirname, '../../../output/chrome-cf-profile'),
  navigateTimeout: 30000,
  yahooEmail: process.env.YAHOO_EMAIL || '',
  yahooPassword: process.env.YAHOO_PASSWORD || '',
  emailWaitMs: 300000,
  emailPollMs: 10000,
  emailInitialWaitMs: 15000,
};

// ─── HELPERS ──────────────────────────────────────────────
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

// Read last unverified row from CSV, or accept CLI args
function getCredentials() {
  // CLI args: node login-only.js email password
  if (process.argv[2] && process.argv[3]) {
    return { email: process.argv[2], password: process.argv[3] };
  }

  // Read from CSV — find last row with status 'registered' (not 'verified')
  if (!fs.existsSync(CONFIG.outputFile)) {
    console.error('No cloudflare.csv found. Provide email + password as CLI args.');
    console.error('Usage: node login-only.js <email> <password>');
    process.exit(1);
  }
  const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('email,'));
  for (const line of lines) {
    const matches = line.match(/"([^"]*)"/g);
    if (matches && matches.length >= 4) {
      const email = matches[0].replace(/"/g, '');
      const password = matches[1].replace(/"/g, '');
      const status = matches[3].replace(/"/g, '');
      if (status === 'registered') return { email, password };
    }
  }
  // Fallback: return last row regardless of status
  if (lines.length > 0) {
    const matches = lines[lines.length - 1].match(/"([^"]*)"/g);
    if (matches && matches.length >= 2) {
      return { email: matches[0].replace(/"/g, ''), password: matches[1].replace(/"/g, '') };
    }
  }
  console.error('No credentials found in CSV. Provide email + password as CLI args.');
  process.exit(1);
}

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
      // Check for submit/login button enabled
      const submitBtn = page.locator('button[data-testid="signup-submit-button"], button[data-testid="login-submit-button"], button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await submitBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
      // URL change means we navigated past the form
      const currentUrl = page.url();
      if (!currentUrl.includes('login') && !currentUrl.includes('sign-up') && !currentUrl.includes('email-verification')) return true;
      // Check for verify/continue button (verification page)
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
      const submitBtn = page.locator('button[data-testid="signup-submit-button"], button[data-testid="login-submit-button"], button[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await submitBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
      const currentUrl = page.url();
      if (!currentUrl.includes('login') && !currentUrl.includes('sign-up') && !currentUrl.includes('email-verification')) return true;
      const verifyBtn = page.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm")').first();
      if (await verifyBtn.isVisible({ timeout: 200 }).catch(() => false)) {
        if (await verifyBtn.isEnabled({ timeout: 200 }).catch(() => false)) return true;
      }
    }
  } catch (_) {}
  return false;
}

// ─── getVerificationLinkFromYahoo ────────────────────────
// Uses a new tab in the SAME CDP browser (visible) instead of a separate headless browser.
// context = the CDP browser context (shared with main page)
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

      // Strategy 2: broader — find clickable element with "Cloudflare" text
      if (!found) {
        try {
          const candidates = inbox.locator('*:has-text("Cloudflare")');
          const count = await candidates.count().catch(() => 0);
          for (let j = 0; j < Math.min(count, 10); j++) {
            const el = candidates.nth(j);
            const tagName = await el.evaluate(e => e.tagName).catch(() => '');
            const isClickable = await el.evaluate(e => {
              const rect = e.getBoundingClientRect();
              if (rect.width < 100 || rect.height < 20) return false;
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

// ─── MAIN ─────────────────────────────────────────────────
async function main() {
  console.log('=== Cloudflare Login + Verify Bot ===\n');

  const { email, password } = getCredentials();
  console.log(`Email:    ${email}`);
  console.log(`Password: ${redact(password)}`);
  console.log('');

  const chromePath = findChromePath();
  if (!chromePath) {
    console.error('Chrome tidak ditemukan. Install Chrome dulu.');
    process.exit(1);
  }

  if (!fs.existsSync(CONFIG.profileDir)) {
    fs.mkdirSync(CONFIG.profileDir, { recursive: true });
  }

  // Kill existing Chrome
  try {
    require('child_process').execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
  } catch (_) {}
  await sleep(2000);

  // ─── Step 1: Launch Chrome ────────────────────────────
  console.log('[1/8] Launching Chrome (headed, CDP)...');
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

  // ─── Step 2: Navigate to login page ───────────────────
  console.log('[2/8] Navigating to login page...');
  await page.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });

  // Wait for URL to stabilize
  let lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) break;
    lastUrl = currentUrl;
  }
  console.log(`  URL: ${page.url()}`);

  // If already logged in (redirected to dashboard), skip login
  if (page.url().match(/dash\.cloudflare\.com\/[a-f0-9]{32}\/home/)) {
    console.log('  Already logged in! Skipping to verification.');
    const match = page.url().match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
    const accountId = match ? match[1] : null;
    console.log(`  Account ID: ${accountId}`);
    // Jump to step 5 (Yahoo verification)
    await doVerification(context, page, email, accountId, browser, chromeProc);
    return;
  }

  // ─── Step 3: Wait for login form + fill ───────────────
  console.log('[3/8] Waiting for login form...');
  let formReady = false;
  for (let i = 0; i < 30; i++) {
    // Try multiple selectors for login form
    const selectors = [
      'input[data-testid="login-input-email"]',
      'input[name="email"]',
      'input[autocomplete="email"]',
      'input[type="email"]',
      'input[data-testid="signup-input-email"]',
    ];
    for (const sel of selectors) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 300 }).catch(() => false)) {
          formReady = true;
          console.log(`  Login form found via: ${sel}`);

          // Fill email
          await fillHuman(page, loc, email);
          await sleep(rand(500, 1000));

          // Find password field
          const pwSelectors = [
            'input[data-testid="login-input-password"]',
            'input[name="password"]',
            'input[type="password"]',
            'input[data-testid="signup-input-password"]',
          ];
          let pwFilled = false;
          for (const pwSel of pwSelectors) {
            try {
              const pwLoc = page.locator(pwSel).first();
              if (await pwLoc.isVisible({ timeout: 500 }).catch(() => false)) {
                await fillHuman(page, pwLoc, password);
                await sleep(rand(500, 1000));
                pwFilled = true;
                console.log(`  Password filled via: ${pwSel}`);
                break;
              }
            } catch (_) {}
          }

          if (!pwFilled) {
            // Some login forms show password on next step — click Next first
            const nextBtn = page.locator('button:has-text("Next"), button[type="submit"]').first();
            if (await nextBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              console.log('  Clicking Next to reveal password field...');
              await nextBtn.click();
              await sleep(rand(2000, 4000));
              // Now try password field again
              for (const pwSel of pwSelectors) {
                try {
                  const pwLoc = page.locator(pwSel).first();
                  if (await pwLoc.isVisible({ timeout: 2000 }).catch(() => false)) {
                    await fillHuman(page, pwLoc, password);
                    await sleep(rand(500, 1000));
                    pwFilled = true;
                    console.log(`  Password filled via: ${pwSel}`);
                    break;
                  }
                } catch (_) {}
              }
            }
          }
          break;
        }
      } catch (_) {}
    }
    if (formReady) break;
    await sleep(1000);
  }

  if (!formReady) {
    console.error('  FATAL: Login form not detected after 30s.');
    await browser.close();
    chromeProc.kill();
    process.exit(1);
  }
  console.log('  Login form filled.');

  // ─── Step 4: Handle Turnstile + submit ────────────────
  console.log('[4/8] Checking for Turnstile on login page...');
  // Check if Turnstile is present
  let hasTurnstile = false;
  for (let i = 0; i < 10; i++) {
    for (const frame of page.frames()) {
      if (frame.url().includes('challenges.cloudflare.com') && frame.url().includes('turnstile')) {
        hasTurnstile = true;
        break;
      }
    }
    if (hasTurnstile) break;
    await sleep(1000);
  }

  if (hasTurnstile) {
    console.log('  Turnstile found. Solving...');
    const solved = await clickTurnstile(page, { timeoutS: 30, waitS: 30 });
    console.log(`  Turnstile solved: ${solved}`);
  } else {
    console.log('  No Turnstile on login page.');
  }

  // Click login/submit button
  const submitSelectors = [
    'button[data-testid="login-submit-button"]',
    'button[data-testid="signup-submit-button"]',
    'button[type="submit"]',
    'button:has-text("Log in")',
    'button:has-text("Sign in")',
    'button:has-text("Next")',
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
        // Wait for enabled
        for (let i = 0; i < 10; i++) {
          if (await btn.isEnabled({ timeout: 500 }).catch(() => false)) break;
          await sleep(1000);
        }
        await sleep(rand(500, 1500));
        await btn.click();
        console.log(`  Clicked submit via: ${sel}`);
        submitted = true;
        break;
      }
    } catch (_) {}
  }
  if (!submitted) {
    console.log('  No submit button found. Trying Enter key...');
    await page.keyboard.press('Enter');
  }

  // Wait for dashboard
  console.log('  Waiting for dashboard...');
  await sleep(3000);
  let accountId = null;
  for (let i = 0; i < 60; i++) {
    const currentUrl = page.url();
    const match = currentUrl.match(/dash\.cloudflare\.com\/([a-f0-9]{32})\/home/);
    if (match) {
      accountId = match[1];
      console.log(`  Dashboard reached! Account ID: ${accountId}`);
      break;
    }
    // Check for error
    if (currentUrl.includes('login')) {
      const errorEl = page.locator('p.text-kumo-danger, [class*="error"], [role="alert"]').first();
      const errorText = await errorEl.textContent({ timeout: 500 }).catch(() => '');
      if (errorText && errorText.trim() && errorText.trim().length > 3) {
        console.log(`  Login error: ${errorText.trim()}`);
        break;
      }
    }
    await sleep(2000);
  }

  if (!accountId) {
    console.log('  Login may have failed. Check Chrome.');
  }

  // ─── Steps 5-7: Yahoo verification ────────────────────
  await doVerification(context, page, email, accountId, browser, chromeProc);
}

// ─── Verification flow (shared) ───────────────────────────
async function doVerification(context, page, email, accountId, browser, chromeProc) {
  if (!accountId) {
    console.log('[5/8] Skipping verification — login failed.');
    console.log('[6/8] Skipping.');
    console.log('[7/8] Skipping.');
    console.log('[8/8] Skipping logout — login failed.');
    printResult(email, accountId, false, page.url());
    keepOpen(browser, chromeProc);
    return;
  }

  // ─── Step 5: Get verification link from Yahoo ─────────
  console.log('[5/8] Getting verification link from Yahoo...');
  const verifyUrl = await getVerificationLinkFromYahoo(context);

  let verified = false;

  if (verifyUrl) {
    // ─── Step 6: Open verification link + handle Turnstile ──
    console.log('[6/8] Opening verification link...');
    try {
      const verifyPage = await context.newPage();
      console.log(`  Navigating to: ${verifyUrl.slice(0, 80)}...`);
      await verifyPage.goto(verifyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);

      // Check for Turnstile on verification page
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
          // Look for verify/continue button
          const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
          if (await verifyBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            if (await verifyBtn.isEnabled({ timeout: 1000 }).catch(() => false)) {
              await verifyBtn.click();
              console.log('  Clicked verify button.');
            }
          }
        } else {
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
        console.log('  No Turnstile on verification page.');
        // Try clicking any verify/continue button
        const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Continue"), button:has-text("Confirm"), button[type="submit"]').first();
        if (await verifyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await verifyBtn.click();
          console.log('  Clicked verify button.');
        }
      }

      // Wait for verification to complete
      // From tracking: Cloudflare does PUT /api/v4/user/email-verification automatically
      // when the verification link is opened. The page may auto-redirect to dashboard
      // or show a success message. No button click needed in most cases.
      console.log('  Waiting for verification to complete...');
      for (let i = 0; i < 45; i++) {
        await sleep(2000);
        const currentUrl = verifyPage.url();

        // Success 1: redirected to dashboard
        if (currentUrl.match(/dash\.cloudflare\.com\/[a-f0-9]{32}\/home/)) {
          verified = true;
          console.log('  Email verified! Redirected to dashboard.');
          break;
        }
        // Success 2: redirected away from email-verification to any dash URL
        if (!currentUrl.includes('email-verification') && currentUrl.includes('dash.cloudflare.com')) {
          verified = true;
          console.log(`  Email verified! Redirected to: ${currentUrl.slice(0, 80)}`);
          break;
        }
        // Success 3: check page text for verification success
        try {
          const bodyText = await verifyPage.locator('body').textContent({ timeout: 1000 }).catch(() => '');
          if (bodyText && /email.*verif|verif.*success|account.*activ|successfully.*verif/i.test(bodyText)) {
            verified = true;
            console.log('  Email verified! Success text found on page.');
            break;
          }
        } catch (_) {}

        if (i % 5 === 4) console.log(`  Still waiting... (${i + 1}/45) URL: ${currentUrl.slice(0, 60)}`);
      }
      console.log('  Closing verification page in 5s...');
      await sleep(5000);
      await verifyPage.close().catch(() => {});
    } catch (e) {
      console.log(`  Verification page error: ${e.message}`);
    }
  } else {
    console.log('  No verification link found in Yahoo. Manual verification needed.');
  }

  // ─── Step 7: Update CSV ───────────────────────────────
  console.log('[7/8] Updating CSV...');
  if (verified && fs.existsSync(CONFIG.outputFile)) {
    try {
      const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
      const lines = content.split('\n');
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = parseCsvLine(lines[i]);
        if (cols[0] !== email || cols[3] !== 'registered') continue;
        cols[3] = 'verified';
        lines[i] = stringifyCsvRow(cols);
        break;
      }
      fs.writeFileSync(CONFIG.outputFile, lines.join('\n'), 'utf8');
      console.log('  CSV updated: status = verified');
    } catch (e) {
      console.log(`  CSV update error: ${e.message}`);
    }
  }

  // ─── Step 7.5: Create API key (AI Gateway auth token) ──
  if (verified && accountId) {
    console.log('[API] Creating AI Gateway auth token...');
    const apiKeyResult = await createApiKey({ context, accountId, email, outputFile: CONFIG.outputFile });
    if (apiKeyResult) console.log(`  [API] API key created: ${apiKeyResult.name}`);
    else console.log('  [API] API key creation skipped/failed.');
  }

  // ─── Step 8: Logout from Cloudflare ──────────────────
  if (accountId) {
    console.log('[8/8] Logging out from Cloudflare...');
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
        if (currentUrl.includes('/login') || currentUrl === 'https://dash.cloudflare.com/') {
          console.log(`  Logged out!`);
          break;
        }
        if (i === 14) {
          await page.goto('https://dash.cloudflare.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
          console.log('  Forced navigation to login page.');
        }
      }
    } catch (e) {
      console.log(`  Logout error: ${e.message}`);
      try {
        await page.goto('https://dash.cloudflare.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});
        console.log('  Fallback: navigated to login page.');
      } catch (_) {}
    }
  } else {
    console.log('[8/8] Skipping logout — login failed.');
  }

  printResult(email, accountId, verified, page.url());
  keepOpen(browser, chromeProc);
}

function printResult(email, accountId, verified, currentUrl) {
  console.log('');
  console.log('========================================');
  if (accountId && verified) {
    console.log('  LOGIN + VERIFICATION SUCCESSFUL!');
    console.log('  ========================================');
    console.log(`  Email:      ${email}`);
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Status:     verified`);
  } else if (accountId) {
    console.log('  LOGIN SUCCESSFUL (email not verified)');
    console.log('  ========================================');
    console.log(`  Email:      ${email}`);
    console.log(`  Account ID: ${accountId}`);
    console.log(`  Status:     registered (needs verification)`);
    console.log('');
    console.log('  >>> VERIFIKASI EMAIL MANUAL <<<');
  } else {
    console.log('  LOGIN FAILED');
    console.log('  ========================================');
    console.log(`  Email: ${email}`);
    console.log(`  URL:   ${currentUrl}`);
  }
  console.log('========================================');
  console.log('');
}

function keepOpen(browser, chromeProc) {
  console.log('  Tekan Ctrl+C untuk keluar.');
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
