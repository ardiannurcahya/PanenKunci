// Qoder Auto-Registration Bot — orchestrator.
//
// The heavy lifting lives in steps/* (one module per phase) and the CapMonster
// Alibaba captcha solver in utils/capmonster.js. This file wires everything
// together: config, browser launch, anti-bot init script (incl. AliyunCaptcha
// hook), and the per-run loop.

// Load Environment Variables
const { loadEnv } = require('../../lib/env');
loadEnv();

const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(StealthPlugin);

const { sleep, rand, redact } = require('../../lib/helpers');

// Modular steps
const { stepNavigatePlatform, stepNavigateQoder } = require('./steps/navigate');
const { stepOpenOAuth, stepHandleOAuth } = require('./steps/oauth');
const { stepCreateCredentials, stepFillForm, stepEnterPassword } = require('./steps/registration');
const { stepVerifyCaptcha } = require('./steps/captcha');
const { stepInputOtp } = require('./steps/otp');

// ─── CONFIG ──────────────────────────────────────────────
const CONFIG = {
  // Platform URL
  platformUrl: process.env.PLATFORM_9ROUTER_URL,
  // Qoder provider page
  qoderUrl: process.env.QODER_URL,
  // Output file
  outputFile: path.join(__dirname, '../../../output/keys.csv'),
  // Platform password (for first-time access)
  platformPassword: process.env.PLATFORM_9ROUTER_PASSWORD,
  // Password for Qoder accounts
  password: process.env.QODER_ACCOUNT_PASSWORD,
  // Timeouts (ms)
  otpTimeout: 180000,
  navigateTimeout: 30000,
  capmonsterTimeout: 180000,
  // Number of registration loops
  loops: 5,
  // Captcha mode: 'capmonster' (CapMonster API, falls back to manual) | 'manual'
  captchaMode: 'capmonster',
  // CapMonster API key (Alibaba captcha solver)
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY,
  // User-Agent (kept in sync with the context UA below; used for CapMonster task)
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Proxy (optional)
  proxy: process.env.PROXY || '',
};

// ─── SINGLE REGISTRATION FLOW ────────────────────────────
// Runs steps 1→9 in order. Each step receives a shared `ctx` object and mutates
// it (e.g. sets ctx.oauthPage in step 3, ctx.email in step 5).
async function registerOnce(dashPage, context, runIndex, capturedConfig) {
  const tag = `[Run ${runIndex}]`;
  const ctx = { dashPage, context, runIndex, tag, CONFIG, capturedConfig };

  try {
    await stepNavigatePlatform(ctx);    // 1/9
    await stepNavigateQoder(ctx);       // 2/9
    await stepOpenOAuth(ctx);           // 3/9
    await stepHandleOAuth(ctx);         // 4/9
    await stepCreateCredentials(ctx);   // 5/9
    await stepFillForm(ctx);            // 6/9
    await stepEnterPassword(ctx);       // 7/9
    await stepVerifyCaptcha(ctx);       // 8/9
    const success = await stepInputOtp(ctx); // 9/9
    return success;
  } catch (err) {
    console.error(`${tag} ERROR: ${err.message}`);
    return false;
  } finally {
    // Don't close OAuth tab — let platform sync first.
    // Tabs stay open until the browser closes at the end.
    console.log(`${tag} Done. Tab stays open.`);
  }
}

// ─── MAIN LOOP ───────────────────────────────────────────
async function main() {
  console.log('=== Qoder Auto-Registration Bot ===');
  console.log(`Loops: ${CONFIG.loops}`);
  console.log(`Captcha: ${CONFIG.captchaMode}`);
  console.log(`CapMonster API key: ${CONFIG.capmonsterApiKey ? 'set' : 'NOT SET'}`);
  console.log('');

  console.log('[0] Launching browser...');
  const launchOpts = {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
    ],
  };
  if (CONFIG.proxy) {
    launchOpts.proxy = { server: CONFIG.proxy };
    console.log(`  Proxy: ${redact(CONFIG.proxy)}`);
  }
  const browser = await chromium.launch(launchOpts);

  // Randomize viewport slightly
  const vpWidth = 1366 + rand(-20, 20);
  const vpHeight = 768 + rand(-10, 10);

  const contextOpts = {
    userAgent: CONFIG.userAgent,
    viewport: { width: vpWidth, height: vpHeight },
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
  };
  const context = await browser.newContext(contextOpts);

  // Anti-bot: remove webdriver flag + patch chrome properties + hook AliyunCaptcha
  await context.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Fake plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    // Fake languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en', 'id'],
    });
    // Patch chrome
    window.chrome = { runtime: {} };
    // Patch permissions query
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);

    // ── AliyunCaptcha hook ────────────────────────────────────────────
    // The SDK defines initAliyunCaptcha AFTER our init script runs, so a plain
    // wrap at this point would miss it. We use a getter/setter trap on window
    // that intercepts the SDK's own assignment, then wraps the real function.
    window.__aliyunCaptchaConfig = { sceneId: null, prefix: null, mode: null };
    window.__aliyunCaptchaCallbacks = {};   // store ALL function opts from init
    let _initAliyunCaptcha;
    try {
      Object.defineProperty(window, 'initAliyunCaptcha', {
        configurable: true,
        get() { return _initAliyunCaptcha; },
        set(realFn) {
          _initAliyunCaptcha = function (opts) {
            try {
              if (opts) {
                window.__aliyunCaptchaConfig.sceneId = opts.SceneId || opts.sceneId || null;
                window.__aliyunCaptchaConfig.prefix = opts.prefix || opts.Prefix || null;
                window.__aliyunCaptchaConfig.mode = opts.mode || null;
                console.log('[hook] initAliyunCaptcha called with SceneId=' +
                  (opts.SceneId || opts.sceneId) + ', prefix=' + (opts.prefix || opts.Prefix));

                // Store EVERY function option so we can invoke the real callback later
                for (const key of Object.keys(opts)) {
                  if (typeof opts[key] === 'function') {
                    window.__aliyunCaptchaCallbacks[key] = opts[key];
                    console.log('[hook] captured callback: ' + key);
                  }
                }
              }
            } catch (_) {}
            const instance = realFn.apply(this, arguments);
            window.__aliyunCaptchaInstance = instance;
            return instance;
          };
        },
      });
    } catch (_) {}
  });

  // ── Observe AliyunCaptcha network responses ───────────────────────────
  // context.route() with glob wildcards is unreliable for subdomain matching.
  // We use a response listener instead — it observes without intercepting, and
  // we filter with regex so any Aliyun captcha endpoint is caught.
  const capturedConfig = { sceneId: null, prefix: null };

  // Regex helpers
  const findSceneId = (text) => {
    if (!text) return null;
    const patterns = [
      // "sceneId":"xxxx" or sceneId:"xxxx" (JSON / JS object, any case)
      /["']?(?:sceneId|SceneId|captchaSceneId|CaptchaSceneId)["']?\s*:\s*["']([a-zA-Z0-9_-]{4,})["']/i,
      // sceneId=xxxx or sceneId xxxx (query / loose)
      /(?:sceneId|SceneId)["\s:=]+["']?([a-zA-Z0-9_-]{4,})/i,
      // ?sceneId=xxxx or &sid=xxxx
      /[?&](?:sceneId|SceneId|sid)=([a-zA-Z0-9_-]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return null;
  };
  // Match any Aliyun captcha-related URL: *.captcha-open.aliyuncs.com, aliyuncs.com/captcha, etc.
  const aliyunUrlRe = /aliyuncs\.com|aliyunCaptcha|captcha-open|aliyun captcha/i;

  context.on('response', async (response) => {
    try {
      const url = response.url();
      if (!aliyunUrlRe.test(url)) return;

      console.log(`  [observe] response: ${url.slice(0, 100)}`);

      // Prefix from subdomain: https://{prefix}.captcha-open[-region].aliyuncs.com/...
      // Note: subdomain is "captcha-open-southeast" for SG region, not just "captcha-open"
      const prefixMatch = url.match(/https?:\/\/([a-z0-9]+)\.(?:captcha-open[a-z-]*\.)*aliyuncs\.com/i);
      if (prefixMatch && !capturedConfig.prefix) {
        capturedConfig.prefix = prefixMatch[1];
        console.log(`  [observe] Aliyun prefix: ${capturedConfig.prefix}`);
      }

      // sceneId in URL
      const urlSid = findSceneId(url);
      if (urlSid && !capturedConfig.sceneId) {
        capturedConfig.sceneId = urlSid;
        console.log(`  [observe] Aliyun sceneId (from URL): ${capturedConfig.sceneId}`);
      }

      // sceneId in response body (only text/json responses)
      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text') || ct.includes('javascript') || ct.includes('html')) {
        const body = await response.text().catch(() => '');
        if (body) {
          const bodySid = findSceneId(body);
          if (bodySid && !capturedConfig.sceneId) {
            capturedConfig.sceneId = bodySid;
            console.log(`  [observe] Aliyun sceneId (from body): ${capturedConfig.sceneId}`);
          }
          // Debug: dump first 200 chars if no sceneId found yet (helps diagnose format)
          if (!capturedConfig.sceneId && body.length < 2000) {
            console.log(`  [observe] body preview: ${body.slice(0, 200).replace(/\n/g, ' ')}`);
          }
        }
      }
    } catch (_) {}
  });

  // Open persistent dashboard tab (stays open across all loops)
  const dashPage = await context.newPage();

  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= CONFIG.loops; i++) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  REGISTRATION LOOP ${i} / ${CONFIG.loops}`);
    console.log(`${'='.repeat(50)}\n`);

    const success = await registerOnce(dashPage, context, i, capturedConfig);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Delay between runs (except last)
    if (i < CONFIG.loops) {
      const delay = rand(15000, 30000);
      console.log(`\n  Waiting ${Math.round(delay / 1000)}s before next run...`);
      await sleep(delay);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('  FINAL SUMMARY');
  console.log(`${'='.repeat(50)}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed:  ${failCount}`);
  console.log(`  Total:   ${CONFIG.loops}`);
  console.log(`  Output:  ${CONFIG.outputFile}`);
  console.log(`${'='.repeat(50)}\n`);

  console.log('Browser will close in 10 seconds...');
  await sleep(10000);
  await browser.close();
}

// ─── CLI ─────────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { registerOnce, CONFIG };
