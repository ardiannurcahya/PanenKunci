const { spawn } = require('child_process');
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const path = require('path');
const fs = require('fs');
const { sleep } = require('./src/lib/helpers');
const { loadEnv } = require('./src/lib/env');

loadEnv();
chromium.use(stealth);

const SIGNUP_URL = 'https://dash.cloudflare.com/sign-up';

// ─── Output directory & file paths ─────────────────────────
const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const TRACE_PATH = path.join(OUTPUT_DIR, 'cloudflare-trace.zip');
const NETWORK_LOG_PATH = path.join(OUTPUT_DIR, 'cloudflare-network.log');
const TIMELINE_PATH = path.join(OUTPUT_DIR, 'cloudflare-timeline.txt');
const DOM_PREFIX = path.join(OUTPUT_DIR, 'cloudflare-dom');

// ─── Chrome path detection ─────────────────────────────────
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
let chromePath = null;
for (const p of chromePaths) {
  if (fs.existsSync(p)) { chromePath = p; break; }
}

// ─── Recording state ───────────────────────────────────────
const startTime = Date.now();
let domSnapshotCount = 0;
let networkStream = null;
let timelineStream = null;
let saved = false;
let lastUrl = '';

// ─── Helpers ───────────────────────────────────────────────
function ts() {
  const elapsed = (Date.now() - startTime) / 1000;
  const sec = Math.floor(elapsed);
  const ms = Math.floor((elapsed - sec) * 1000);
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function timeline(msg) {
  const line = `[${ts()}] ${msg}`;
  console.log(line);
  if (timelineStream) {
    timelineStream.write(line + '\n');
    timelineStream.uncork();
  }
}

function networkLog(obj) {
  if (networkStream) {
    networkStream.write(JSON.stringify(obj) + '\n');
    networkStream.uncork();
  }
}

function saveDomSnapshot(page, label) {
  domSnapshotCount++;
  const num = String(domSnapshotCount).padStart(3, '0');
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const filePath = `${DOM_PREFIX}-${num}-${slug}.html`;
  page.content().then(html => {
    try {
      fs.writeFileSync(filePath, html, 'utf8');
      timeline(`DOM snapshot saved: cloudflare-dom-${num}-${slug}.html (${Math.round(html.length / 1024)}KB)`);
    } catch (e) {
      timeline(`DOM snapshot FAILED: ${e.message}`);
    }
  }).catch(e => {
    timeline(`DOM snapshot FAILED (content): ${e.message}`);
  });
}

// ─── Main ──────────────────────────────────────────────────
(async () => {
  if (!chromePath) {
    console.error('Chrome tidak ditemukan. Install Chrome dulu.');
    process.exit(1);
  }

  // Open output streams
  networkStream = fs.createWriteStream(NETWORK_LOG_PATH, { flags: 'w' });
  timelineStream = fs.createWriteStream(TIMELINE_PATH, { flags: 'w' });

  // Clean up old DOM snapshots from previous runs
  try {
    const oldSnaps = fs.readdirSync(OUTPUT_DIR).filter(f => f.startsWith('cloudflare-dom-') && f.endsWith('.html'));
    for (const f of oldSnaps) {
      fs.unlinkSync(path.join(OUTPUT_DIR, f));
    }
    if (oldSnaps.length > 0) timeline(`Cleaned up ${oldSnaps.length} old DOM snapshot(s)`);
  } catch (_) {}

  timeline('=== Cloudflare Signup Tracking ===');
  timeline(`Output dir: ${OUTPUT_DIR}`);
  timeline(`Chrome: ${chromePath}`);

  // Kill existing Chrome instances
  timeline('Killing existing Chrome instances...');
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /F /IM chrome.exe 2>nul', { stdio: 'ignore' });
  } catch (_) {}
  await sleep(2000);

  // Use a FRESH profile each run — delete old profile to avoid stale login sessions
  const profileDir = path.join(OUTPUT_DIR, 'chrome-tracking-profile');
  if (fs.existsSync(profileDir)) {
    timeline('Deleting old Chrome profile (fresh session)...');
    try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
  }
  fs.mkdirSync(profileDir, { recursive: true });

  timeline('Launching Chrome (normal browser, CDP on port 9222)...');
  const chromeProc = spawn(chromePath, [
    '--remote-debugging-port=9222',
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    SIGNUP_URL,
  ], { stdio: 'ignore' });

  // Wait for Chrome to be ready, then connect via CDP
  timeline('Waiting for Chrome CDP endpoint...');
  let browser = null;
  for (let i = 0; i < 30; i++) {
    try {
      browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
      break;
    } catch {
      await sleep(500);
    }
  }
  if (!browser) {
    timeline('FATAL: Could not connect to Chrome CDP. Aborting.');
    chromeProc.kill();
    process.exit(1);
  }
  timeline('CDP connected!');

  const context = browser.contexts()[0];

  // ─── Layer 1: Playwright Trace ──────────────────────────
  timeline('Starting Playwright trace recording...');
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });

  const page = context.pages()[0] || await context.newPage();

  // ─── Layer 3: Console & page error capture ──────────────
  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    if (type === 'error' || type === 'warning') {
      timeline(`[console.${type}] ${text.slice(0, 300)}`);
    }
  });
  page.on('pageerror', err => {
    timeline(`[PAGE ERROR] ${err.message}`);
  });

  // ─── Layer 2: Network interception & logging ────────────
  // We intercept requests to capture bodies for API calls.
  // For non-API calls, we log URL + headers only.
  context.on('request', request => {
    const url = request.url();
    const method = request.method();
    const headers = request.headers();
    const postData = request.postData();

    // Determine category for highlighting
    let category = null;
    if (url.includes('challenges.cloudflare.com') || url.includes('cdn-cgi/challenge-platform')) {
      category = 'TURNSTILE';
    } else if (url.includes('dash.cloudflare.com/api/') && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      category = 'API';
    } else if (url.includes('/verify') || url.includes('/verification') || url.includes('/confirm') || url.includes('email-verify')) {
      category = 'VERIFY';
    }
    // Extract Turnstile sitekey from URL if present
    let sitekey = null;
    if (category === 'TURNSTILE') {
      const m1 = url.match(/sitekey=([^&]+)/);
      if (m1) sitekey = decodeURIComponent(m1[1]);
      // Cloudflare Turnstile sitekeys: 0x followed by 20+ alphanumeric chars (NOT hex-only)
      const m2 = url.match(/(0x[0-9A-Za-z]{12,})/);
      if (!sitekey && m2) sitekey = m2[1];
    }

    const entry = {
      ts: ts(),
      type: 'request',
      method,
      url,
      category,
      sitekey,
      hasBody: !!postData,
      body: postData ? postData.slice(0, 5000) : null,
      headers: category ? headers : undefined,
    };
    networkLog(entry);

    // Highlight in timeline
    if (category === 'TURNSTILE') {
      timeline(`[TURNSTILE] ${method} ${url.slice(0, 200)}`);
      if (sitekey) timeline(`  >> Sitekey: ${sitekey}`);
      if (postData && postData.includes('turnstile')) {
        timeline(`  >> Body contains turnstile reference: ${postData.slice(0, 200)}`);
      }
    } else if (category === 'API') {
      timeline(`[API] ${method} ${url.slice(0, 200)}`);
      if (postData) timeline(`  >> Body: ${postData.slice(0, 500)}`);
    } else if (category === 'VERIFY') {
      timeline(`[VERIFY] ${method} ${url.slice(0, 200)}`);
    }
  });

  context.on('response', async response => {
    const url = response.url();
    const status = response.status();
    const method = response.request().method();

    let category = null;
    if (url.includes('challenges.cloudflare.com') || url.includes('cdn-cgi/challenge-platform')) {
      category = 'TURNSTILE';
    } else if (url.includes('dash.cloudflare.com/api/') && (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE')) {
      category = 'API';
    } else if (url.includes('/verify') || url.includes('/verification') || url.includes('/confirm') || url.includes('email-verify')) {
      category = 'VERIFY';
    }

    // Capture response body for API, VERIFY, and TURNSTILE categories
    let body = null;
    if (category === 'API' || category === 'VERIFY' || category === 'TURNSTILE') {
      try {
        const text = await response.text();
        body = text ? text.slice(0, 5000) : null;
      } catch (_) {}
    }

    const entry = {
      ts: ts(),
      type: 'response',
      method,
      url,
      status,
      category,
      body,
    };
    networkLog(entry);

    if (category === 'TURNSTILE') {
      timeline(`[TURNSTILE] Response ${status} from ${url.slice(0, 150)}`);
      if (body) timeline(`  >> Response body: ${body.slice(0, 500)}`);
    } else if (category === 'API') {
      timeline(`[API] Response ${status} from ${url.slice(0, 150)}`);
      if (body) timeline(`  >> Response body: ${body.slice(0, 500)}`);
    } else if (category === 'VERIFY') {
      timeline(`[VERIFY] Response ${status} from ${url.slice(0, 150)}`);
      if (body) timeline(`  >> Response body: ${body.slice(0, 500)}`);
    }
  });

  // ─── Layer 3: DOM snapshot triggers ─────────────────────
  // Monitor URL changes for navigation-based snapshots
  page.on('framenavigated', frame => {
    if (frame !== page.mainFrame()) return;
    const currentUrl = page.url();
    if (currentUrl !== lastUrl) {
      timeline(`URL changed: ${lastUrl} -> ${currentUrl}`);
      lastUrl = currentUrl;
      saveDomSnapshot(page, `url-change-${currentUrl.replace(/https?:\/\/[^/]+/, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`);
    }
  });

  // Wait for page to load, then snapshot when React app mounts
  timeline(`Navigating to ${SIGNUP_URL}...`);
  await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
  await sleep(2000);

  // Wait for URL to stabilize (Cloudflare may redirect)
  lastUrl = page.url();
  for (let i = 0; i < 10; i++) {
    await sleep(2000);
    const currentUrl = page.url();
    if (currentUrl === lastUrl) break;
    lastUrl = currentUrl;
  }
  timeline(`URL stabilized: ${page.url()}`);

  // Poll for React app mount — look for common form elements
  timeline('Waiting for React app to mount (form elements)...');
  let formMounted = false;
  for (let i = 0; i < 30; i++) {
    try {
      const hasForm = await page.evaluate(() => {
        return !!(
          document.querySelector('input[type="email"], input[name*="email"], input[placeholder*="mail" i], input[aria-label*="mail" i]') ||
          document.querySelector('input[type="password"], input[name*="password"]') ||
          document.querySelector('button[type="submit"], button:has-text("Sign up"), button:has-text("Create"), button:has-text("Sign Up")')
        );
      }).catch(() => false);
      if (hasForm) {
        formMounted = true;
        break;
      }
    } catch (_) {}
    await sleep(1000);
  }

  if (formMounted) {
    timeline('React app mounted, form elements detected!');
    saveDomSnapshot(page, 'form-mounted');
  } else {
    timeline('WARNING: Form elements not detected after 30s. Saving DOM anyway.');
    saveDomSnapshot(page, 'no-form-detected');
  }

  // Monitor for Turnstile widget appearance
  timeline('Monitoring for Turnstile widget...');
  let turnstileDetected = false;
  let turnstileCheckCount = 0;
  const turnstileCheckInterval = setInterval(async () => {
    turnstileCheckCount++;
    if (turnstileDetected) return;
    try {
      const hasTurnstile = await page.evaluate(() => {
        return !!(
          document.querySelector('.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]') ||
          (window.turnstile && typeof window.turnstile === 'object')
        );
      }).catch(() => false);
      if (hasTurnstile && !turnstileDetected) {
        turnstileDetected = true;
        timeline('Turnstile widget detected in DOM!');
        saveDomSnapshot(page, 'turnstile-visible');

        // Try to extract sitekey from DOM
        try {
          const domSitekey = await page.evaluate(() => {
            const el = document.querySelector('[data-sitekey]');
            if (el) return el.getAttribute('data-sitekey');
            return null;
          }).catch(() => null);
          if (domSitekey) {
            timeline(`  >> DOM sitekey: ${domSitekey}`);
          }
        } catch (_) {}
      }
    } catch (_) {}

    // Also check for dashboard (signup complete)
    if (turnstileDetected && turnstileCheckCount > 5) {
      try {
        const url = page.url();
        if (url.includes('dashboard') || url.includes('/home') || url.includes('/overview') || url.includes('/profile')) {
          if (!dashboardDetected) {
            dashboardDetected = true;
            timeline(`Dashboard detected (URL: ${url})!`);
            saveDomSnapshot(page, 'dashboard');
          }
        }
      } catch (_) {}
    }
  }, 2000);

  let dashboardDetected = false;

  // ─── Ready for manual interaction ───────────────────────
  timeline('');
  timeline('========================================');
  timeline('  TRACKING ACTIVE — Silakan signup manual di Chrome');
  timeline('  ========================================');
  timeline('');
  timeline('  Lakukan langkah berikut di jendela Chrome:');
  timeline('   1. Isi email (gunakan Yahoo dari config.json)');
  timeline('   2. Klik Sign Up / Next');
  timeline('   3. Isi password + konfirmasi');
  timeline('   4. Selesaikan Turnstile (klik checkbox)');
  timeline('   5. Buka email verifikasi di Yahoo, klik link');
  timeline('   6. Setelah dashboard muncul, navigasi ke API Token page');
  timeline('   7. Buat API token, copy nilainya');
  timeline('');
  timeline('  >>> TEKAN Ctrl+C DI TERMINAL INI saat selesai <<<');
  timeline('');
  timeline('  Recording layers active:');
  timeline('   - Playwright trace (screenshots + DOM snapshots)');
  timeline('   - Network log (full bodies for API calls)');
  timeline('   - DOM snapshots at key moments');
  timeline('   - Timeline (this file)');
  timeline('');
  timeline('========================================');
  timeline('');

  // ─── Exit handler: save everything ──────────────────────
  const saveAndExit = async (reason) => {
    if (saved) return;
    saved = true;

    clearInterval(turnstileCheckInterval);

    timeline('');
    timeline(`=== SAVING (reason: ${reason}) ===`);

    // Final DOM snapshot
    try {
      saveDomSnapshot(page, 'final-state');
      await sleep(1000); // give snapshot time to write
    } catch (_) {}

    // Stop tracing
    try {
      await context.tracing.stop({ path: TRACE_PATH });
      timeline(`Trace saved: ${path.basename(TRACE_PATH)}`);
    } catch (e) {
      timeline(`Trace save FAILED: ${e.message}`);
    }

    // Close streams
    try {
      if (networkStream) { networkStream.end(); networkStream.destroy(); }
      if (timelineStream) {
        timeline('=== Tracking complete ===');
        timeline(`Files saved:`);
        timeline(`  - ${path.basename(TRACE_PATH)}`);
        timeline(`  - ${path.basename(NETWORK_LOG_PATH)}`);
        timeline(`  - ${path.basename(TIMELINE_PATH)}`);
        timeline(`  - ${domSnapshotCount} DOM snapshots (${path.basename(DOM_PREFIX)}-*.html)`);
        timelineStream.end();
        timelineStream.destroy();
      }
    } catch (_) {}

    // Close browser
    try { await browser.close(); } catch (_) {}
    try { chromeProc.kill(); } catch (_) {}

    // Print to console
    console.log('');
    console.log('=== TRACKING COMPLETE ===');
    console.log(`Files saved in ${OUTPUT_DIR}:`);
    console.log(`  - cloudflare-trace.zip (Playwright trace)`);
    console.log(`  - cloudflare-network.log (network requests/responses)`);
    console.log(`  - cloudflare-timeline.txt (event timeline)`);
    console.log(`  - ${domSnapshotCount} DOM snapshot(s) (cloudflare-dom-*.html)`);
    console.log('');
    console.log('View trace with: npx playwright show-trace "' + TRACE_PATH + '"');
    process.exit(0);
  };

  process.on('SIGINT', () => saveAndExit('Ctrl+C'));
  process.on('SIGTERM', () => saveAndExit('SIGTERM'));

  chromeProc.on('exit', () => {
    if (!saved) saveAndExit('Chrome closed');
  });

  // Keep the process alive
  // The event handlers above will handle exit
})();
