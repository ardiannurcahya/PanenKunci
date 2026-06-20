// Load Environment Variables
const { loadEnv } = require('./utils/env.js');
loadEnv();

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(StealthPlugin);

const TempMail = require('./tempmail.js');

// Import modular utilities and captcha solvers
const {
  sleep,
  rand,
  typeHumanQoder,
  fillHuman,
  humanMouseMove,
  humanScroll,
  clickFirst,
  handleCookies: handleCookiesBase
} = require('./utils/helpers.js');

const typeHuman = typeHumanQoder; // alias to match legacy naming
const handleCookies = (page) => handleCookiesBase(page, 1000);

const {
  randomFirstName,
  randomLastName
} = require('./utils/names.js');

const {
  solvePuzzleCaptchaWithPython,
  solveSliderCaptcha,
  waitForQoderCaptchaSolved
} = require('./utils/captcha.js');

// Screenshot disabled
async function snap() {}

// ─── CONFIG ──────────────────────────────────────────────
const CONFIG = {
  // Platform URL
  platformUrl: process.env.PLATFORM_URL,
  // Qoder provider page
  qoderUrl: process.env.QODER_URL,
  // Output file
  outputFile: path.join(__dirname, 'keys.csv'),
  // Platform password (for first-time access)
  platformPassword: process.env.PLATFORM_PASSWORD,
  // Password for Qoder accounts
  password: process.env.QODER_ACCOUNT_PASSWORD,
  // Timeouts (ms)
  otpTimeout: 180000,
  navigateTimeout: 30000,
  // Number of registration loops
  loops: 5,
  // Captcha mode: 'manual' | 'auto' (auto = try puzzle solver → slider → manual fallback)
  captchaMode: 'auto',
  // Proxy (optional)
  proxy: process.env.PROXY || '',
};

// helpers, name database, clickFirst, and puzzle/slider solvers are now imported from ./utils/

// ─── HANDLE PLATFORM PASSWORD ────────────────────────────
async function handlePlatformPassword(page) {
  // Check if there's a password prompt (first-time access)
  const passwordSelectors = [
    'input[type="password"]',
    'input[name*="password" i]',
    'input[placeholder*="password" i]',
    'input[placeholder*="Password" i]',
  ];

  for (const sel of passwordSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
      console.log('  Platform password prompt detected, entering password...');
      await el.fill(CONFIG.platformPassword);
      await sleep(500);

      // Click submit button
      await clickFirst(page, [
        'button:has-text("Submit")',
        'button:has-text("Enter")',
        'button:has-text("Login")',
        'button:has-text("Continue")',
        'button:has-text("OK")',
        'button[type="submit"]',
      ], 'Password submit', 2000);

      await sleep(rand(2000, 3000));
      console.log('  Platform password submitted');
      return true;
    }
  }
  return false; // No password prompt
}

// Cookies handler is now imported from ./utils/helpers.js

// ─── SAVE RESULT TO CSV ──────────────────────────────────
function saveResult(data) {
  const csvHeaders = 'timestamp,platform,first_name,last_name,email,password,status';
  const csvRow = [
    new Date().toISOString(),
    'qoder',
    data.firstName,
    data.lastName,
    data.email,
    data.password,
    data.status || 'registered',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

  const csvPath = CONFIG.outputFile;
  const exists = fs.existsSync(csvPath);
  if (!exists) {
    fs.writeFileSync(csvPath, csvHeaders + '\n', 'utf8');
  }
  fs.appendFileSync(csvPath, csvRow + '\n', 'utf8');
  console.log(`  Saved to: ${csvPath}`);
}

// ─── SINGLE REGISTRATION FLOW ────────────────────────────
async function registerOnce(dashPage, context, runIndex) {
  const tag = `[Run ${runIndex}]`;
  let oauthPage = null;

  try {
    // Step 1: Navigate to platform, handle login, then go to Qoder
    console.log(`${tag} [1/8] Navigating to platform...`);
    await dashPage.goto(CONFIG.platformUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await handleCookies(dashPage);
    await sleep(rand(2000, 3500));

    // Handle platform password (only appears first time)
    const hadPassword = await handlePlatformPassword(dashPage);

    if (hadPassword) {
      // After login, wait for dashboard to fully load
      console.log('  Waiting for dashboard to load after login...');
      await dashPage.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
      await sleep(rand(3000, 5000));
    }

    // Navigate to Qoder provider page
    console.log(`${tag} [2/8] Navigating to Qoder page...`);
    await dashPage.goto(CONFIG.qoderUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await sleep(rand(2000, 3000));
    await snap(dashPage, `${runIndex}_02_qoder_page`);

    // Step 2: Click "Add" button (opens new tab)
    console.log(`${tag} [3/9] Clicking Add button...`);

    const [newTab] = await Promise.all([
      context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
      clickFirst(dashPage, [
        'button:has-text("Add")',
        'a:has-text("Add")',
        'button:has-text("add")',
        'button:has-text("Add Account")',
        'button:has-text("Add account")',
        'button:has-text("Tambah")',
        '[class*="add" i]',
        'button:has-text("+")',
      ], 'Add button', 5000),
    ]);

    if (!newTab) {
      await snap(dashPage, `${runIndex}_02_no_new_tab`);
      throw new Error('Add button did not open new tab');
    }

    oauthPage = newTab;
    await oauthPage.waitForLoadState('domcontentloaded');
    await sleep(rand(2000, 3000));
    await snap(oauthPage, `${runIndex}_02_new_tab`);
    console.log('  New tab opened, switched to OAuth page');

    // Step 4: Handle OAuth page — click "Sign in with another account" → "Sign up"
    console.log(`${tag} [4/9] Handling OAuth page...`);
    await sleep(rand(2000, 3000));
    await snap(oauthPage, `${runIndex}_03_oauth_page`);

    // Click "Sign in with another account" if visible
    await clickFirst(oauthPage, [
      'text="Sign in with another account"',
      'text="Sign in with a different account"',
      'text="Use another account"',
      'a:has-text("another account")',
      'button:has-text("another account")',
      'text="Sign in with another"',
    ], 'Sign in with another account', 3000);

    await sleep(rand(1500, 3000));
    await snap(oauthPage, `${runIndex}_03b_after_another_account`);

    // Click "Sign up"
    const signUpClicked = await clickFirst(oauthPage, [
      'text="Sign up"',
      'a:has-text("Sign up")',
      'button:has-text("Sign up")',
      'text="Sign Up"',
      'a:has-text("Sign Up")',
      'a:has-text("Create account")',
      'a:has-text("Register")',
      '[href*="signup" i]',
      '[href*="register" i]',
      'text="Create an account"',
      'text="Don\'t have an account"',
    ], 'Sign up link', 5000);

    if (!signUpClicked) {
      await snap(oauthPage, `${runIndex}_03c_no_signup`);
      throw new Error('Sign up link not found');
    }
    await sleep(rand(2000, 4000));
    await snap(oauthPage, `${runIndex}_03c_signup_page`);

    // Step 4: Create temp email + random names
    console.log(`${tag} [5/9] Creating temporary email...`);
    const tempmail = new TempMail();
    const inbox = await tempmail.createInbox();
    const email = inbox.address;
    const firstName = randomFirstName();
    const lastName = randomLastName();
    console.log(`  Email: ${email}`);
    console.log(`  Name: ${firstName} ${lastName}`);

    // Step 5: Fill registration form (First Name, Last Name, Email, Terms)
    console.log(`${tag} [6/9] Filling registration form...`);

    // Wait for form fields to be ready
    await sleep(rand(1500, 2500));

    // First Name
    let filled = false;
    for (const sel of [
      'input[name*="first" i]', 'input[name*="firstName" i]', 'input[name*="first_name" i]',
      'input[name*="given" i]', 'input[placeholder*="First" i]', 'input[id*="first" i]',
      'input[autocomplete="given-name"]',
    ]) {
      const el = oauthPage.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await fillHuman(oauthPage, el, firstName);
        filled = true;
        console.log(`  First Name filled (${sel})`);
        break;
      }
    }
    if (!filled) {
      const textInputs = oauthPage.locator('input[type="text"], input:not([type])');
      if (await textInputs.count() >= 3) {
        await textInputs.nth(0).fill(firstName);
        console.log('  First Name filled (fallback: 1st text input)');
      }
    }
    await sleep(rand(300, 600));

    // Last Name
    filled = false;
    for (const sel of [
      'input[name*="last" i]', 'input[name*="lastName" i]', 'input[name*="last_name" i]',
      'input[name*="family" i]', 'input[name*="surname" i]', 'input[placeholder*="Last" i]',
      'input[id*="last" i]', 'input[autocomplete="family-name"]',
    ]) {
      const el = oauthPage.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await fillHuman(oauthPage, el, lastName);
        filled = true;
        console.log(`  Last Name filled (${sel})`);
        break;
      }
    }
    if (!filled) {
      const textInputs = oauthPage.locator('input[type="text"], input:not([type])');
      if (await textInputs.count() >= 3) {
        await textInputs.nth(1).fill(lastName);
        console.log('  Last Name filled (fallback: 2nd text input)');
      }
    }
    await sleep(rand(300, 600));

    // Email
    filled = false;
    for (const sel of [
      'input[type="email"]', 'input[name*="email" i]', 'input[name*="mail" i]',
      'input[placeholder*="email" i]', 'input[placeholder*="Email" i]',
      'input[id*="email" i]', 'input[autocomplete="email"]',
    ]) {
      const el = oauthPage.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await fillHuman(oauthPage, el, email);
        filled = true;
        console.log(`  Email filled (${sel})`);
        break;
      }
    }
    if (!filled) {
      const textInputs = oauthPage.locator('input[type="text"], input:not([type])');
      if (await textInputs.count() >= 3) {
        await textInputs.nth(2).fill(email);
        console.log('  Email filled (fallback: 3rd text input)');
      }
    }
    await sleep(rand(300, 600));

    // Verify email was filled correctly
    const emailField = oauthPage.locator('input[type="email"], input[name*="email" i], input[autocomplete="email"]').first();
    if (await emailField.isVisible({ timeout: 300 }).catch(() => false)) {
      const emailValue = await emailField.inputValue().catch(() => '');
      if (emailValue !== email) {
        console.log(`  [WARN] Email mismatch! Expected: ${email}, Got: ${emailValue}. Re-filling...`);
        await emailField.fill(email);
      } else {
        console.log(`  Email verified: ${emailValue}`);
      }
    }

    // Terms checkbox — only check the box, don't click ToS text/link
    const allCheckboxes = oauthPage.locator('input[type="checkbox"]');
    const cbCount = await allCheckboxes.count();
    for (let i = 0; i < cbCount; i++) {
      const cb = allCheckboxes.nth(i);
      if (await cb.isVisible({ timeout: 300 }).catch(() => false)) {
        if (!(await cb.isChecked().catch(() => false))) {
          await cb.check();
          console.log(`  Checkbox #${i} checked`);
        }
      }
    }

    await sleep(rand(800, 2000));
    await humanMouseMove(oauthPage);
    await sleep(rand(300, 800));
    await snap(oauthPage, `${runIndex}_05_form_filled`);

    // Click Continue
    console.log(`${tag} [6/9] Clicking Continue...`);
    await clickFirst(oauthPage, [
      'button:has-text("Continue")', 'button:has-text("Next")',
      'button:has-text("Submit")', 'button:has-text("Create")',
      'button[type="submit"]', 'input[type="submit"]',
    ], 'Continue button', 3000);

    await sleep(rand(2000, 4000));
    await snap(oauthPage, `${runIndex}_05b_after_continue`);

    // Step 6: Enter password
    console.log(`${tag} [7/9] Entering password...`);
    filled = false;
    for (const sel of [
      'input[type="password"]', 'input[name*="password" i]', 'input[name*="pass" i]',
      'input[placeholder*="password" i]', 'input[placeholder*="Password" i]',
      'input[id*="password" i]',
    ]) {
      const el = oauthPage.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await fillHuman(oauthPage, el, CONFIG.password);
        filled = true;
        console.log(`  Password filled (${sel})`);
        break;
      }
    }

    // Confirm password (if exists)
    const pwFields = oauthPage.locator('input[type="password"]');
    if (await pwFields.count() > 1) {
      await pwFields.nth(1).fill(CONFIG.password);
      console.log('  Confirm password filled');
    }

    await sleep(rand(500, 1000));
    await snap(oauthPage, `${runIndex}_06_password`);

    // Click Continue again
    console.log(`${tag} [7/9] Clicking Continue (password step)...`);
    await clickFirst(oauthPage, [
      'button:has-text("Continue")', 'button:has-text("Next")',
      'button:has-text("Submit")', 'button:has-text("Create")',
      'button:has-text("Sign up")', 'button[type="submit"]',
    ], 'Continue button (password)', 3000);

    await sleep(rand(2000, 4000));
    await snap(oauthPage, `${runIndex}_06b_after_password`);

    // Step 7: Click to verify + solve slider captcha
    console.log(`${tag} [8/9] Verification step...`);
    await clickFirst(oauthPage, [
      'text="Click to verify"', 'text="click to verify"', 'text="Click to Verify"',
      'button:has-text("verify")', 'button:has-text("Verify")',
      '[class*="verify"]', '[class*="captcha"]',
      'text="Verify"', 'text="Start verification"',
    ], 'Click to verify', 5000);

    await sleep(rand(2000, 3000));
    await snap(oauthPage, `${runIndex}_07_verify_clicked`);

    // Handle captcha based on mode
    if (CONFIG.captchaMode === 'manual') {
      console.log('  >>> CAPTCHA: Solve the slider captcha MANUALLY in the browser.');
      console.log('  >>> Bot will auto-detect when solved. Waiting up to 180 seconds...');
      const solved = await waitForQoderCaptchaSolved(oauthPage, [
        'input[maxlength="6"]', 'input[maxlength="4"]', 'input[maxlength="8"]',
        'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
        'input[placeholder*="verif" i]', 'input[placeholder*="pin" i]',
        'input[name*="code" i]', 'input[name*="otp" i]',
        'input[name*="verif" i]', 'input[name*="token" i]',
        'input[type="number"]', 'input[type="tel"]',
        'input[autocomplete="one-time-code"]',
      ], 180000);

      if (!solved) {
        console.log('  [WARN] Timeout waiting for captcha. Proceeding anyway...');
      }
    } else {
      // Auto mode: try puzzle solver → slider → manual fallback
      console.log('  Trying auto-solve...');

      // Quick check: do puzzle images exist?
      const hasPuzzleImages = await (async () => {
        for (const sel of ['#aliyunCaptcha-puzzle', '#aliyunCaptcha-img.puzzle']) {
          if (!(await oauthPage.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false))) return false;
        }
        return true;
      })();

      // Quick check: does a slider exist?
      const hasSlider = await (async () => {
        for (const sel of ['#aliyunCaptcha-sliding-slider', '[class*="slider"]', '[class*="sliding"]']) {
          if (await oauthPage.locator(sel).first().isVisible({ timeout: 500 }).catch(() => false)) return true;
        }
        return false;
      })();

      let captchaSolved = false;

      // Try 1: Puzzle captcha (only if puzzle images exist)
      if (hasPuzzleImages && hasSlider) {
        console.log('  Puzzle images + slider detected, trying OpenCV solver...');
        captchaSolved = await solvePuzzleCaptchaWithPython(oauthPage);
      } else {
        console.log('  No puzzle images found, skipping OpenCV solver.');
      }

      // Try 2: Simple slider drag (only if slider exists and puzzle failed)
      if (!captchaSolved && hasSlider && !hasPuzzleImages) {
        console.log('  Slider detected (no puzzle), trying simple drag...');
        captchaSolved = await solveSliderCaptcha(oauthPage);
      }

      // Fallback: Manual (immediate — don't disturb the page)
      if (!captchaSolved) {
        console.log('  >>> CAPTCHA: Solve MANUALLY in the browser. Waiting up to 180s...');
        await waitForQoderCaptchaSolved(oauthPage, [
          'input.ant-otp-input', 'input[aria-label*="OTP"]',
          'input[size="1"]', 'input[maxlength="6"]', 'input[maxlength="4"]',
          'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
          'input[type="tel"]',
        ], 180000);
      }
    }

    await sleep(rand(2000, 3000));
    await snap(oauthPage, `${runIndex}_07b_after_captcha`);

    // Step 8: Input OTP
    console.log(`${tag} [9/9] Waiting for OTP email...`);
    console.log(`  Email used: ${email}`);
    console.log(`  Timeout: ${CONFIG.otpTimeout / 1000}s, polling every 3s`);
    await snap(oauthPage, `${runIndex}_09_otp_wait_start`);

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
      await snap(oauthPage, `${runIndex}_08_otp_not_received_resending`);

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
      await snap(oauthPage, `${runIndex}_08_otp_timeout`);
      saveResult({ firstName, lastName, email, password: CONFIG.password, status: 'otp_timeout' });
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
    await snap(oauthPage, `${runIndex}_08_otp_page_before_fill`);

    // List ALL visible inputs across all frames for debugging
    let allInputs = oauthPage.locator('input:visible');
    let inputCount = await allInputs.count();
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

    // Try: Ant OTP component (ant-otp-input) or size="1" or maxlength="1"
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
    await snap(oauthPage, `${runIndex}_08b_after_otp`);

    // Success!
    console.log(`${tag} Registration appears successful!`);
    saveResult({ firstName, lastName, email, password: CONFIG.password, status: 'registered' });
    return true;

  } catch (err) {
    console.error(`${tag} ERROR: ${err.message}`);
    if (oauthPage) await snap(oauthPage, `${runIndex}_error`);
    return false;
  } finally {
    // Don't close OAuth tab — let platform sync first
    // Tabs stay open until browser closes at the end
    console.log(`${tag} Done. Tab stays open.`);
  }
}

// ─── MAIN LOOP ───────────────────────────────────────────
async function main() {
  console.log('=== Qoder Auto-Registration Bot ===');
  console.log(`Loops: ${CONFIG.loops}`);
  console.log(`Password: ${CONFIG.password}`);
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
    console.log(`  Proxy: ${CONFIG.proxy}`);
  }
  const browser = await chromium.launch(launchOpts);

  // Randomize viewport slightly
  const vpWidth = 1366 + rand(-20, 20);
  const vpHeight = 768 + rand(-10, 10);

  const contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: vpWidth, height: vpHeight },
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
  };
  const context = await browser.newContext(contextOpts);

  // Anti-bot: remove webdriver flag + patch chrome properties
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
  });

  // Open persistent dashboard tab (stays open across all loops)
  const dashPage = await context.newPage();

  let successCount = 0;
  let failCount = 0;

  for (let i = 1; i <= CONFIG.loops; i++) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  REGISTRATION LOOP ${i} / ${CONFIG.loops}`);
    console.log(`${'='.repeat(50)}\n`);

    const success = await registerOnce(dashPage, context, i);
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
