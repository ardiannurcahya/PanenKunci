const { sleep } = require('./helpers');

// 2Captcha service reCAPTCHA solver
async function solveRecaptchaWith2captcha(page, apiKey) {
  let siteKey = null;

  try {
    siteKey = await page.$eval('[data-sitekey]', el => el.getAttribute('data-sitekey'));
  } catch (_) {}

  if (!siteKey) {
    try {
      siteKey = await page.$eval('script', s => {
        const m = s.textContent.match(/'sitekey'\s*:\s*'([^']+)'/);
        return m ? m[1] : null;
      });
    } catch (_) {}
  }

  if (!siteKey) {
    try {
      const scripts = await page.$$eval('script', els =>
        els.map(e => e.textContent).join('\n')
      );
      const m = scripts.match(/['"]sitekey['"]\s*:\s*['"]([^'"]+)['"]/);
      if (m) siteKey = m[1];
    } catch (_) {}
  }

  if (!siteKey) {
    console.log('  [WARN] Could not find reCAPTCHA sitekey');
    return false;
  }

  const pageUrl = page.url();
  console.log(`  Sending to 2captcha... (sitekey: ${siteKey.slice(0, 20)}...)`);

  const createResp = await fetch('https://api.2captcha.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'RecaptchaV2TaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    }),
  });
  const createData = await createResp.json();

  if (createData.errorId !== 0) {
    console.log(`  2captcha error: ${createData.errorDescription}`);
    return false;
  }

  const taskId = createData.taskId;
  console.log(`  Task created: ${taskId}, waiting for solution...`);

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await sleep(3000);
    const resultResp = await fetch('https://api.2captcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultResp.json();

    if (resultData.status === 'ready') {
      const token = resultData.solution.gRecaptchaResponse;
      console.log('  2captcha solved!');

      await page.$eval('#g-recaptcha-response', (el, tk) => { el.value = tk; }, token);
      await page.$eval('#g-recaptcha-response', (el, tk) => {
        el.value = tk;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof ___grecaptcha_cfg !== 'undefined' && ___grecaptcha_cfg.clients) {
          for (const key of Object.keys(___grecaptcha_cfg.clients)) {
            const client = ___grecaptcha_cfg.clients[key];
            const callback = client.W && client.W.callback;
            if (callback) callback(tk);
          }
        }
      }, token);
      await sleep(1000);
      return true;
    }

    if (resultData.errorId !== 0) {
      console.log(`  2captcha error: ${resultData.errorDescription}`);
      return false;
    }
  }

  console.log('  2captcha timeout');
  return false;
}

// Watch loop to detect Xiaomi captcha solution
async function waitForCaptchaSolved(page, maxWaitMs = 180000) {
  const pollMs = 2000;
  const deadline = Date.now() + maxWaitMs;
  const startUrl = page.url();

  await sleep(3000);

  while (Date.now() < deadline) {
    const currentUrl = page.url();
    if (currentUrl !== startUrl) {
      await sleep(500);
      return true;
    }

    const otpField = page.locator('input[maxlength="6"], input[maxlength="4"], input[placeholder*="code" i], input[placeholder*="OTP" i], input[placeholder*="verif" i]');
    if (await otpField.isVisible({ timeout: 500 }).catch(() => false)) {
      await sleep(500);
      return true;
    }

    try {
      const token = await page.$eval('#g-recaptcha-response', el => el.value);
      if (token && token.length > 0) {
        await sleep(1000);
        return true;
      }
    } catch (_) {}

    const recaptchaChecked = page.locator('.recaptcha-checked, #recaptcha-anchor[aria-checked="true"], .recaptcha-checkbox-checked');
    if (await recaptchaChecked.isVisible({ timeout: 500 }).catch(() => false)) {
      await sleep(1000);
      return true;
    }

    await sleep(pollMs);
  }
  return false;
}

// Watch loop to detect Qoder captcha solution (manual fallback)
async function waitForQoderCaptchaSolved(page, selectors, maxWaitMs = 180000) {
  const startUrl = page.url();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    if (page.url() !== startUrl) {
      console.log('  URL changed, captcha solved!');
      return true;
    }

    const otpField = page.locator(selectors.join(', '));
    if (await otpField.first().isVisible({ timeout: 300 }).catch(() => false)) {
      console.log('  OTP field appeared, captcha solved!');
      return true;
    }

    const allInputs = page.locator('input:visible');
    const inputCount = await allInputs.count();
    if (inputCount > 5) {
      console.log(`  New inputs detected (${inputCount}), likely past captcha`);
      return true;
    }
    await sleep(2000);
  }
  return false;
}

module.exports = {
  solveRecaptchaWith2captcha,
  waitForCaptchaSolved,
  waitForQoderCaptchaSolved,
};
