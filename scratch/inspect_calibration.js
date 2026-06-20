const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(StealthPlugin);

const { loadEnv } = require('../utils/env.js');
loadEnv();

const CONFIG = {
  platformUrl: process.env.PLATFORM_URL,
  qoderUrl: process.env.QODER_URL,
  platformPassword: process.env.PLATFORM_PASSWORD,
};

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Launching browser for captcha calibration...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to platform...');
    await page.goto(CONFIG.platformUrl, { waitUntil: 'domcontentloaded' });
    const { handleCookies, clickFirst } = require('../utils/helpers.js');
    await handleCookies(page, 1500);
    
    // Fill password if prompted
    const pwEl = page.locator('input[type="password"]').first();
    if (await pwEl.isVisible({ timeout: 2000 }).catch(() => false)) {
      await pwEl.fill(CONFIG.platformPassword);
      await page.locator('button:has-text("Submit"), button:has-text("Enter"), button[type="submit"]').first().click();
      await sleep(4000);
    }

    console.log('Navigating to Qoder page...');
    await page.goto(CONFIG.qoderUrl, { waitUntil: 'domcontentloaded' });
    await handleCookies(page, 1500);
    await sleep(2000);

    console.log('Clicking Add button to trigger OAuth tab...');
    const [oauthPage] = await Promise.all([
      context.waitForEvent('page', { timeout: 25000 }),
      page.locator('button:has-text("Add"), button:has-text("Add Account"), [class*="add" i]').first().click(),
    ]);

    await oauthPage.waitForLoadState('domcontentloaded');
    await handleCookies(oauthPage, 1500);
    await sleep(3000);

    // Navigate to Sign up
    await clickFirst(oauthPage, [
      'text="Sign up"',
      'a:has-text("Sign up")',
      'button:has-text("Sign up")',
      'text="Sign Up"',
      'a:has-text("Sign Up")',
      'a:has-text("Create account")',
    ], 'Sign up link', 5000);
    await sleep(3000);

    // Fill registration form to trigger verification
    console.log('Filling form...');
    await oauthPage.locator('input[placeholder*="First" i]').first().fill('Calibration');
    await oauthPage.locator('input[placeholder*="Last" i]').first().fill('Test');
    await oauthPage.locator('input[placeholder*="email" i]').first().fill(`calib_${Date.now()}@openfile.my.id`);
    
    const cb = oauthPage.locator('input[type="checkbox"]').first();
    if (await cb.isVisible()) await cb.check();

    await clickFirst(oauthPage, [
      'button:has-text("Continue")', 'button:has-text("Next")',
      'button:has-text("Submit")', 'button:has-text("Create")',
      'button[type="submit"]', 'input[type="submit"]',
    ], 'Continue button', 3000);
    await sleep(3000);

    // Password step
    await oauthPage.locator('input[type="password"]').first().fill('PortoAuto2025!');
    await clickFirst(oauthPage, [
      'button:has-text("Continue")', 'button:has-text("Next")',
      'button:has-text("Submit")', 'button:has-text("Create")',
      'button:has-text("Sign up")', 'button[type="submit"]',
    ], 'Continue button (password)', 3000);
    await sleep(3000);

    // Trigger verification
    console.log('Clicking "Click to verify"...');
    await clickFirst(oauthPage, [
      'text="Click to verify"', 'text="click to verify"', 'text="Click to Verify"',
      'button:has-text("verify")', 'button:has-text("Verify")',
      '[class*="verify"]', '[class*="captcha"]',
      'text="Verify"', 'text="Start verification"',
    ], 'Click to verify', 5000);
    await sleep(4000);

    // Captcha is triggered, inspect DOM
    console.log('\n--- CAPTCHA TRIGGERED. STARTING CALIBRATION ---');

    const slider = oauthPage.locator('#aliyunCaptcha-sliding-slider').first();
    const sliderBox = await slider.boundingBox();
    if (!sliderBox) throw new Error('Slider bounding box not found');

    const startX = sliderBox.x + sliderBox.width / 2;
    const startY = sliderBox.y + sliderBox.height / 2;

    await oauthPage.mouse.move(startX, startY);
    await sleep(500);
    await oauthPage.mouse.down();
    await sleep(500);

    const calibrationPoints = [];

    // Drag in 20px increments from 0 to 260px
    for (let dragDistance = 0; dragDistance <= 260; dragDistance += 20) {
      await oauthPage.mouse.move(startX + dragDistance, startY);
      await sleep(200);

      const positions = await oauthPage.evaluate(() => {
        const sliderEl = document.querySelector('#aliyunCaptcha-sliding-slider');
        const puzzleEl = document.querySelector('#aliyunCaptcha-puzzle');
        return {
          sliderLeft: sliderEl ? sliderEl.style.left : null,
          puzzleLeft: puzzleEl ? puzzleEl.style.left : null,
        };
      });

      console.log(`Drag distance: ${dragDistance}px -> Slider Left: ${positions.sliderLeft}, Puzzle Left: ${positions.puzzleLeft}`);
      calibrationPoints.push({
        drag: dragDistance,
        sliderLeft: positions.sliderLeft,
        puzzleLeft: positions.puzzleLeft,
      });
    }

    await oauthPage.mouse.up();
    console.log('\n--- Calibration Finished ---');
    console.log(JSON.stringify(calibrationPoints, null, 2));

  } catch (e) {
    console.error('Calibration failed:', e.message);
  } finally {
    await browser.close();
  }
}

main();
