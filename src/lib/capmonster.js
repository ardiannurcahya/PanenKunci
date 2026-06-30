// CapMonster Cloud solver for Alibaba / Aliyun Captcha (token-based).
// Docs: https://capmonster.cloud (Alibaba Captcha task type).
//
// Unlike the old OpenCV solver (which physically dragged the slider),
// CapMonster returns a TOKEN that must be injected back into the AliyunCaptcha
// widget. Token injection is handled here; see INJECT_STRATEGIES below.

const { sleep } = require('./helpers');

const CAPMONSTER_API = 'https://api.capmonster.cloud';

// ─── createTask: submit an Alibaba captcha task to CapMonster ────────────
async function createTask(apiKey, task) {
  const res = await fetch(`${CAPMONSTER_API}/createTask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientKey: apiKey, task }),
  });
  const data = await res.json();
  if (data.errorId !== 0) {
    throw new Error(`CapMonster createTask error: ${data.errorDescription || data.errorCode || JSON.stringify(data)}`);
  }
  return data.taskId;
}

// ─── getTaskResult: poll until the captcha is solved ─────────────────────
async function getTaskResult(apiKey, taskId, { timeoutMs = 180000, pollMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const res = await fetch(`${CAPMONSTER_API}/getTaskResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const data = await res.json();
    if (data.errorId !== 0) {
      throw new Error(`CapMonster getTaskResult error: ${data.errorDescription || data.errorCode || JSON.stringify(data)}`);
    }
    if (data.status === 'ready') {
      return data.solution;
    }
    console.log(`  CapMonster: status="${data.status}", waiting ${pollMs / 1000}s...`);
  }
  throw new Error('CapMonster: timed out waiting for solution');
}

// ─── extractCaptchaConfig: find sceneId + prefix from the live page ──────
// AliyunCaptcha exposes its config in several places depending on the site's
// integration. We try multiple extraction strategies and use the first hit.
async function extractCaptchaConfig(page) {
  return await page.evaluate(() => {
    const out = { sceneId: null, prefix: null };

    // Strategy 1: global init config objects
    const globals = [
      window.__aliyunCaptchaConfig,
      window.AliyunCaptcha,
      window.aliyunCaptcha,
      window.captchaConfig,
    ];
    for (const g of globals) {
      if (g && g.sceneId) out.sceneId = g.sceneId;
      if (g && g.prefix) out.prefix = g.prefix;
    }

    // Strategy 2: any element carrying data-scene-id / data-prefix attributes
    const els = document.querySelectorAll('[data-scene-id], [data-prefix]');
    for (const el of els) {
      if (!out.sceneId) out.sceneId = el.getAttribute('data-scene-id');
      if (!out.prefix) out.prefix = el.getAttribute('data-prefix');
    }

    // Strategy 3: grep <script> contents for initAliyunCaptcha({ sceneId, prefix, ... })
    const re = /initAliyunCaptcha\s*\(\s*([\s\S]*?)\)\s*[;,)]/;
    const sceneRe = /sceneId\s*[:=]\s*["']([^"']+)["']/;
    const prefixRe = /prefix\s*[:=]\s*["']([^"']+)["']/;
    for (const s of document.querySelectorAll('script')) {
      const txt = s.textContent || '';
      if (!txt) continue;
      if (!out.sceneId) {
        const m = txt.match(sceneRe);
        if (m) out.sceneId = m[1];
      }
      if (!out.prefix) {
        const m = txt.match(prefixRe);
        if (m) out.prefix = m[1];
      }
      // also try to grab from the matched init block
      if (!out.sceneId || !out.prefix) {
        const block = txt.match(re);
        if (block) {
          if (!out.sceneId) {
            const m = block[1].match(sceneRe);
            if (m) out.sceneId = m[1];
          }
          if (!out.prefix) {
            const m = block[1].match(prefixRe);
            if (m) out.prefix = m[1];
          }
        }
      }
    }

    // Strategy 4: the aliyunCaptcha-* elements sometimes carry the sceneId in attributes / data
    const widget = document.querySelector('#aliyunCaptcha-window-float, [class*="aliyunCaptcha"]');
    if (widget) {
      if (!out.sceneId) out.sceneId = widget.getAttribute('data-scene') || widget.getAttribute('data-scene-id');
    }

    // Strategy 5: values captured by the network route intercept and injected
    // into window.__aliyunCaptchaNetworkConfig (see register_qoder.js context.route)
    const netCfg = window.__aliyunCaptchaNetworkConfig;
    if (netCfg) {
      if (!out.sceneId && netCfg.sceneId) out.sceneId = netCfg.sceneId;
      if (!out.prefix && netCfg.prefix) out.prefix = netCfg.prefix;
    }

    // Strategy 6: brute-force — search entire page HTML for sceneId pattern
    // (some integrations embed it in unexpected places like inline data attributes,
    // hidden inputs, or JSON blobs inside script tags)
    if (!out.sceneId) {
      const html = document.documentElement.innerHTML;
      const patterns = [
        /["']?(?:sceneId|SceneId|captchaSceneId|CaptchaSceneId)["']?\s*:\s*["']([a-zA-Z0-9_-]{4,})["']/i,
        /(?:sceneId|SceneId)["\s:=]+["']?([a-zA-Z0-9_-]{4,})/i,
      ];
      for (const p of patterns) {
        const m = html.match(p);
        if (m) { out.sceneId = m[1]; break; }
      }
    }

    // Also dump all script tag contents for sceneId in any JSON key
    if (!out.sceneId) {
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        // Look for JSON object with sceneId as a key (value might be adjacent), case-insensitive
        const jsonRe = /["']?(?:sceneId|SceneId)["']?\s*:\s*["']([a-zA-Z0-9_-]+)/i;
        const jm = t.match(jsonRe);
        if (jm) { out.sceneId = jm[1]; break; }
      }
    }

    // Strategy 7: read config captured by the initAliyunCaptcha setter hook
    if (!out.sceneId && window.__aliyunCaptchaConfig && window.__aliyunCaptchaConfig.sceneId) {
      out.sceneId = window.__aliyunCaptchaConfig.sceneId;
    }
    if (!out.prefix && window.__aliyunCaptchaConfig && window.__aliyunCaptchaConfig.prefix) {
      out.prefix = window.__aliyunCaptchaConfig.prefix;
    }

    // Debug dump: if sceneId still not found, log script tag snippets that mention captcha
    if (!out.sceneId) {
      const snippets = [];
      for (const s of document.querySelectorAll('script')) {
        const t = s.textContent || '';
        if (t && /captcha|sceneId|SceneId|prefix/i.test(t) && t.length < 5000) {
          snippets.push(t.slice(0, 300));
        }
      }
      out.__debug_scripts = snippets.slice(0, 3);
    }

    return out;
  });
}

// ─── injectToken: push the solved token back into the widget ─────────────
// The AliyunCaptcha SDK exposes a success({ captchaVerifyResult }) callback.
// We captured these via the initAliyunCaptcha hook:
//   getInstance, success, fail, onError
// We must ONLY call success (calling fail/onError triggers the failure alert!).
async function injectToken(page, tokens) {
  const tokenObj = typeof tokens === 'string' ? JSON.parse(tokens) : tokens;
  const tokenStr = typeof tokens === 'string' ? tokens : JSON.stringify(tokens);
  const injected = await page.evaluate(async ({ tokenStr, tokenObj }) => {
    const results = [];
    const cbs = window.__aliyunCaptchaCallbacks || {};

    // Strategy 1: call success callback with several possible arg formats.
    // AliyunCaptcha success typically expects { captchaVerifyParam: "<token string>" }
    // which is the JSON token string from the verify endpoint.
    if (typeof cbs.success === 'function') {
      const argFormats = [
        { captchaVerifyParam: tokenStr },                    // documented format
        { captchaVerifyResult: true, captchaVerifyParam: tokenStr },
        tokenStr,                                            // raw string
        tokenObj,                                            // raw object
      ];
      for (let i = 0; i < argFormats.length; i++) {
        try {
          const ret = await cbs.success(argFormats[i]);
          results.push('success[' + i + ']->' + JSON.stringify(ret).slice(0, 80));
          break;   // stop on first non-throwing call
        } catch (e) {
          results.push('success[' + i + ']-err:' + e.message);
        }
      }
    } else {
      results.push('no success callback');
    }

    // Strategy 2: use getInstance() to reach the SDK instance, then call its verify/success
    try {
      if (typeof cbs.getInstance === 'function') {
        const inst = cbs.getInstance();
        window.__aliyunCaptchaInstance = inst;
        results.push('getInstance: ' + (inst ? typeof inst : 'null'));
        if (inst) {
          // Try common instance methods that finalize a successful verify
          for (const m of ['success', 'verifySuccess', 'onVerifySuccess', 'showSuccess', 'verify', 'setCaptchaSuccess']) {
            if (typeof inst[m] === 'function') {
              try {
                await inst[m]({ captchaVerifyParam: tokenStr });
                results.push('inst.' + m);
                break;
              } catch (_) {}
            }
          }
          // List instance keys for debugging
          results.push('inst-keys:' + Object.keys(inst).filter(k => typeof inst[k] === 'function').join(','));
        }
      }
    } catch (e) { results.push('getInstance-err:' + e.message); }

    // Strategy 3: call the SDK global object methods (fallback)
    try {
      const ac = window.AliyunCaptcha || window.aliyunCaptcha;
      if (ac) {
        for (const m of ['success', 'verifySuccess', 'getCaptchaSuccess', 'handleSuccess']) {
          if (typeof ac[m] === 'function') {
            try { await ac[m]({ captchaVerifyParam: tokenStr }); results.push('ac.' + m); break; } catch (_) {}
          }
        }
      }
    } catch (e) { results.push('ac-err:' + e.message); }

    // Strategy 4: store token globally + dispatch events (last resort)
    try {
      window.__capmonsterToken = tokenStr;
      window.dispatchEvent(new CustomEvent('aliyun-captcha-success', { detail: tokenObj }));
      window.dispatchEvent(new CustomEvent('captcha-success', { detail: tokenObj }));
      results.push('global+event');
    } catch (e) { results.push('event-err:' + e.message); }

    return results;
  }, { tokenStr, tokenObj });
  console.log(`  Injection attempts: ${injected.join(' | ') || 'none'}`);
  return injected.length > 0;
}

// ─── verifySolved: confirm the widget closed / OTP field appeared ─────────
async function verifySolved(page, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Widget closed?
    const windowVisible = await page.locator('#aliyunCaptcha-window-float').first()
      .isVisible({ timeout: 500 }).catch(() => false);
    if (!windowVisible) return true;

    // OTP / code field appeared?
    const otpField = page.locator(
      'input.ant-otp-input, input[aria-label*="OTP"], input[size="1"], input[maxlength="6"], input[maxlength="4"]'
    ).first();
    if (await otpField.isVisible({ timeout: 500 }).catch(() => false)) return true;

    // More than ~5 inputs => likely advanced past captcha
    const inputCount = await page.locator('input:visible').count().catch(() => 0);
    if (inputCount > 5) return true;

    await sleep(500);
  }
  return false;
}

// ─── solveAliyunCaptcha: full pipeline ───────────────────────────────────
// page        — the Playwright page/tab where the captcha widget lives
// options     — { apiKey, websiteURL, userAgent, timeoutMs? }
async function solveAliyunCaptcha(page, options) {
  const { apiKey, websiteURL, userAgent } = options;
  const timeoutMs = options.timeoutMs || 180000;

  if (!apiKey) {
    console.log('  [WARN] No CAPMONSTER_API_KEY provided.');
    return false;
  }

  try {
    // 1. Extract config (sceneId + prefix) — retry for up to 15s because the
    //    Aliyun SDK loads config asynchronously after "Click to verify" is clicked.
    //    The network response listener (Node-level) and DOM strategies run in parallel.
    let cfg = { sceneId: null, prefix: null };
    const extractDeadline = Date.now() + 15000;
    while (Date.now() < extractDeadline && (!cfg.sceneId || !cfg.prefix)) {
      cfg = await extractCaptchaConfig(page);

      // Override with values from network response listener (Node-level, more reliable)
      if (options.networkConfig) {
        if (!cfg.sceneId && options.networkConfig.sceneId) cfg.sceneId = options.networkConfig.sceneId;
        if (!cfg.prefix && options.networkConfig.prefix) cfg.prefix = options.networkConfig.prefix;
      }

      if (!cfg.sceneId || !cfg.prefix) {
        await sleep(1000);  // wait for SDK to finish loading
      }
    }

    console.log(`  Config: sceneId="${cfg.sceneId}", prefix="${cfg.prefix}"`);
    if (!cfg.sceneId || !cfg.prefix) {
      console.log('  [WARN] Could not find sceneId/prefix after 15s. Falling back.');
      return false;
    }

    // 2. Submit to CapMonster
    const task = {
      type: 'CustomTask',
      class: 'alibaba',
      websiteURL,
      userAgent,
      metadata: { sceneId: cfg.sceneId, prefix: cfg.prefix },
    };
    console.log('  Submitting task to CapMonster...');
    const taskId = await createTask(apiKey, task);
    console.log(`  Task created: ${taskId}. Waiting for solution...`);

    // 3. Poll for result
    const solution = await getTaskResult(apiKey, taskId, { timeoutMs });
    const tokens = solution && solution.data && solution.data.tokens;
    if (!tokens) {
      console.log('  [WARN] CapMonster returned no tokens.');
      console.log(`  Solution: ${JSON.stringify(solution).slice(0, 300)}`);
      return false;
    }
    console.log(`  Token received (truncated): ${String(tokens).slice(0, 60)}...`);

    // 4. Inject the token back into the widget
    console.log('  Injecting token into AliyunCaptcha widget...');
    await injectToken(page, tokens);

    // 5. Verify success
    const solved = await verifySolved(page, 8000);
    if (solved) {
      console.log('  CapMonster captcha solved successfully!');
      return true;
    }

    // Retry injection once more after a short pause
    console.log('  First injection may not have worked, retrying...');
    await sleep(1000);
    await injectToken(page, tokens);
    const solved2 = await verifySolved(page, 8000);
    if (solved2) {
      console.log('  CapMonster captcha solved on retry!');
      return true;
    }

    console.log('  [WARN] Token injected but widget did not close. Manual fallback needed.');
    return false;

  } catch (e) {
    console.log(`  CapMonster solver error: ${e.message}`);
    return false;
  }
}

// ─── solveImageCaptcha: solve a text/image captcha via CapMonster ImageToTextTask ─
// imgLocator — Playwright Locator for the captcha <img> element
// page       — the Playwright page (used to fetch raw image + fill answer + submit)
// options    — { apiKey, retries?, timeoutMs?, inputSelector?, submitSelector? }
//
// Flow: fetch the raw image bytes from the <img src> URL (preserves cookies) →
// base64 → submit to CapMonster as ImageToTextTask → poll for result → fill
// the text input → click submit → verify the captcha image refreshed (wrong)
// or disappeared (correct) → retry on failure.
async function solveImageCaptcha(imgLocator, page, options) {
  const {
    apiKey,
    retries = 1,
    timeoutMs = 180000,
    inputSelector = '.mi-captcha-field input, input[name*="icode"]',
    submitSelector = 'button[type="submit"], button:has-text("Verify"), button:has-text("Confirm")',
  } = options;

  if (!apiKey) {
    console.log('  [WARN] No CAPMONSTER_API_KEY provided for image captcha.');
    return false;
  }

  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  for (let i = 0; i < retries; i++) {
    console.log(`  CapMonster ImageToText attempt ${i + 1}/${retries}...`);
    await sleep(1000);

    const debugPath = path.join(os.tmpdir(), `captcha_${Date.now()}.png`);
    try {
      // Extract the image data from the <img> element via canvas.
      // IMPORTANT: fetching the src URL again would generate a NEW captcha
      // (Xiaomi uses a cache-buster param `t=random`). Drawing the already-
      // loaded <img> to a canvas captures exactly what's on screen.
      const bodyBase64 = await imgLocator.evaluate((img) => {
        return new Promise((resolve, reject) => {
          try {
            if (!img.complete || img.naturalWidth === 0) {
              img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png').split(',')[1] || '');
              };
              img.onerror = () => reject(new Error('Image load error'));
            } else {
              const canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || img.width;
              canvas.height = img.naturalHeight || img.height;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              resolve(canvas.toDataURL('image/png').split(',')[1] || '');
            }
          } catch (e) {
            reject(e);
          }
        });
      }).catch(() => null);

      // Fallback: screenshot the element if canvas extraction failed
      if (!bodyBase64) {
        console.log('  Canvas extraction failed, falling back to screenshot...');
        await imgLocator.screenshot({ path: debugPath });
        const imgBuffer = fs.readFileSync(debugPath);
        bodyBase64 = imgBuffer.toString('base64');
      } else {
        // Save debug copy
        fs.writeFileSync(debugPath, Buffer.from(bodyBase64, 'base64'));
      }

      console.log(`  Image size: ${Math.round(bodyBase64.length * 3 / 4)} bytes`);

      // Submit to CapMonster as ImageToTextTask (no CapMonsterModule — let
      // CapMonster auto-detect the best engine)
      const taskId = await createTask(apiKey, {
        type: 'ImageToTextTask',
        body: bodyBase64,
        Case: true,
        Numeric: false,
        Math: false,
      });
      console.log(`  Task created: ${taskId}. Waiting for solution...`);

      // Poll for result
      const solution = await getTaskResult(apiKey, taskId, { timeoutMs });
      const code = (solution && solution.text || '').trim().replace(/[^a-zA-Z0-9]/g, '');
      console.log(`  CapMonster result: "${code}"`);

      if (code.length < 3 || code.length > 8) {
        console.log('  Invalid code length, retrying...');
        continue;
      }

      // Fill the answer into the input
      const input = page.locator(inputSelector).first();
      const inputFound = await input.isVisible({ timeout: 1000 }).catch(() => false);
      if (!inputFound) {
        console.log('  [WARN] Captcha input not found, retrying...');
        continue;
      }
      await input.focus();
      await input.fill('');
      await input.pressSequentially(code, { delay: 100 });
      await input.dispatchEvent('input', { bubbles: true });
      await input.dispatchEvent('change', { bubbles: true });
      await sleep(500);
      console.log(`  Filled captcha input with: "${code}"`);

      // Some Xiaomi captchas auto-verify on input — check if image refreshed
      await sleep(500);
      if (!(await imgLocator.isVisible({ timeout: 500 }).catch(() => false))) {
        console.log('  Captcha auto-verified!');
        return true;
      }

      // Click submit — try multiple selectors, prioritizing specific captcha containers
      const allSubmitSelectors = [
        '.mi-captcha-field button',
        '.mi-captcha-field button:has-text("Submit")',
        '.mi-captcha-field button:has-text("Confirm")',
        '.mi-captcha-field a',
        '.mi-dialog button:has-text("Submit")',
        '.mi-modal button:has-text("Submit")',
        '.mi-dialog button:has-text("Confirm")',
        '.mi-modal button:has-text("Confirm")',
        submitSelector,
        'button:has-text("Submit")',
        'button:has-text("OK")',
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button:has-text("Register")',
        'button:has-text("Confirm")',
        'button:has-text("Verify")',
        'button[type="submit"]',
        'input[type="submit"]',
      ];
      let submitClicked = false;
      for (const sel of allSubmitSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
          if (await btn.isEnabled().catch(() => false)) {
            await btn.click();
            submitClicked = true;
            console.log(`  Clicked submit via: ${sel}`);
            break;
          } else {
            console.log(`  Submit button ${sel} is visible but disabled, skipping...`);
          }
        }
      }

      // Fallback: press Enter on the input
      if (!submitClicked) {
        console.log('  No enabled submit button found, pressing Enter on input...');
        await input.press('Enter');
        submitClicked = true;
      }

      if (submitClicked) {
        await sleep(2000);

        // If the captcha image is gone, we succeeded
        if (!(await imgLocator.isVisible({ timeout: 1000 }).catch(() => false))) {
          return true;
        }
        console.log('  Wrong answer, retrying...');
      }
    } catch (e) {
      console.log(`  CapMonster ImageToText error: ${e.message}`);
    } finally {
      try { fs.unlinkSync(debugPath); } catch (_) {}
    }
  }
  return false;
}

module.exports = {
  createTask,
  getTaskResult,
  extractCaptchaConfig,
  injectToken,
  verifySolved,
  solveAliyunCaptcha,
  solveImageCaptcha,
};
