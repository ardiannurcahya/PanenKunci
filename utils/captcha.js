const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { sleep, rand, fillHuman, humanMouseMove } = require('./helpers');

// Xiaomi text-image captcha solver (using captcha_ocr.py)
async function solveCaptchaWithPython(imgLocator, page, retries = 3) {
  const tmpDir = require('os').tmpdir();
  const imgPath = path.join(tmpDir, `captcha_${Date.now()}.png`);

  for (let i = 0; i < retries; i++) {
    console.log(`  OCR attempt ${i + 1}/${retries}...`);
    await sleep(1000);

    try {
      // Screenshot the captcha image element
      await imgLocator.screenshot({ path: imgPath });

      // Run Python OCR
      const result = spawnSync('python', [path.join(__dirname, '../captcha_ocr.py'), imgPath], {
        encoding: 'utf-8',
        timeout: 30000,
      });

      if (result.error) {
        console.log(`  Python error: ${result.error.message}`);
        continue;
      }

      const code = (result.stdout || '').trim().replace(/[^a-zA-Z0-9]/g, '');
      console.log(`  OCR result: "${code}"`);

      if (code.length >= 4 && code.length <= 8) {
        const input = page.locator('.mi-captcha-field input, input[name*="icode"]').first();
        await input.fill('');
        await input.fill(code);
        await sleep(500);

        const submit = page.locator('button[type="submit"], button:has-text("Verify"), button:has-text("Confirm")').first();
        if (await submit.isVisible({ timeout: 500 }).catch(() => false)) {
          await submit.click();
          await sleep(2000);

          if (!(await imgLocator.isVisible({ timeout: 1000 }).catch(() => false))) {
            return true;
          }
          console.log('  Wrong, retrying...');
        }
      } else {
        console.log('  Invalid code length, retrying...');
      }
    } catch (e) {
      console.log(`  OCR error: ${e.message}`);
    } finally {
      try { fs.unlinkSync(imgPath); } catch (_) {}
    }
  }
  return false;
}

// OpenCV sliding puzzle captcha solver (using captcha_puzzle_solver.py)
async function solvePuzzleCaptchaWithPython(page) {
  console.log('  Attempting puzzle captcha solve via OpenCV...');
  const tmpDir = require('os').tmpdir();
  const gapPath = path.join(tmpDir, `captcha_gap_${Date.now()}.png`);
  const bgPath = path.join(tmpDir, `captcha_bg_${Date.now()}.png`);

  try {
    // Common puzzle piece image selectors (Aliyun captcha first)
    const gapSelectors = [
      '#aliyunCaptcha-puzzle',
      '.geetest_tip_img img', '.geetest_slice_img',
      '[class*="puzzle"] [class*="piece"] img',
      '[class*="puzzle"] [class*="slice"] img',
      '[class*="captcha"] [class*="piece"] img',
      '[class*="captcha"] [class*="slice"] img',
      '[class*="slider"] [class*="tip"] img',
      '[class*="verify"] [class*="piece"] img',
      'img[class*="piece"]', 'img[class*="slice"]',
      'img[class*="puzzle"]', 'img[class*="tip"]',
    ];

    // Common background image selectors (Aliyun captcha first)
    const bgSelectors = [
      '#aliyunCaptcha-img.puzzle',
      '.geetest_widget img', '.geetest_bg_img',
      '[class*="puzzle"] [class*="bg"] img',
      '[class*="puzzle"] [class*="background"] img',
      '[class*="captcha"] [class*="bg"] img',
      '[class*="captcha"] [class*="background"] img',
      '[class*="slider"] [class*="bg"] img',
      '[class*="verify"] [class*="bg"] img',
      'img[class*="background"]', 'img[class*="bg"]',
    ];

    // Find gap image
    let gapEl = null;
    for (const sel of gapSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        gapEl = el;
        console.log(`  Gap image found: ${sel}`);
        break;
      }
    }

    // Find background image
    let bgEl = null;
    for (const sel of bgSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        bgEl = el;
        console.log(`  BG image found: ${sel}`);
        break;
      }
    }

    if (!gapEl || !bgEl) {
      console.log('  [WARN] Could not find puzzle images (gap/bg)');
      return false;
    }

    // Screenshot both images
    await gapEl.screenshot({ path: gapPath });
    await bgEl.screenshot({ path: bgPath });

    // Run Python solver
    const result = spawnSync('python', [
      path.join(__dirname, '../captcha_puzzle_solver.py'),
      gapPath, bgPath,
    ], { encoding: 'utf-8', timeout: 30000 });

    if (result.error) {
      console.log(`  Python error: ${result.error.message}`);
      return false;
    }
    if (result.stderr) {
      console.log(`  Python stderr: ${result.stderr.slice(0, 200)}`);
    }

    // Parse X position from stdout
    const output = (result.stdout || '').trim();
    console.log(`  Python output: ${output}`);
    const match = output.match(/(\d+)/);
    if (!match) {
      console.log('  [WARN] Could not parse position from Python output');
      return false;
    }
    let targetX = parseInt(match[1], 10);
    console.log(`  Target drag position: ${targetX}px`);

    // Now find the slider button and drag it (Aliyun first)
    const sliderSelectors = [
      '#aliyunCaptcha-sliding-slider',
      '.geetest_slider_button', '.geetest_drag_btn',
      '[class*="slider"] [class*="btn"]', '[class*="slider"] [class*="button"]',
      '[class*="slider"] [class*="drag"]', '[class*="slider"] [class*="thumb"]',
      '[class*="slider"] [class*="handler"]',
      '[class*="captcha"] [class*="slider"]', '[class*="captcha"] [class*="drag"]',
      '[class*="verify"] [class*="slider"]',
      '[class*="sliding"] [class*="slider"]',
      '[draggable="true"]', '[role="slider"]',
      '[class*="handler"]', '[class*="thumb"]',
    ];

    let slider = null;
    for (const sel of sliderSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
        slider = el;
        console.log(`  Slider found: ${sel}`);
        break;
      }
    }

    if (!slider) {
      console.log('  [WARN] Slider button not found');
      return false;
    }

    // Scale targetX from OpenCV image pixels to displayed background pixels
    const bgBox = await bgEl.boundingBox();
    if (!bgBox) return false;

    const naturalWidth = await bgEl.evaluate(el => el.naturalWidth).catch(() => 0);
    let displayedTargetX = targetX;
    if (naturalWidth > 0 && naturalWidth !== bgBox.width) {
      const imgScale = bgBox.width / naturalWidth;
      displayedTargetX = targetX * imgScale;
    }

    // Now calculate track-to-piece scaling:
    const sliderBox = await slider.boundingBox();
    if (!sliderBox) return false;

    // Get slider track box (parent of the slider button)
    const track = slider.locator('..');
    const trackBox = await track.boundingBox().catch(() => null);
    const trackWidth = trackBox ? trackBox.width : bgBox.width;

    // Get puzzle piece box
    const puzzleEl = page.locator('#aliyunCaptcha-puzzle').first();
    const puzzleBox = await puzzleEl.boundingBox().catch(() => null);
    const puzzleWidth = puzzleBox ? puzzleBox.width : 50; // fallback to 50px

    // Calculate initial screen offset of puzzle piece relative to background image
    let initialOffset = 0;
    if (puzzleBox && bgBox) {
      initialOffset = Math.max(0, puzzleBox.x - bgBox.x);
    }

    const L_slider = trackWidth - sliderBox.width;
    // Puzzle piece travel range is background width minus puzzle width minus starting offset
    const L_piece = bgBox.width - puzzleWidth - initialOffset;

    let scaleFactor = 1.0;
    if (L_piece > 0 && L_slider > 0) {
      scaleFactor = L_slider / L_piece;
    }

    // Net travel distance needed for the puzzle piece on the screen:
    const travelNeeded = Math.max(0, displayedTargetX - initialOffset);

    // The final drag distance in screen pixels is:
    let dragDistance = travelNeeded * scaleFactor;

    console.log(`  OpenCV offset: ${targetX}px`);
    console.log(`  Displayed offset: ${Math.round(displayedTargetX)}px`);
    console.log(`  Initial screen offset: ${initialOffset.toFixed(1)}px`);
    console.log(`  Net travel needed: ${Math.round(travelNeeded)}px`);
    console.log(`  Track width: ${Math.round(trackWidth)}px, Slider button: ${Math.round(sliderBox.width)}px (L_slider: ${Math.round(L_slider)}px)`);
    console.log(`  Background: ${Math.round(bgBox.width)}px, Puzzle piece: ${Math.round(puzzleWidth)}px (L_piece: ${Math.round(L_piece)}px)`);
    console.log(`  Track-to-Piece Scale: ${scaleFactor.toFixed(3)}`);
    console.log(`  Final Drag Distance: ${Math.round(dragDistance)}px`);

    targetX = Math.round(dragDistance);

    // Validate: position must be reasonable (at least 20px, max 500px)
    if (targetX < 20 || targetX > 500) {
      console.log(`  [WARN] Invalid position: ${targetX}px (expected 20-500px)`);
      return false;
    }

    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;
    const endX = startX + targetX;

    console.log(`  Dragging from ${Math.round(startX)} to ${Math.round(endX)} (${targetX}px)...`);

    // Human-like drag with ease-out
    const steps = rand(30, 50);
    await page.mouse.move(startX, startY);
    await sleep(rand(100, 300));
    await page.mouse.down();
    await sleep(rand(50, 150));

    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = startX + (endX - startX) * eased;
      const y = startY + (Math.random() - 0.5) * 2;
      await page.mouse.move(x, y);
      await sleep(rand(5, 20));
    }

    await sleep(rand(100, 300));
    await page.mouse.up();
    await sleep(2000);

    console.log('  Puzzle drag completed');
    return true;

  } catch (e) {
    console.log(`  Puzzle solver error: ${e.message}`);
    return false;
  } finally {
    try { fs.unlinkSync(gapPath); } catch (_) {}
    try { fs.unlinkSync(bgPath); } catch (_) {}
  }
}

// Plain Slider Captcha solver (simple drag)
async function solveSliderCaptcha(page) {
  console.log('  Attempting to solve slider captcha...');

  // Common slider captcha selectors
  const sliderSelectors = [
    '.slider-btn', '.slide-btn', '.slider-button', '.slide_button',
    '.drag-btn', '.drag-button', '.nc_iconfont', '.nc-lang-cnt',
    '[class*="slider"] [class*="btn"]',
    '[class*="slider"] [class*="button"]',
    '[class*="slider"] [class*="drag"]',
    '[class*="slider"] [class*="thumb"]',
    '[class*="slider"] [class*="handler"]',
    '[class*="captcha"] [class*="slider"]',
    '[class*="captcha"] [class*="drag"]',
    '[class*="verify"] [class*="slider"]',
    '[class*="verify"] [class*="drag"]',
    '.verify-move-block',
    '.slide-verify-slider',
    '.geetest_slider_button',
    '.geetest_drag_btn',
    '#slideVerify .dv-handler',
    '.handler_bg',
  ];

  let slider = null;
  for (const sel of sliderSelectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      slider = el;
      console.log(`  Found slider: ${sel}`);
      break;
    }
  }

  // Also try iframes (many captchas load in iframes)
  if (!slider) {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      for (const sel of sliderSelectors) {
        const el = frame.locator(sel).first();
        if (await el.isVisible({ timeout: 300 }).catch(() => false)) {
          slider = el;
          console.log(`  Found slider in iframe: ${sel}`);
          break;
        }
      }
      if (slider) break;
    }
  }

  // Fallback: find any draggable-looking element
  if (!slider) {
    const draggables = page.locator('[draggable="true"], [class*="drag"], [role="slider"], [class*="handler"], [class*="thumb"]');
    const count = await draggables.count();
    if (count > 0) {
      slider = draggables.first();
      console.log('  Found draggable element as fallback');
    }
  }

  if (!slider) {
    console.log('  [WARN] No slider captcha element found');
    return false;
  }

  // Get slider bounding box
  const box = await slider.boundingBox();
  if (!box) {
    console.log('  [WARN] Could not get slider bounding box');
    return false;
  }

  // Find the track width
  const trackSelectors = [
    '.slider-track', '.slide-track', '.slider-bar', '.track',
    '[class*="slider"] [class*="track"]',
    '[class*="slider"] [class*="bar"]',
    '[class*="captcha"] [class*="track"]',
    '[class*="verify"] [class*="track"]',
    '.slide-verify-slider',
    '.geetest_slider',
    '#slideVerify',
  ];

  let trackWidth = 300; // default drag distance
  for (const sel of trackSelectors) {
    const track = page.locator(sel).first();
    if (await track.isVisible({ timeout: 300 }).catch(() => false)) {
      const trackBox = await track.boundingBox();
      if (trackBox) {
        trackWidth = trackBox.width - box.width;
        console.log(`  Track width: ${trackWidth}px`);
        break;
      }
    }
  }

  if (trackWidth === 300) {
    try {
      const parent = slider.locator('..');
      const parentBox = await parent.boundingBox();
      if (parentBox && parentBox.width > box.width) {
        trackWidth = parentBox.width - box.width;
        console.log(`  Track width (from parent): ${trackWidth}px`);
      }
    } catch (_) {}
  }

  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + trackWidth;

  console.log(`  Dragging from (${Math.round(startX)}, ${Math.round(startY)}) to (${Math.round(endX)}, ${Math.round(startY)})...`);

  const steps = rand(25, 40);
  await page.mouse.move(startX, startY);
  await sleep(rand(100, 300));
  await page.mouse.down();
  await sleep(rand(50, 150));

  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const eased = 1 - Math.pow(1 - progress, 3);
    const x = startX + (endX - startX) * eased;
    const y = startY + (Math.random() - 0.5) * 3;
    await page.mouse.move(x, y);
    await sleep(rand(5, 25));
  }

  await sleep(rand(100, 300));
  await page.mouse.up();
  await sleep(2000);

  console.log('  Slider drag completed');
  return true;
}

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

// Watch loop to detect Qoder captcha solution
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
  solveCaptchaWithPython,
  solvePuzzleCaptchaWithPython,
  solveSliderCaptcha,
  solveRecaptchaWith2captcha,
  waitForCaptchaSolved,
  waitForQoderCaptchaSolved,
};
