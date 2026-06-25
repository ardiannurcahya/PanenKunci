const { loadEnv } = require('./utils/env.js');
loadEnv();

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(StealthPlugin);

const TempMail = require('./tempmail.js');
const fs = require('fs');
const path = require('path');

const { sleep, rand, handleCookies, humanMouseMove, humanScroll } = require('./utils/helpers.js');
const { solveAliyunCaptcha } = require('./utils/capmonster.js');

const CONFIG = {
  registerUrl: 'https://account.alibabacloud.com/register/intl_register.htm',
  consoleUrl: 'https://modelstudio.console.alibabacloud.com',
  password: process.env.ALIBABA_PASSWORD || 'AlibabaAuto2025!',
  outputFile: path.join(__dirname, 'alibaba.csv'),
  emailTimeout: 120000,
  otpTimeout: 180000,
  navigateTimeout: 30000,
  proxy: process.env.PROXY || '',
  capmonsterApiKey: process.env.CAPMONSTER_API_KEY || '',
};

async function register() {
  console.log('[1/9] Launching browser...');
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
      '--disable-gpu',
    ],
  };

  const wx = process.env.WINDOW_X;
  const wy = process.env.WINDOW_Y;
  if (wx !== undefined && wy !== undefined) {
    launchOpts.args.push(`--window-position=${wx},${wy}`);
  }
  const ww = process.env.WINDOW_WIDTH;
  const wh = process.env.WINDOW_HEIGHT;
  if (ww !== undefined && wh !== undefined) {
    launchOpts.args.push(`--window-size=${ww},${wh}`);
  }

  if (CONFIG.proxy) {
    launchOpts.proxy = { server: CONFIG.proxy };
    console.log(`  Proxy: ${CONFIG.proxy.split('@').pop() || CONFIG.proxy}`);
  }
  const browser = await chromium.launch(launchOpts);

  // Randomize viewport slightly
  const vpWidth = 1366 + rand(-30, 30);
  const vpHeight = 768 + rand(-20, 20);

  const contextOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: vpWidth, height: vpHeight },
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
  };
  const context = await browser.newContext(contextOpts);

  // Observe AliyunCaptcha network responses for CapMonster solver
  const capturedConfig = { sceneId: null, prefix: null };
  const findSceneId = (text) => {
    if (!text) return null;
    const patterns = [
      /["']?(?:sceneId|SceneId|captchaSceneId|CaptchaSceneId)["']?\s*:\s*["']([a-zA-Z0-9_-]{4,})["']/i,
      /(?:sceneId|SceneId)["\s:=]+["']?([a-zA-Z0-9_-]{4,})/i,
      /[?&](?:sceneId|SceneId|sid)=([a-zA-Z0-9_-]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m) return m[1];
    }
    return null;
  };

  context.on('response', async (response) => {
    try {
      const url = response.url();
      if (!/aliyuncs\.com|aliyunCaptcha|captcha-open/i.test(url)) return;

      const prefixMatch = url.match(/https?:\/\/([a-z0-9]+)\.(?:captcha-open[a-z-]*\.)*aliyuncs\.com/i);
      if (prefixMatch && !capturedConfig.prefix) {
        capturedConfig.prefix = prefixMatch[1];
        console.log(`  [observe] Aliyun prefix: ${capturedConfig.prefix}`);
      }

      const urlSid = findSceneId(url);
      if (urlSid && !capturedConfig.sceneId) {
        capturedConfig.sceneId = urlSid;
        console.log(`  [observe] Aliyun sceneId (from URL): ${capturedConfig.sceneId}`);
      }

      const ct = response.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text') || ct.includes('javascript') || ct.includes('html')) {
        const body = await response.text().catch(() => '');
        if (body) {
          const bodySid = findSceneId(body);
          if (bodySid && !capturedConfig.sceneId) {
            capturedConfig.sceneId = bodySid;
            console.log(`  [observe] Aliyun sceneId (from body): ${capturedConfig.sceneId}`);
          }
        }
      }
    } catch (_) {}
  });

  // Anti-fingerprint init script
  await context.addInitScript(() => {
    // 1. Remove webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete navigator.__proto__.webdriver;

    // 2. Fake plugins (realistic count)
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ];
        plugins.length = 3;
        return plugins;
      },
    });

    // 3. Fake languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en', 'id'],
    });

    // 4. Patch chrome runtime
    window.chrome = {
      runtime: {
        PlatformOs: { MAC: 'mac', WIN: 'win', ANDROID: 'android', CROS: 'cros', LINUX: 'linux', OPENBSD: 'openbsd' },
        PlatformArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        PlatformNaclArch: { ARM: 'arm', X86_32: 'x86-32', X86_64: 'x86-64', MIPS: 'mips', MIPS64: 'mips64' },
        RequestUpdateCheckStatus: { THROTTLED: 'throttled', NO_UPDATE: 'no_update', UPDATE_AVAILABLE: 'update_available' },
        OnInstalledReason: { INSTALL: 'install', UPDATE: 'update', CHROME_UPDATE: 'chrome_update', SHARED_MODULE_UPDATE: 'shared_module_update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
      },
    };

    // 5. Patch permissions
    const origQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (params) =>
      params.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : origQuery(params);

    // 6. WebGL fingerprint spoofing
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      // UNMASKED_VENDOR_WEBGL
      if (param === 37445) return 'Google Inc. (Intel)';
      // UNMASKED_RENDERER_WEBGL
      if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameter.call(this, param);
    };

    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Google Inc. (Intel)';
      if (param === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
      return getParameter2.call(this, param);
    };

    // 7. Canvas fingerprint noise
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (type) {
      if (type === 'image/png' && this.width > 16 && this.height > 16) {
        const ctx = this.getContext('2d');
        if (ctx) {
          const imageData = ctx.getImageData(0, 0, this.width, this.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            // Add tiny noise to RGB (not alpha)
            imageData.data[i] += rand(-1, 1);
            imageData.data[i + 1] += rand(-1, 1);
            imageData.data[i + 2] += rand(-1, 1);
          }
          ctx.putImageData(imageData, 0, 0);
        }
      }
      return origToDataURL.apply(this, arguments);
    };

    // 8. AudioContext fingerprint noise
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const osc = origCreateOscillator.call(this);
      const origStart = osc.start;
      osc.start = function () {
        // Add tiny frequency offset
        try { osc.frequency.value += 0.0000001; } catch (_) {}
        return origStart.apply(this, arguments);
      };
      return osc;
    };

    // 9. Screen color depth consistency
    Object.defineProperty(screen, 'colorDepth', { get: () => 24 });

    // 10. Hardware concurrency (realistic)
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });

    // 11. Device memory
    Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });

    // 12. Connection type
    if (navigator.connection) {
      Object.defineProperty(navigator.connection, 'rtt', { get: () => 50 });
    }
  });

  const page = await context.newPage();

  try {
    // Step 1: Create temp email
    console.log('[2/9] Creating temporary email...');
    const tempmail = new TempMail();
    const inbox = await tempmail.createInbox();
    const email = inbox.address;
    console.log(`  Email: ${email}`);

    // Step 2: Navigate to registration page
    console.log('[3/9] Opening Alibaba Cloud registration page...');
    await page.goto(CONFIG.registerUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await handleCookies(page);
    // Human-like: wait for page to settle + random idle browsing
    await sleep(rand(4000, 7000));
    await humanMouseMove(page);
    await sleep(rand(1000, 2000));

    // The registration form lives inside an iframe: #alibaba-register-box
    const frame = page.frameLocator('#alibaba-register-box');

    // Step 3: Click "Individual Account" label (human reaction time)
    console.log('[4/9] Selecting Individual Account...');
    await sleep(rand(2000, 4000)); // "reading the page"
    await humanMouseMove(page);
    await sleep(rand(500, 1500));
    await frame.locator('label').filter({ hasText: 'Individual Account' }).click();
    console.log('  Clicked: Individual Account label');
    await sleep(rand(1500, 3000));

    // Step 4: Click "Next" (human pauses to review selection)
    console.log('[5/9] Clicking Next...');
    await sleep(rand(1500, 3500));
    await frame.getByRole('link', { name: 'Next' }).click();
    console.log('  Clicked: Next');
    // Wait for form to load (human reads new page)
    await sleep(rand(3000, 6000));
    await humanMouseMove(page);
    await sleep(rand(1000, 2000));

    // Step 5: Fill registration form (email, password, confirm password)
    console.log('[6/9] Filling registration form...');

    // Fill email (click first, then type)
    const emailField = frame.getByRole('textbox', { name: 'Email Address *' });
    await emailField.click();
    await sleep(rand(500, 1000));
    // Type email character by character (human-like)
    for (const char of email) {
      await emailField.press(char);
      await sleep(rand(30, 120));
    }
    console.log(`  Email filled: ${email}`);
    await sleep(rand(800, 1500));

    // Fill password
    const pwField = frame.locator('.next-form-item.next-medium.FormItem.account__form > .next-form-item-control > .next-input input').first();
    await pwField.click();
    await sleep(rand(300, 800));
    for (const char of CONFIG.password) {
      await pwField.press(char);
      await sleep(rand(40, 150));
    }
    console.log('  Password filled');
    await sleep(rand(600, 1200));

    // Fill confirm password
    const confirmPwField = frame.getByRole('textbox', { name: 'Confirm Password*' });
    await confirmPwField.click();
    await sleep(rand(300, 800));
    for (const char of CONFIG.password) {
      await confirmPwField.press(char);
      await sleep(rand(40, 150));
    }
    console.log('  Confirm password filled');
    await sleep(rand(1000, 2500));

    // Scroll a bit (human behavior)
    await humanScroll(page);
    await sleep(rand(500, 1500));

    // Step 6: Click "Sign Up (Step 1 of 2)"
    console.log('[7/9] Clicking Sign Up...');
    await sleep(rand(2000, 4000)); // "reviewing form before submit"
    await frame.getByRole('button', { name: 'Sign Up (Step 1 of 2)' }).click();
    console.log('  Clicked: Sign Up (Step 1 of 2)');
    // Wait longer for captcha to load (human waits for page response)
    await sleep(rand(5000, 8000));

    // Handle Baxia slider captcha if it appears
    // Captcha is nested: #alibaba-register-box iframe -> #baxia-dialog-content iframe
    console.log('  Checking for slider captcha...');
    const captchaFrame = frame.frameLocator('#baxia-dialog-content');

    try {
      await captchaFrame.getByText('Please slide to verify').waitFor({ state: 'visible', timeout: 15000 });
      console.log('  Slider captcha detected! Solving...');

      let solved = false;
      if (CONFIG.capmonsterApiKey) {
        console.log('  Solving via CapMonster token injection...');
        // Find the actual iframe containing the aliyunCaptcha script/callbacks
        const targetFrame = page.frames().find(f => f.url().includes('nocaptcha') || f.url().includes('baxia')) || page;
        solved = await solveAliyunCaptcha(targetFrame, {
          apiKey: CONFIG.capmonsterApiKey,
          websiteURL: page.url(),
          userAgent: contextOpts.userAgent,
          networkConfig: capturedConfig,
        });
      }

      if (solved) {
        console.log('  CapMonster captcha solved successfully!');
      } else {
        if (CONFIG.capmonsterApiKey) {
          console.log('  [WARN] CapMonster failed. Falling back to mouse drag simulation...');
        } else {
          console.log('  [WARN] CapMonster API key not configured. Using mouse drag simulation...');
        }

        // Human reaction: quick glance at captcha
        await sleep(rand(800, 1500));

        // The slider button: <span id="nc_1_n1z" class="nc_iconfont btn_slide">
        const slider = captchaFrame.locator('#nc_1_n1z');
        const box = await slider.boundingBox();

        if (box) {
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;

          // Get actual track width from .nc_scale container
          const track = captchaFrame.locator('.nc_scale').first();
          const trackBox = await track.boundingBox();
          const trackWidth = trackBox ? trackBox.width - box.width - 5 : 350;

          // Quick move to slider (not slow curve)
          await page.mouse.move(startX, startY, { steps: rand(3, 6) });
          await sleep(rand(150, 300));

          await page.mouse.down();
          await sleep(rand(50, 120));

          // Fast, clean drag — 300-500ms total (human speed)
          const totalSteps = rand(12, 18);
          const duration = rand(300, 500);
          let lastX = startX;

          for (let i = 1; i <= totalSteps; i++) {
            const progress = i / totalSteps;
            // Simple ease-out: fast start, slight decel at end
            const eased = 1 - Math.pow(1 - progress, 1.5);

            let x = startX + trackWidth * eased + rand(-1, 1);
            let y = startY + rand(-1, 1);

            if (x > startX + trackWidth + 2) x = startX + trackWidth;

            await page.mouse.move(x, y);
            lastX = x;
            await sleep(Math.round(duration / totalSteps));
          }

          // Tiny overshoot + snap back (fast, natural)
          await page.mouse.move(lastX + rand(2, 4), startY);
          await sleep(rand(30, 60));
          await page.mouse.move(lastX, startY);
          await sleep(rand(40, 80));

          await page.mouse.up();
          console.log('  Slider dragged!');
        } else {
          console.log('  [WARN] Slider bounding box not found');
        }
      }

      // Wait for captcha verification
      await sleep(rand(2000, 3500));
    } catch (_) {
      console.log('  No slider captcha detected, continuing...');
    }

    // Step 7: Verification — click email tab, then "Send"
    console.log('[8/9] Handling email verification...');
    await sleep(rand(2000, 4000));
    await humanMouseMove(page);
    await sleep(rand(500, 1500));

    // The verification form is in passport.alibabacloud.com frame
    // Find it among all frames
    let passportFrame = null;
    for (const f of page.frames()) {
      const url = f.url();
      if (url.includes('passport.alibabacloud.com') && url.includes('enter_fill_email')) {
        passportFrame = f;
        console.log(`  Found passport frame: ${url.slice(0, 80)}`);
        break;
      }
    }

    if (!passportFrame) {
      console.log('  [WARN] Passport frame not found, trying all frames...');
      for (const f of page.frames()) {
        const sendTest = f.locator('button.next-btn.next-btn-primary');
        if (await sendTest.count().catch(() => 0) > 0) {
          passportFrame = f;
          console.log(`  Found frame with buttons: ${f.url().slice(0, 80)}`);
          break;
        }
      }
    }

    // Click email tab (2nd tab in passport frame or main iframe)
    console.log('  Selecting email verification tab...');
    let tabClicked = false;

    if (passportFrame) {
      const tabs = passportFrame.locator('li[role="tab"]');
      const tabCount = await tabs.count().catch(() => 0);
      console.log(`  Found ${tabCount} tabs in passport frame`);
      if (tabCount >= 2) {
        await tabs.nth(1).click();
        tabClicked = true;
        console.log('  Clicked: tab[1] in passport frame');
      }
    }

    // Fallback: try main iframe
    if (!tabClicked) {
      const tabs = frame.locator('li[role="tab"]');
      const tabCount = await tabs.count().catch(() => 0);
      if (tabCount >= 2) {
        await tabs.nth(1).click();
        tabClicked = true;
        console.log('  Clicked: tab[1] in main iframe');
      }
    }
    await sleep(rand(1500, 3000));

    // Click "Send" button (inside #emailCaptcha wrapper in passport frame)
    console.log('  Clicking Send...');
    let sendClicked = false;

    if (passportFrame) {
      // The button is inside the #emailCaptcha input wrapper
      const sendSelectors = [
        '#emailCaptcha ~ .next-input-inner button.next-btn',
        '.next-input-inner.next-after button.next-btn',
        'button.next-btn.next-btn-primary',
        'button.next-btn:has-text("Send")',
        'button:has-text("Send")',
      ];
      for (const sel of sendSelectors) {
        const btn = passportFrame.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await btn.click();
          sendClicked = true;
          console.log(`  Clicked: Send (${sel})`);
          break;
        }
      }
    }

    // Fallback: try all frames with any button containing "Send"
    if (!sendClicked) {
      for (const f of page.frames()) {
        const btn = f.locator('button:has-text("Send")').first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          sendClicked = true;
          console.log(`  Clicked: Send in frame ${f.url().slice(0, 50)}`);
          break;
        }
      }
    }

    if (!sendClicked) {
      console.log('  [WARN] Send button not found! Trying click by coordinates...');
      // Last resort: click the Send button by position (inside #emailCaptcha)
      if (passportFrame) {
        const inputWrapper = passportFrame.locator('#emailCaptcha').first();
        if (await inputWrapper.isVisible({ timeout: 1000 }).catch(() => false)) {
          const box = await inputWrapper.boundingBox();
          if (box) {
            // Button is on the right side of the input
            await page.mouse.click(box.x + box.width - 30, box.y + box.height / 2);
            sendClicked = true;
            console.log('  Clicked: Send by coordinates (right side of input)');
          }
        }
      }
    }
    await sleep(rand(3000, 5000));

    // Wait for OTP email
    console.log('  Waiting for OTP email...');
    // Move mouse randomly while waiting
    const mouseInterval = setInterval(async () => {
      try { await humanMouseMove(page); } catch (_) {}
    }, rand(5000, 10000));

    const otp = await tempmail.waitForOtp(email, CONFIG.otpTimeout, 3000);
    clearInterval(mouseInterval);

    if (!otp) {
      console.log('  TIMEOUT: No OTP received. Check browser manually.');
      console.log('  Browser stays open for manual intervention.');
      await new Promise(() => {});
      return;
    }

    console.log(`  OTP received: ${otp}`);

    // Human reaction: read the email, then type
    await sleep(rand(3000, 5000));

    // Fill OTP into #emailCaptcha — try passport frame first
    console.log('  Filling OTP...');
    let otpFilled = false;

    if (passportFrame) {
      const otpInput = passportFrame.locator('#emailCaptcha');
      if (await otpInput.isVisible({ timeout: 5000 }).catch(() => false)) {
        await otpInput.click();
        await sleep(rand(300, 600));
        for (const char of otp) {
          await otpInput.press(char);
          await sleep(rand(80, 200));
        }
        otpFilled = true;
        console.log(`  OTP filled into #emailCaptcha (passport frame): ${otp}`);
      }
    }

    // Fallback: try all frames
    if (!otpFilled) {
      for (const f of page.frames()) {
        const fOtp = f.locator('#emailCaptcha');
        if (await fOtp.isVisible({ timeout: 1000 }).catch(() => false)) {
          await fOtp.click();
          await sleep(rand(300, 600));
          for (const char of otp) {
            await fOtp.press(char);
            await sleep(rand(80, 200));
          }
          otpFilled = true;
          console.log(`  OTP filled in frame ${f.url().slice(0, 50)}: ${otp}`);
          break;
        }
      }
    }

    // Fallback: try main iframe
    if (!otpFilled) {
      const mainIframeOtp = frame.locator('#emailCaptcha');
      if (await mainIframeOtp.isVisible({ timeout: 2000 }).catch(() => false)) {
        await mainIframeOtp.click();
        await sleep(rand(300, 600));
        for (const char of otp) {
          await mainIframeOtp.press(char);
          await sleep(rand(80, 200));
        }
        otpFilled = true;
        console.log(`  OTP filled in main iframe: ${otp}`);
      }
    }

    // Fallback: generic selectors
    if (!otpFilled) {
      console.log('  #emailCaptcha not found, trying generic selectors...');
      otpFilled = await fillOtp(frame, page, otp);
    }

    if (!otpFilled) {
      console.log('  [WARN] Could not find OTP input. Please enter manually.');
      await sleep(60000);
    }
    await sleep(rand(2000, 3500));

    // Check "I agree" checkbox (in iframe)
    console.log('  Checking I agree checkbox...');
    await sleep(rand(1000, 2500));
    const agreeSelectors = [
      'label:has-text("I agree")',
      'input[type="checkbox"]',
      'span:has-text("I agree")',
    ];
    let agreeChecked = false;
    for (const sel of agreeSelectors) {
      const el = frame.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click();
        agreeChecked = true;
        console.log(`  Clicked: ${sel}`);
        break;
      }
    }
    if (!agreeChecked) {
      for (const sel of agreeSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click();
          console.log(`  Clicked on main page: ${sel}`);
          break;
        }
      }
    }
    await sleep(rand(1500, 3000));

    // Click "Sign Up" again (Step 2 of 2)
    console.log('  Clicking Sign Up (final)...');
    await sleep(rand(2000, 4000));
    const finalSignUpSelectors = [
      'button:has-text("Sign Up")',
      'button:has-text("Sign Up (Step 2 of 2)")',
      'button[type="submit"]',
    ];
    let finalClicked = false;
    for (const sel of finalSignUpSelectors) {
      const el = frame.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
        await el.click();
        finalClicked = true;
        console.log(`  Clicked: ${sel}`);
        break;
      }
    }
    if (!finalClicked) {
      for (const sel of finalSignUpSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.click();
          console.log(`  Clicked on main page: ${sel}`);
          break;
        }
      }
    }

    // Wait for registration to complete
    // May appear captcha again — wait for user to solve manually
    console.log('  Waiting for registration to complete...');
    await sleep(rand(3000, 5000));

    // Aggressive captcha detection — check everything
    let needManualSolve = false;

    // Check Baxia slider
    try {
      const captchaCheck = frame.frameLocator('#baxia-dialog-content').getByText('Please slide to verify');
      if (await captchaCheck.isVisible({ timeout: 2000 }).catch(() => false)) {
        needManualSolve = true;
      }
    } catch (_) {}

    // Check any captcha-related element on page
    if (!needManualSolve) {
      const captchaSelectors = [
        '[class*="captcha"]',
        '[class*="baxia"]',
        '[id*="nocaptcha"]',
        '#baxia-dialog-content',
        '[class*="nc_scale"]',
        '[class*="btn_slide"]',
        '[id*="nc_1"]',
        '.sm-pop-inner',
        '[class*="slider"]',
        '[class*="verify"]',
      ];
      for (const sel of captchaSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          needManualSolve = true;
          console.log(`  Captcha detected: ${sel}`);
          break;
        }
      }
    }

    // Also check inside iframes for captcha
    if (!needManualSolve) {
      for (const f of page.frames()) {
        const url = f.url();
        if (url.includes('captcha') || url.includes('baxia') || url.includes('nocaptcha')) {
          needManualSolve = true;
          console.log(`  Captcha frame detected: ${url.slice(0, 60)}`);
          break;
        }
      }
    }

    // Also check if page still shows verification form (not yet progressed)
    if (!needManualSolve) {
      const stillOnForm = await frame.locator('#emailCaptcha').isVisible({ timeout: 1000 }).catch(() => false);
      if (stillOnForm) {
        console.log('  Still on verification form, waiting for user...');
        needManualSolve = true;
      }
    }

    if (needManualSolve) {
      console.log('');
      console.log('  >>> CAPTCHA APPEARED! Attempting to solve via CapMonster...');
      console.log('');

      let solved = false;
      if (CONFIG.capmonsterApiKey) {
        const targetFrame = page.frames().find(f => f.url().includes('nocaptcha') || f.url().includes('baxia')) || page;
        solved = await solveAliyunCaptcha(targetFrame, {
          apiKey: CONFIG.capmonsterApiKey,
          websiteURL: page.url(),
          userAgent: contextOpts.userAgent,
          networkConfig: capturedConfig,
        });
      }

      if (solved) {
        console.log('  CapMonster solved the post-registration captcha!');
        needManualSolve = false;
      } else {
        console.log('  >>> CapMonster failed or not configured. Please solve it manually in the browser.');
        console.log('  >>> Bot will auto-detect when solved. Waiting...');

        // Poll until captcha disappears or URL changes
        const startUrl = page.url();
        const deadline = Date.now() + 180000; // 3 min max
        while (Date.now() < deadline) {
          await sleep(2000);

          // URL changed = registration progressed
          if (page.url() !== startUrl) {
            console.log('  URL changed, captcha solved!');
            break;
          }

          // Check if captcha is still visible
          let captchaGone = true;

          // Check Baxia slider
          try {
            const still = frame.frameLocator('#baxia-dialog-content').getByText('Please slide to verify');
            if (await still.isVisible({ timeout: 500 }).catch(() => false)) {
              captchaGone = false;
            }
          } catch (_) {}

          // Check other captcha elements
          if (captchaGone) {
            const checkSelectors = [
              '[class*="captcha"]',
              '[class*="baxia"]',
              '[id*="nocaptcha"]',
              '[class*="nc_scale"]',
              '[class*="btn_slide"]',
              '.sm-pop-inner',
            ];
            for (const sel of checkSelectors) {
              const el = page.locator(sel).first();
              if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
                captchaGone = false;
                break;
              }
            }
          }

          // Check if still on verification form
          if (captchaGone) {
            const stillForm = await frame.locator('#emailCaptcha').isVisible({ timeout: 300 }).catch(() => false);
            if (stillForm) captchaGone = false;
          }

          if (captchaGone) {
            console.log('  Captcha solved! Continuing...');
            break;
          }

          console.log('  Still waiting for captcha...');
        }
      }
    }

    // Final wait for page to settle after registration
    console.log('  Registration complete, settling...');
    await sleep(rand(5000, 8000));
    await humanMouseMove(page);
    await sleep(rand(2000, 4000));

    // Step 9: Open Model Studio console in new tab
    console.log('[9/9] Opening Model Studio console in new tab...');
    const consolePage = await context.newPage();
    await consolePage.goto(CONFIG.consoleUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await handleCookies(consolePage);
    // Human: explore the page
    await sleep(rand(5000, 8000));
    await humanMouseMove(consolePage);
    await sleep(rand(1000, 3000));
    await humanScroll(consolePage);
    await sleep(rand(2000, 4000));

    // Click "Create API Key"
    console.log('  Creating API Key...');
    const createKeySelectors = [
      'button:has-text("Create API Key")',
      'button:has-text("Create API key")',
      'button:has-text("Create")',
      'a:has-text("Create API Key")',
    ];
    for (const sel of createKeySelectors) {
      const el = consolePage.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click();
        console.log(`  Clicked: ${sel}`);
        break;
      }
    }
    await sleep(rand(2000, 4000));

    // Click "Create API Key" again (appears in #InnerLayoutRight or modal)
    console.log('  Clicking Create API Key (confirm)...');
    await sleep(rand(3000, 5000)); // wait for button to appear

    const confirmKeySelectors = [
      '#InnerLayoutRight button.spark-button',
      '#InnerLayoutRight button:has-text("Create API Key")',
      'button.efm_ant-btn-primary:has-text("Create API Key")',
      'button.spark-button:has-text("Create API Key")',
      '.efm_ant-modal button:has-text("Create API Key")',
      '.efm_ant-modal button.efm_ant-btn-primary',
      '[class*="modal"] button:has-text("Create API Key")',
      '[class*="dialog"] button:has-text("Create API Key")',
      'button:has-text("Create API Key")',
    ];
    let confirmClicked = false;
    for (const sel of confirmKeySelectors) {
      const el = consolePage.locator(sel).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        await el.click();
        confirmClicked = true;
        console.log(`  Clicked: ${sel}`);
        break;
      }
    }

    // If still not clicked, wait more and retry
    if (!confirmClicked) {
      console.log('  Retrying after longer wait...');
      await sleep(rand(5000, 8000));
      for (const sel of confirmKeySelectors) {
        const el = consolePage.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
          await el.click();
          confirmClicked = true;
          console.log(`  Clicked: ${sel}`);
          break;
        }
      }
    }

    if (!confirmClicked) {
      console.log('  [WARN] Confirm Create API Key button not found!');
    }
    await sleep(rand(2000, 3500));

    // Click "OK" to confirm
    const okSelectors = [
      'button:has-text("OK")',
      'button:has-text("Ok")',
      'button:has-text("Confirm")',
      'button:has-text("Yes")',
    ];
    for (const sel of okSelectors) {
      const el = consolePage.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        console.log(`  Clicked: ${sel}`);
        break;
      }
    }

    // Wait for API key to be generated (loading)
    console.log('  Waiting for API key to load...');
    await sleep(rand(8000, 12000));

    // Extract API key from page
    console.log('  Extracting API Key...');
    let apiKey = '';

    const keySelectors = [
      '.keyText__qJgAi',
      'div[class*="keyText"]',
      'code',
      'pre',
      '[class*="key"] code',
      '[class*="secret"]',
      'input[readonly]',
      'input:has-text("sk-")',
      'input[value*="sk-"]',
      '.copyable',
    ];
    for (const sel of keySelectors) {
      const el = consolePage.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        const text = await el.textContent().catch(() => '');
        if (text && text.trim().length > 10) {
          apiKey = text.trim();
          break;
        }
      }
    }

    // Fallback: try input value
    if (!apiKey) {
      const readonlyInput = consolePage.locator('input[readonly]').first();
      if (await readonlyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
        apiKey = await readonlyInput.inputValue().catch(() => '');
      }
    }

    // Save to CSV
    const csvHeaders = 'timestamp,email,password,api_key';
    const csvRow = [
      new Date().toISOString(),
      email,
      CONFIG.password,
      apiKey || 'NOT_FOUND',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');

    const csvPath = CONFIG.outputFile;
    const exists = fs.existsSync(csvPath);
    if (!exists) {
      fs.writeFileSync(csvPath, csvHeaders + '\n', 'utf8');
    }
    fs.appendFileSync(csvPath, csvRow + '\n', 'utf8');
    console.log(`  Saved to: ${csvPath}`);

    console.log('\n========================================');
    console.log('  ALIBABA REGISTRATION SUMMARY');
    console.log('========================================');
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${CONFIG.password}`);
    console.log(`  API Key:  ${apiKey || 'check browser manually'}`);
    console.log(`  Saved to: ${CONFIG.outputFile}`);
    console.log('========================================\n');
    console.log('Browser will close in 30 seconds...');
    await sleep(30000);

  } catch (err) {
    console.error('ERROR:', err.message);
    console.log('Browser stays open for 30s...');
    await sleep(30000);
  } finally {
    await browser.close();
  }
}

async function fillOtp(frame, page, otp) {
  const targets = [frame, page];

  for (const target of targets) {
    // Strategy 1: Split inputs (multiple single-char fields)
    const splitSelectors = [
      'input.ant-otp-input:visible',
      'input[aria-label*="OTP Input"]:visible',
      'input:visible[size="1"]',
      'input:visible[maxlength="1"]',
    ];
    for (const sel of splitSelectors) {
      const inputs = target.locator(sel);
      const count = await inputs.count();
      if (count >= 4) {
        console.log(`  Filling OTP across ${count} split inputs`);
        for (let i = 0; i < Math.min(count, otp.length); i++) {
          await inputs.nth(i).click();
          await sleep(rand(100, 300));
          await inputs.nth(i).press(otp[i]);
          await sleep(rand(150, 400));
        }
        return true;
      }
    }

    // Strategy 2: Single OTP input
    const singleSelectors = [
      'input[maxlength="6"]', 'input[maxlength="4"]', 'input[maxlength="8"]',
      'input[placeholder*="code" i]', 'input[placeholder*="OTP" i]',
      'input[placeholder*="verif" i]', 'input[placeholder*="Verification" i]',
      'input[name*="code" i]', 'input[name*="otp" i]',
      'input[name*="verif" i]', 'input[name*="captcha" i]',
      'input[type="tel"]', 'input[type="number"]',
      'input[autocomplete="one-time-code"]',
    ];
    for (const sel of singleSelectors) {
      const el = target.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        await el.click();
        await sleep(rand(200, 500));
        // Type OTP character by character
        for (const char of otp) {
          await el.press(char);
          await sleep(rand(80, 200));
        }
        console.log(`  OTP filled via: ${sel}`);
        return true;
      }
    }
  }

  return false;
}

// CLI
if (require.main === module) {
  register().catch(console.error);
}

module.exports = { register, CONFIG };
