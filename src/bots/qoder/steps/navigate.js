// Steps 1 & 2: navigate to the platform, handle first-time access password,
// then navigate to the Qoder provider page.

const {
  sleep,
  rand,
  clickFirst,
  handleCookies,
  snap,
} = require('./_shared');

// Step 1: Navigate to the platform, accept cookies, handle first-time password.
async function stepNavigatePlatform(ctx) {
  const { dashPage, CONFIG, tag } = ctx;
  console.log(`${tag} [1/9] Navigating to platform...`);
  await dashPage.goto(CONFIG.platformUrl, {
    waitUntil: 'domcontentloaded',
    timeout: CONFIG.navigateTimeout,
  });
  await handleCookies(dashPage);
  await sleep(rand(2000, 3500));

  // First-time access password prompt (only appears once per session).
  const hadPassword = await handlePlatformPassword(dashPage, CONFIG);
  if (hadPassword) {
    console.log('  Waiting for dashboard to load after login...');
    await dashPage.waitForURL(/\/dashboard/, { timeout: 15000 }).catch(() => {});
    await sleep(rand(3000, 5000));
  }
}

// Handle a first-time access password prompt if present. Returns true if a
// password was entered, false otherwise.
async function handlePlatformPassword(page, CONFIG) {
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
  return false;
}

// Step 2: Navigate to the Qoder provider page.
async function stepNavigateQoder(ctx) {
  const { dashPage, CONFIG, tag } = ctx;
  console.log(`${tag} [2/9] Navigating to Qoder page...`);
  await dashPage.goto(CONFIG.qoderUrl, {
    waitUntil: 'domcontentloaded',
    timeout: CONFIG.navigateTimeout,
  });
  await sleep(rand(2000, 3000));
  await snap(dashPage, `${ctx.runIndex}_02_qoder_page`);
}

module.exports = {
  stepNavigatePlatform,
  stepNavigateQoder,
  handlePlatformPassword,
};
