async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

// Human-like typing for Xiaomi registration (character by character press)
async function typeHuman(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click();
  await sleep(rand(200, 500));
  for (const char of text) {
    await el.press(char);
    await sleep(rand(60, 180));
  }
}

// Human-like typing for Qoder registration (using pressSequentially with thinking pauses)
async function typeHumanQoder(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click();
  await sleep(rand(200, 600));
  for (const char of text) {
    await el.pressSequentially(char, { delay: rand(50, 180) });
    // Occasional pause (like thinking)
    if (Math.random() < 0.05) await sleep(rand(300, 800));
  }
}

// Human-like fast input filling
async function fillHuman(page, locator, text) {
  await locator.click();
  await sleep(rand(80, 150));
  await locator.fill('');
  await sleep(rand(50, 100));
  for (const char of text) {
    await locator.pressSequentially(char, { delay: rand(20, 50) });
  }
  await sleep(rand(50, 100));
}

// Random mouse movement to simulate human behavior
async function humanMouseMove(page) {
  const x = rand(100, 1200);
  const y = rand(100, 600);
  await page.mouse.move(x, y, { steps: rand(5, 15) });
  await sleep(rand(100, 400));
}

// Random scroll behavior
async function humanScroll(page) {
  const deltaY = rand(-200, 200);
  await page.mouse.wheel(0, deltaY);
  await sleep(rand(300, 800));
}

// Try to click the first visible element matching any of the selectors/texts
async function clickFirst(page, selectors, description = 'element', timeout = 1000) {
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout }).catch(() => false)) {
      await el.click();
      console.log(`  Clicked: ${description} (${sel})`);
      return true;
    }
  }
  console.log(`  [WARN] ${description} not found`);
  return false;
}

function redact(value, keepStart = 4, keepEnd = 4) {
  if (value === undefined || value === null || value === '') return '';
  const s = String(value);
  if (keepStart <= 0 && keepEnd <= 0) return '*'.repeat(Math.min(s.length, 8));
  if (s.length <= keepStart + keepEnd) return '*'.repeat(Math.min(s.length, 8));
  return `${s.slice(0, keepStart)}...${s.slice(-keepEnd)}`;
}

// Cookie agreement handler
async function handleCookies(page, waitMs = 1500) {
  await sleep(waitMs);

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

module.exports = {
  sleep,
  rand,
  typeHuman,
  typeHumanQoder,
  fillHuman,
  humanMouseMove,
  humanScroll,
  clickFirst,
  redact,
  handleCookies,
};
