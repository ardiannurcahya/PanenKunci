const { loadEnv } = require('../../lib/env');
loadEnv();

const { chromium } = require('playwright');
const { sleep, rand } = require('../../lib/helpers');

const CONFIG = {
  yahooEmail: process.env.YAHOO_EMAIL || '',
  yahooPassword: process.env.YAHOO_PASSWORD || '',
  pollIntervalMs: 3000,
};

async function main() {
  console.log('=== Fireworks Email Verifier ===\n');

  if (!CONFIG.yahooEmail || !CONFIG.yahooPassword) {
    console.error('YAHOO_EMAIL and YAHOO_PASSWORD must be set in .env');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Login Yahoo — exact flow from track
  console.log('Logging in to Yahoo...');
  await page.goto('https://login.yahoo.com/', { waitUntil: 'load', timeout: 30000 });
  await sleep(rand(3000, 5000));

  await page.getByRole('textbox', { name: 'Username, email or phone' }).fill(CONFIG.yahooEmail);
  await sleep(rand(500, 1000));
  await page.getByRole('button', { name: 'Next' }).click();
  await sleep(rand(2000, 4000));

  await page.getByRole('textbox', { name: 'Password' }).click();
  await sleep(rand(300, 600));
  await page.getByRole('textbox', { name: 'Password' }).fill(CONFIG.yahooPassword);
  await sleep(rand(500, 1000));
  await page.getByRole('button', { name: 'Next' }).click();
  await sleep(rand(3000, 6000));

  // Skip recovery
  await page.getByRole('button', { name: 'Lewati' }).click().catch(() => {});
  await sleep(rand(2000, 4000));

  // Click "Check your mail" → opens new tab
  console.log('Opening inbox...');
  const inboxPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Check your mail' }).click();
  const inbox = await inboxPromise;
  await sleep(rand(5000, 8000));

  console.log('Yahoo login done. Monitoring inbox...\n');

  let verified = 0;
  const unreadUrl = 'https://mail.yahoo.com/n/search/referrer=unread&keyword=is%253Aunread&accountIds=1&excludefolders=ARCHIVE?.src=ym&reason=myc';

  // Loop — check unread inbox for fireworks emails
  while (true) {
    console.log('Checking inbox...');
    let gotoOk = false;
    for (let attempt = 0; attempt < 3 && !gotoOk; attempt++) {
      try {
        await inbox.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        gotoOk = true;
      } catch (e) {
        console.log(`  goto failed (attempt ${attempt + 1}/3): ${e.message}`);
        await sleep(rand(3000, 5000));
      }
    }
    if (!gotoOk) {
      console.log('  Skipping this cycle, will retry next loop...');
      await sleep(CONFIG.pollIntervalMs);
      continue;
    }
    await sleep(rand(5000, 8000));

    // Find ALL unread fireworks emails (not just first)
    const links = inbox.getByRole('link', { name: /no-reply@fireworks\.ai/i });
    const count = await links.count();

    if (count > 0) {
      console.log(`Found ${count} fireworks email(s)!`);
      for (let j = 0; j < count; j++) {
        const link = links.nth(j);
        if (!(await link.isVisible({ timeout: 2000 }).catch(() => false))) continue;

        console.log(`Processing email ${j + 1}/${count}...`);
        await link.click();
        await sleep(rand(3000, 5000));

        // Find verify link
        const verifyLink = inbox.locator('a[href*="app.fireworks.ai/signup/confirm"]').first();
        const verifyHref = await verifyLink.getAttribute('href').catch(() => '');

        if (verifyHref && verifyHref.includes('app.fireworks.ai/signup/confirm')) {
          console.log(`Verify URL: ${verifyHref}`);

          // Click verify link — opens new tab
          const verifyPromise = inbox.waitForEvent('popup');
          await verifyLink.click();
          const verifyPage = await verifyPromise;
          await sleep(rand(3000, 5000));

          // Click verify button
          const verifyBtn = verifyPage.locator('button:has-text("Verify"), button:has-text("Confirm"), button:has-text("Continue")').first();
          if (await verifyBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
            await verifyBtn.click();
            console.log('Clicked verify button');
            await sleep(rand(3000, 5000));
          }

          console.log(`Verified! URL: ${verifyPage.url()}`);
          await verifyPage.close();
          verified++;
        } else {
          console.log('[WARN] No verify link in this email, skipping...');
        }

        // Go back to inbox for next email
        await inbox.goto(unreadUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
        await sleep(rand(2000, 4000));
      }
      // Emails processed — immediately loop again (no delay)
      console.log(`Total verified: ${verified}\n`);
      continue;
    } else {
      console.log('No fireworks email yet...');
    }

    console.log(`Total verified: ${verified}\n`);
    await sleep(CONFIG.pollIntervalMs);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG };
