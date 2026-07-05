// Step 8: Click "Verify", then solve the Aliyun captcha.
//
// Solver order:
//   captchaMode === 'capmonster' -> CapMonster API (token injection)
//      └─ on failure -> manual fallback (wait for user to solve in browser)
//   captchaMode === 'manual'     -> manual only

const { solveAliyunCaptcha } = require('../../../lib/capmonster');
const { waitForQoderCaptchaSolved } = require('../../../lib/captcha');
const { sleep, rand, clickFirst, snap } = require('./_shared');

// Manual fallback selectors (same as the original flow).
const MANUAL_OTP_SELECTORS = [
  'input.ant-otp-input', 'input[aria-label*="OTP"]',
  'input[size="1"]', 'input[maxlength="6"]', 'input[maxlength="4"]',
  'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
  'input[type="tel"]',
];

async function stepVerifyCaptcha(ctx) {
  const { oauthPage, tag, CONFIG, capturedConfig } = ctx;
  console.log(`${tag} [8/9] Verification step...`);
  await clickFirst(oauthPage, [
    'text="Click to verify"', 'text="click to verify"', 'text="Click to Verify"',
    'button:has-text("verify")', 'button:has-text("Verify")',
    '[class*="verify"]', '[class*="captcha"]',
    'text="Verify"', 'text="Start verification"',
  ], 'Click to verify', 5000);

  await sleep(rand(2000, 3000));
  await snap(oauthPage, `${ctx.runIndex}_07_verify_clicked`);

  // Log what network intercept captured (helps debugging)
  console.log(`  Network intercepted config: sceneId="${capturedConfig?.sceneId}", prefix="${capturedConfig?.prefix}"`);

  let solved = false;

  if (CONFIG.captchaMode === 'capmonster') {
    console.log('  Solving with CapMonster (Alibaba captcha)...');
    solved = await solveAliyunCaptcha(oauthPage, {
      apiKey: CONFIG.capmonsterApiKey,
      websiteURL: oauthPage.url(),
      userAgent: CONFIG.userAgent,
      timeoutMs: CONFIG.capmonsterTimeout,
      networkConfig: capturedConfig,   // override from network intercept
    });

    if (!solved) {
      console.log('  >>> CapMonster failed. Falling back to MANUAL solving (180s)...');
      solved = await waitForQoderCaptchaSolved(oauthPage, MANUAL_OTP_SELECTORS, 180000);
    }
  } else {
    // Manual mode
    console.log('  >>> CAPTCHA: Solve the slider captcha MANUALLY in the browser.');
    console.log('  >>> Bot will auto-detect when solved. Waiting up to 180 seconds...');
    solved = await waitForQoderCaptchaSolved(oauthPage, [
      'input[maxlength="6"]', 'input[maxlength="4"]', 'input[maxlength="8"]',
      'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
      'input[placeholder*="verif" i]', 'input[placeholder*="pin" i]',
      'input[name*="code" i]', 'input[name*="otp" i]',
      'input[name*="verif" i]', 'input[name*="token" i]',
      'input[type="number"]', 'input[type="tel"]',
      'input[autocomplete="one-time-code"]',
    ], 180000);
  }

  if (!solved) {
    console.log('  [WARN] Timeout waiting for captcha. Proceeding anyway...');
  }

  await sleep(rand(2000, 3000));
  await snap(oauthPage, `${ctx.runIndex}_07b_after_captcha`);
}

module.exports = {
  stepVerifyCaptcha,
  MANUAL_OTP_SELECTORS,
};
