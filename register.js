const { chromium } = require('playwright');
const TempMail = require('./tempmail.js');

const fs = require('fs');
const path = require('path');

const CONFIG = {
  // Xiaomi registration URL (from your referral link)
  registerUrl: 'https://global.account.xiaomi.com/fe/service/register?_group=DEFAULT&_locale=en&region=US&sid=api-platform&_uRegion=ID',
  // Console URL after login
  consoleUrl: 'https://platform.xiaomimimo.com/console',
  // API key name
  apiKeyName: 'auto-' + Date.now().toString(36),
  // Output file for API key
  outputFile: path.join(__dirname, 'test.txt'),
  // User config
  password: 'PortoAuto2025!',
  region: 'Indonesia',
  // Timeouts (ms)
  emailTimeout: 120000,
  otpTimeout: 180000,
  navigateTimeout: 15000,
  // Captcha mode: 'manual' | '2captcha'
  captchaMode: 'manual',
  captchaApiKey: '',
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function handleCookies(page) {
  await sleep(1500);

  const buttonSelectors = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept all cookies")',
    'button:has-text("Allow all")',
    'button:has-text("Allow All")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
    'button:has-text("OK")',
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'a:has-text("Accept all")',
    '[class*="cookie"] button:has-text("Accept")',
    '[class*="cookie"] button:has-text("OK")',
    '[aria-label*="cookies"] button',
    '#onetrust-accept-btn-handler',
    '.cookie-accept',
  ];

  for (const selector of buttonSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
      await btn.click();
      console.log('  Cookies accepted');
      await sleep(500);
      return;
    }
  }
}

async function handleTermsAgreement(page) {
  await sleep(2000);

  // Check if terms agreement text is on the page
  const termsIndicators = [
    'I agree to use the model',
    'Open Platform Agreement',
    'Privacy Policy',
    'terms and condition',
    'Agree',
  ];

  let hasTerms = false;
  for (const text of termsIndicators) {
    const el = page.locator(`text="${text}"`).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      hasTerms = true;
      break;
    }
  }

  if (!hasTerms) {
    console.log('  No terms agreement detected, skipping...');
    return;
  }

  console.log('  Terms agreement detected!');

  // Check the agreement checkbox
  const checkboxSelectors = [
    'input[type="checkbox"]',
    '[class*="checkbox"] input',
    '[class*="agree"] input',
    'input[name*="agree" i]',
  ];
  let checked = false;
  for (const selector of checkboxSelectors) {
    const cb = page.locator(selector).first();
    if (await cb.isVisible({ timeout: 500 }).catch(() => false)) {
      if (!(await cb.isChecked().catch(() => false))) {
        await cb.check();
      }
      checked = true;
      console.log('  Agreement checkbox: checked');
      break;
    }
  }

  // Fallback: click the label/text directly
  if (!checked) {
    const labelEl = page.locator('label:has-text("I agree"), label:has-text("Agree"), span:has-text("I agree")').first();
    if (await labelEl.isVisible({ timeout: 500 }).catch(() => false)) {
      await labelEl.click();
      console.log('  Agreement label clicked');
      checked = true;
    }
  }

  await sleep(500);

  // Click Confirm/Agree/Submit button
  const confirmSelectors = [
    'button:has-text("Confirm")',
    'button:has-text("Agree")',
    'button:has-text("Accept")',
    'button:has-text("Submit")',
    'button:has-text("Continue")',
    'button:has-text("Next")',
    'button[type="submit"]',
  ];
  for (const selector of confirmSelectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 500 }).catch(() => false)) {
      await btn.click();
      console.log('  Terms confirmed');
      await sleep(2000);
      return;
    }
  }

  console.log('  [WARN] Confirm button not found, proceeding anyway...');
}

async function waitForCaptchaSolved(page, maxWaitMs = 120000) {
  const pollMs = 2000;
  const deadline = Date.now() + maxWaitMs;
  const startUrl = page.url();

  while (Date.now() < deadline) {
    // Signal 1: URL changed (form submitted, redirect in progress)
    const currentUrl = page.url();
    if (currentUrl !== startUrl) {
      await sleep(500);
      return true;
    }

    // Signal 2: OTP / verification input appeared
    const otpField = page.locator('input[maxlength="6"], input[maxlength="4"], input[placeholder*="code" i], input[placeholder*="OTP" i], input[placeholder*="verif" i]');
    if (await otpField.isVisible({ timeout: 500 }).catch(() => false)) {
      await sleep(500);
      return true;
    }

    // Signal 3: Known captcha iframe was visible, now gone
    const captchaFrame = page.locator('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"], [class*="captcha"] iframe');
    const captchaWasHere = await captchaFrame.isVisible({ timeout: 500 }).catch(() => false);
    if (!captchaWasHere) {
      // No known captcha iframe — maybe custom captcha, check for form state change
      const submitBtn = page.locator('button[type="submit"]:not([disabled])').first();
      const stillClickable = await submitBtn.isVisible({ timeout: 500 }).catch(() => false);
      if (!stillClickable) {
        await sleep(500);
        return true;
      }
    }

    await sleep(pollMs);
  }
  return false;
}

async function register() {
  console.log('[1/11] Launching browser...');
  const browser = await chromium.launch({
    headless: false, // need visible browser for captcha
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  try {
    // Step 1: Create temp email
    console.log('[2/11] Creating temporary email...');
    const tempmail = new TempMail();
    const inbox = await tempmail.createInbox();
    const email = inbox.address;
    console.log(`  Email: ${email}`);

    // Step 2: Navigate to registration page
    console.log('[3/11] Navigating to registration page...');
    await page.goto(CONFIG.registerUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await handleCookies(page);
    await sleep(2000);

    // Step 3: Select region (skipped - auto-detected from _uRegion param)
    console.log('[4/11] Region auto-detected (via URL param), skipping manual selection...');

    // Step 4: Fill email
    console.log('[5/11] Filling registration form...');
    const emailInput = page.locator('input[type="text"]').first()
      .or(page.locator('input[name*="email" i], input[name*="account" i], input[placeholder*="email" i], input[placeholder*="Email" i], input[placeholder*="account" i], input[type="email"]').first());
    await emailInput.fill(email);
    await sleep(500);

    // Fill password
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(CONFIG.password);
    await sleep(300);

    // Fill confirm password
    if (await passwordInputs.count() > 1) {
      await passwordInputs.nth(1).fill(CONFIG.password);
      await sleep(300);
    }

    // Agree to terms checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible()) {
      const isChecked = await checkbox.isChecked();
      if (!isChecked) {
        await checkbox.check();
      }
      console.log('  Terms checkbox: checked');
    }

    // Take screenshot for debugging
    await page.screenshot({ path: 'before_submit.png' });
    console.log('  Screenshot saved: before_submit.png');

    // Step 5: Submit and handle captcha
    console.log('[6/11] Submitting form (captcha may appear)...');
    const submitBtn = page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Next"), button:has-text("Create"), a:has-text("Register")').first();
    await submitBtn.click();
    await sleep(3000);

    // Handle captcha
    if (CONFIG.captchaMode === 'manual') {
      console.log('  >>> CAPTCHA: Please solve the captcha manually in the browser.');
      console.log('  >>> Auto-detecting when solved...');

      // Poll until captcha is solved (max 120s)
      const captchaSolved = await waitForCaptchaSolved(page, 120000);
      if (captchaSolved) {
        console.log('  Captcha solved! Continuing...');
      } else {
        console.log('  [WARN] Captcha detection timeout, proceeding anyway...');
      }
    } else {
      // 2captcha logic (placeholder)
      console.log('  Captcha auto-solve not implemented');
    }

    // Step 7: Wait for OTP email
    console.log('[7/11] Waiting for OTP email...');
    const otp = await tempmail.waitForOtp(email, CONFIG.otpTimeout, 5000);

    if (!otp) {
      console.log('  TIMEOUT: No OTP received. Check browser manually.');
      console.log('  Browser stays open for manual intervention.');
      await page.screenshot({ path: 'timeout.png' });
      // Don't close browser so user can intervene
      await new Promise(() => {}); // Keep alive
      return;
    }

    console.log(`  OTP received: ${otp}`);

    // Fill OTP
    const otpInputs = page.locator('input[maxlength="6"], input[maxlength="4"], input[type="number"], input[placeholder*="code" i], input[placeholder*="OTP" i], input[placeholder*="verif" i]');
    if (await otpInputs.count() >= 6) {
      // Split OTP across 6 inputs
      for (let i = 0; i < 6; i++) {
        await otpInputs.nth(i).fill(otp[i]);
        await sleep(100);
      }
    } else {
      // Single OTP input
      const otpInput = otpInputs.first();
      if (await otpInput.isVisible()) {
        await otpInput.fill(otp);
      }
    }
    await sleep(500);

    // Submit OTP
    const otpSubmit = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Submit"), button:has-text("Confirm")').first();
    await otpSubmit.click();
    await sleep(3000);

    // Step 8: Handle terms & agreements after OTP
    console.log('[8/11] Checking terms & agreements...');
    await handleTermsAgreement(page);

    // Step 9: Navigate to platform console
    console.log('[9/11] Navigating to platform console...');
    await page.goto(CONFIG.consoleUrl, { waitUntil: 'networkidle', timeout: CONFIG.navigateTimeout });
    await handleCookies(page);
    await sleep(3000);

    // Check again for terms (might appear after redirect)
    await handleTermsAgreement(page);

    await page.screenshot({ path: 'registered.png' });
    console.log('  Landed on platform console');

    // Step 10: Create API Key
    console.log('[10/11] Creating API Key...');

    // Try common API key page URLs
    const apiKeyPaths = ['/apikey', '/developer/apikey', '/settings/apikey', '/developer', '/keys', '/settings'];
    let foundApiPage = false;

    // First try: find sidebar/header link
    const apiTabSelectors = [
      'a:has-text("API")',
      'button:has-text("API")',
      'a:has-text("Key")',
      'a:has-text("Developer")',
      'a:has-text("Settings")',
      '[href*="apikey" i]',
      '[href*="api-key" i]',
      '[href*="developer" i]',
      '[href*="settings" i]',
    ];
    for (const selector of apiTabSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click();
        await sleep(2000);
        foundApiPage = true;
        console.log(`  Found nav link via: ${selector}`);
        break;
      }
    }

    // Fallback: try direct URLs
    if (!foundApiPage) {
      for (const p of apiKeyPaths) {
        const url = CONFIG.consoleUrl + p;
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: 8000 });
          await handleCookies(page);
          await sleep(1500);
          foundApiPage = true;
          console.log(`  Navigated to: ${url}`);
          break;
        } catch (_) {}
      }
    }

    await page.screenshot({ path: 'api_keys_page.png' });
    await sleep(1000);

    // Click "Create" or "New" button
    const createBtnSelectors = [
      'button:has-text("Create API Key")',
      'button:has-text("Create")',
      'button:has-text("New API")',
      'button:has-text("New")',
      'button:has-text("Add")',
      'a:has-text("Create")',
      'a:has-text("New")',
      'span:has-text("Create")',
      '[class*="create" i]',
      '[class*="add" i]',
      'button',
    ];
    let createBtn = null;
    for (const selector of createBtnSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        createBtn = el;
        break;
      }
    }
    if (createBtn) {
      await createBtn.click();
      await sleep(1500);
      console.log('  Create API Key dialog opened');
    } else {
      console.log('  [WARN] Create button not found');
      await page.screenshot({ path: 'no_create_btn.png' });
    }

    // Fill API key name in modal/input
    const nameInputSelectors = [
      'input[placeholder*="name" i]',
      'input[placeholder*="Name" i]',
      'input[placeholder*="key" i]',
      'input[placeholder*="label" i]',
      'input[name*="name" i]',
      'input[name*="label" i]',
      'input[type="text"]',
    ];
    let nameInput = null;
    for (const selector of nameInputSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        nameInput = el;
        break;
      }
    }
    if (nameInput) {
      await nameInput.fill('');
      await nameInput.fill(CONFIG.apiKeyName);
      console.log(`  API Key name: ${CONFIG.apiKeyName}`);
      await sleep(500);
    } else {
      console.log('  [WARN] Name input not found');
    }

    // Confirm via modal button
    const confirmSelectors = [
      'button:has-text("Confirm")',
      'button:has-text("OK")',
      'button:has-text("Create")',
      'button:has-text("Submit")',
      'button:has-text("Save")',
      'button[type="submit"]',
      '.modal button:has-text("OK")',
      '.dialog button:has-text("Confirm")',
      'button:has-text("Yes")',
    ];
    let confirmBtn = null;
    for (const selector of confirmSelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        confirmBtn = el;
        break;
      }
    }
    if (confirmBtn) {
      await confirmBtn.click();
      await sleep(2000);
      console.log('  API Key creation confirmed');
    }
    await page.screenshot({ path: 'api_key_created.png' });

    // Step 10: Extract and save the API key
    console.log('[11/11] Extracting API Key...');
    let apiKey = '';

    // Try to find the API key value on the page
    const keySelectors = [
      'code',
      'pre',
      '[class*="key"] code',
      '[class*="secret"]',
      '[class*="token"]',
      'input[readonly]',
      'input:has-text("sk-")',
      'input[value*="sk-"]',
      '[class*="apikey"] code',
      '.copyable',
    ];
    for (const selector of keySelectors) {
      const el = page.locator(selector).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        const text = await el.textContent().catch(() => '');
        if (text && text.trim().length > 10) {
          apiKey = text.trim();
          break;
        }
      }
    }

    // Fallback: try to read from input value
    if (!apiKey) {
      const readonlyInput = page.locator('input[readonly]').first();
      if (await readonlyInput.isVisible({ timeout: 500 }).catch(() => false)) {
        apiKey = await readonlyInput.inputValue().catch(() => '');
      }
    }

    // Fallback: try clipboard (some sites auto-copy)
    if (!apiKey) {
      try {
        apiKey = await page.evaluate(() => navigator.clipboard.readText());
      } catch (_) {}
    }

    // Save to file
    const outputData = [
      `# Auto Register - Generated ${new Date().toISOString()}`,
      `Email: ${email}`,
      `Password: ${CONFIG.password}`,
      `API Key Name: ${CONFIG.apiKeyName}`,
      `API Key: ${apiKey || 'NOT FOUND - check screenshot api_key_created.png'}`,
      '',
    ].join('\n');

    fs.appendFileSync(CONFIG.outputFile, outputData + '\n', 'utf8');
    console.log(`  Saved to: ${CONFIG.outputFile}`);

    console.log('\n========================================');
    console.log('  REGISTRATION SUMMARY');
    console.log('========================================');
    console.log(`  Email:      ${email}`);
    console.log(`  Password:   ${CONFIG.password}`);
    console.log(`  API Key:    ${apiKey || 'check api_key_created.png'}`);
    console.log(`  Saved to:   ${CONFIG.outputFile}`);
    console.log('========================================\n');
    console.log('Browser will close in 30 seconds...');
    await sleep(30000);

  } catch (err) {
    console.error('ERROR:', err.message);
    await page.screenshot({ path: 'error.png' });
    console.log('Error screenshot saved: error.png');
    await sleep(10000);
  } finally {
    await browser.close();
  }
}

// CLI
if (require.main === module) {
  register().catch(console.error);
}

module.exports = { register, CONFIG };
