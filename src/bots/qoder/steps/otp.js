// Step 9: Wait for the OTP email, then fill it into the page using whichever
// OTP-input strategy the site uses (Ant Design split inputs, single field,
// iframe, textarea, or a last-resort fallback).

const { sleep, rand, fillHuman, humanMouseMove, clickFirst, snap, saveResult } = require('./_shared');

async function stepInputOtp(ctx) {
  const { oauthPage, tag, tempmail, email, CONFIG } = ctx;
  console.log(`${tag} [9/9] Waiting for OTP email...`);
  console.log(`  Email used: ${email}`);
  console.log(`  Timeout: ${CONFIG.otpTimeout / 1000}s, polling every 3s`);
  await snap(oauthPage, `${ctx.runIndex}_09_otp_wait_start`);

  // Pre-check: maybe email already arrived while solving captcha
  const existingMsgs = await tempmail.getMessages(email).catch(() => []);
  if (existingMsgs.length > 0) {
    console.log(`  Found ${existingMsgs.length} existing email(s) already in inbox!`);
  }

  // Move mouse randomly while waiting (avoid looking idle)
  const mouseInterval = setInterval(async () => {
    try { await humanMouseMove(oauthPage); } catch (_) {}
  }, rand(3000, 6000));

  // Try polling for 45s first
  let otp = await tempmail.waitForOtp(email, 45000, 3000);

  if (!otp) {
    console.log('  OTP not received in first 45 seconds. Looking for Resend button...');
    await snap(oauthPage, `${ctx.runIndex}_08_otp_not_received_resending`);

    const resendClicked = await clickFirst(oauthPage, [
      'button:has-text("Resend")',
      'a:has-text("Resend")',
      'button:has-text("resend")',
      'button:has-text("Send again")',
      'span:has-text("Resend")',
      'text="Resend"',
      'text="Resend code"',
      'text="Send code again"',
    ], 'Resend code button', 5000);

    if (resendClicked) {
      console.log('  Resend button clicked successfully! Waiting for OTP again (up to 90 seconds)...');
      await sleep(2000);
      otp = await tempmail.waitForOtp(email, 90000, 3000);
    } else {
      console.log('  Resend button not found or not visible. Continuing to poll for another 90 seconds...');
      otp = await tempmail.waitForOtp(email, 90000, 3000);
    }
  }

  clearInterval(mouseInterval);

  if (!otp) {
    console.log('  TIMEOUT: No OTP received.');
    await snap(oauthPage, `${ctx.runIndex}_08_otp_timeout`);
    saveResult(CONFIG.outputFile, {
      firstName: ctx.firstName,
      lastName: ctx.lastName,
      email,
      password: CONFIG.password,
      status: 'otp_timeout',
    });
    return false;
  }

  console.log(`  OTP received: ${otp}`);

  // Wait for OTP page to fully settle
  await sleep(rand(2000, 3000));

  // Check iframes too (OTP field might be inside one)
  const pagesToCheck = [oauthPage];
  const frames = oauthPage.frames();
  for (const frame of frames) {
    if (frame !== oauthPage.mainFrame()) pagesToCheck.push(frame);
  }

  // Debug: screenshot current page state
  await snap(oauthPage, `${ctx.runIndex}_08_otp_page_before_fill`);

  // List ALL visible inputs across all frames for debugging
  const allInputs = oauthPage.locator('input:visible');
  const inputCount = await allInputs.count();
  console.log(`  Main page: ${inputCount} visible input(s)`);
  for (let i = 0; i < inputCount; i++) {
    const inp = allInputs.nth(i);
    const type = await inp.getAttribute('type').catch(() => '');
    const name = await inp.getAttribute('name').catch(() => '');
    const placeholder = await inp.getAttribute('placeholder').catch(() => '');
    const maxlength = await inp.getAttribute('maxlength').catch(() => '');
    console.log(`    [${i}] type="${type}" name="${name}" placeholder="${placeholder}" maxlength="${maxlength}"`);
  }

  // Also check iframes
  for (const frame of pagesToCheck.slice(1)) {
    const frameInputs = frame.locator('input:visible');
    const frameCount = await frameInputs.count().catch(() => 0);
    if (frameCount > 0) {
      console.log(`  Iframe: ${frameCount} visible input(s)`);
      for (let i = 0; i < frameCount; i++) {
        const inp = frameInputs.nth(i);
        const type = await inp.getAttribute('type').catch(() => '');
        const name = await inp.getAttribute('name').catch(() => '');
        console.log(`    iframe[${i}] type="${type}" name="${name}"`);
      }
    }
  }

  // Also check for textarea, contenteditable, or custom OTP components
  const textareas = oauthPage.locator('textarea:visible');
  const taCount = await textareas.count();
  if (taCount > 0) console.log(`  Found ${taCount} visible textarea(s)`);

  const editables = oauthPage.locator('[contenteditable="true"]:visible');
  const edCount = await editables.count();
  if (edCount > 0) console.log(`  Found ${edCount} visible contenteditable(s)`);

  // Strategy 1: Multiple single-char inputs (split OTP — 6 boxes)
  let otpFilled = false;

  const splitSelectors = [
    'input.ant-otp-input:visible',
    'input[aria-label*="OTP Input"]:visible',
    'input:visible[size="1"]',
    'input:visible[maxlength="1"]',
  ];

  for (const sel of splitSelectors) {
    const splitInputs = oauthPage.locator(sel);
    const splitCount = await splitInputs.count();
    if (splitCount >= 4) {
      console.log(`  Strategy 1: split across ${splitCount} inputs via "${sel}"`);
      for (let i = 0; i < Math.min(splitCount, otp.length); i++) {
        await splitInputs.nth(i).fill(otp[i]);
        await sleep(rand(80, 200));
      }
      otpFilled = true;
      break;
    }
  }

  // Strategy 2: Known OTP selectors on main page
  if (!otpFilled) {
    const otpSel = [
      'input[maxlength="6"]', 'input[maxlength="4"]', 'input[maxlength="8"]',
      'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
      'input[placeholder*="verif" i]', 'input[placeholder*="pin" i]',
      'input[name*="code" i]', 'input[name*="otp" i]',
      'input[name*="verif" i]', 'input[name*="token" i]',
      'input[type="tel"]', 'input[autocomplete="one-time-code"]',
      'input[type="number"]',
    ];
    for (const sel of otpSel) {
      const el = oauthPage.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        await fillHuman(oauthPage, el, otp);
        console.log(`  Strategy 2: filled via selector "${sel}"`);
        otpFilled = true;
        break;
      }
    }
  }

  // Strategy 3: Check iframes for OTP input
  if (!otpFilled) {
    for (const frame of pagesToCheck.slice(1)) {
      const otpSel = [
        'input[maxlength="6"]', 'input[maxlength="4"]',
        'input[type="tel"]', 'input[type="number"]',
        'input[name*="code" i]', 'input[name*="otp" i]',
      ];
      for (const sel of otpSel) {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
          await el.fill(otp);
          console.log(`  Strategy 3: filled OTP in iframe via "${sel}"`);
          otpFilled = true;
          break;
        }
      }
      if (otpFilled) break;
    }
  }

  // Strategy 4: Textarea or contenteditable
  if (!otpFilled && taCount > 0) {
    await textareas.first().fill(otp);
    console.log('  Strategy 4: filled OTP in textarea');
    otpFilled = true;
  }

  // Strategy 5: Fallback — fill ANY visible input that's not password/email/hidden/submit
  if (!otpFilled) {
    console.log('  Strategy 5: fallback — last non-password/email input');
    for (let i = inputCount - 1; i >= 0; i--) {
      const inp = allInputs.nth(i);
      const type = (await inp.getAttribute('type').catch(() => '') || '').toLowerCase();
      if (type === 'password' || type === 'email' || type === 'hidden' || type === 'submit') continue;
      await fillHuman(oauthPage, inp, otp);
      console.log(`  Fallback: filled input[${i}] type="${type}"`);
      otpFilled = true;
      break;
    }
  }

  if (!otpFilled) {
    console.log('  [WARN] Could not find ANY OTP input field on page or iframes!');
    console.log('  >>> Please input OTP manually. Waiting 60s...');
    await sleep(60000);
  }

  // OTP auto-submits after filling — no need to click
  await sleep(rand(3000, 5000));
  await snap(oauthPage, `${ctx.runIndex}_08b_after_otp`);

  // Success!
  console.log(`${tag} Registration appears successful!`);
  saveResult(CONFIG.outputFile, {
    firstName: ctx.firstName,
    lastName: ctx.lastName,
    email,
    password: CONFIG.password,
    status: 'registered',
  });
  return true;
}

module.exports = {
  stepInputOtp,
};
