const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth')();
chromium.use(StealthPlugin);
const fs = require('fs');
const path = require('path');

const { loadEnv } = require('../utils/env.js');
loadEnv();

const { sleep, clickFirst } = require('../utils/helpers.js');
const { solvePuzzleCaptchaWithPython } = require('../utils/captcha.js');

const CONFIG = {
  platformUrl: process.env.PLATFORM_URL,
  qoderUrl: process.env.QODER_URL,
  platformPassword: process.env.PLATFORM_PASSWORD,
};

async function main() {
  console.log('Launching browser to test CAPTCHA drag...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 }
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to platform...');
    await page.goto(CONFIG.platformUrl, { waitUntil: 'domcontentloaded' });
    const { handleCookies } = require('../utils/helpers.js');
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

    // Click "Sign in with another account" if visible
    await clickFirst(oauthPage, [
      'text="Sign in with another account"',
      'text="Sign in with a different account"',
      'text="Use another account"',
      'a:has-text("another account")',
      'button:has-text("another account")',
      'text="Sign in with another"',
    ], 'Sign in with another account', 3000);

    await sleep(2000);

    // Navigate to Sign up
    await clickFirst(oauthPage, [
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
    await sleep(3000);

    // Fill registration form to trigger verification
    console.log('Filling form...');
    await oauthPage.locator('input[placeholder*="First" i]').first().fill('Test');
    await oauthPage.locator('input[placeholder*="Last" i]').first().fill('Drag');
    await oauthPage.locator('input[placeholder*="email" i]').first().fill(`drag_${Date.now()}@openfile.my.id`);
    
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

    // Captcha is triggered
    console.log('\n--- CAPTCHA TRIGGERED. TAKING BEFORE SCREENSHOT ---');
    const captchaBox = oauthPage.locator('#aliyunCaptcha-window-float').first();
    if (await captchaBox.isVisible()) {
      await captchaBox.screenshot({ path: path.join(__dirname, '../captcha_before.png') });
      console.log('Saved captcha_before.png');
    }

    console.log('Solving captcha...');
    const solved = await solvePuzzleCaptchaWithPython(oauthPage);
    console.log(`Solve result: ${solved}`);

    console.log('Taking after screenshot...');
    if (await captchaBox.isVisible()) {
      await captchaBox.screenshot({ path: path.join(__dirname, '../captcha_after.png') });
      console.log('Saved captcha_after.png');
    }

    console.log('Waiting 10 seconds before closing...');
    await sleep(10000);

  } catch (e) {
    console.error('Drag test failed:', e.message);
  } finally {
    await browser.close();
  }
}

main();
