const { loadEnv } = require('../../lib/env');
loadEnv();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { sleep, rand } = require('../../lib/helpers');

// ─── CONFIG ──────────────────────────────────────────────
const CONFIG = {
  yahooEmail: process.env.YAHOO_EMAIL || '',
  yahooPassword: process.env.YAHOO_PASSWORD || '',
  totalEmails: 100,
  keywordPrefix: 'fw',
  outputFile: path.join(__dirname, '../../../data/config.json'),
  navigateTimeout: 30000,
};

// ─── MAIN ────────────────────────────────────────────────
async function main() {
  console.log('=== Yahoo Disposable Email Generator ===\n');

  if (!CONFIG.yahooEmail || !CONFIG.yahooPassword) {
    console.error('YAHOO_EMAIL and YAHOO_PASSWORD must be set in .env');
    process.exit(1);
  }

  // Generate keywords: fw01, fw02, ..., fw100
  const keywords = [];
  for (let i = 1; i <= CONFIG.totalEmails; i++) {
    keywords.push(`${CONFIG.keywordPrefix}${String(i).padStart(2, '0')}`);
  }
  console.log(`Generating ${keywords.length} disposable emails with prefix "${CONFIG.keywordPrefix}"`);
  console.log(`Keywords: ${keywords[0]} ... ${keywords[keywords.length - 1]}\n`);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Step 1: Login to Yahoo
  console.log('[1/3] Logging in to Yahoo...');
  await page.goto('https://login.yahoo.com/', { waitUntil: 'load', timeout: CONFIG.navigateTimeout });
  await sleep(rand(2000, 4000));

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

  // Skip recovery prompt
  await page.getByRole('button', { name: 'Lewati' }).click().catch(() => {});
  await sleep(rand(2000, 4000));
  console.log('  Logged in.');

  // Step 2: Open mail → Settings → Mailbox tab
  console.log('[2/3] Opening mailbox settings...');
  const inboxPromise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Check your mail' }).click();
  const inbox = await inboxPromise;
  await sleep(rand(5000, 8000));

  await inbox.getByRole('button', { name: 'Lainnya Lainnya' }).click();
  await sleep(rand(1000, 2000));
  await inbox.getByText('Pengaturan').click();
  await sleep(rand(2000, 3000));
  await inbox.getByRole('tab', { name: 'Kotak email' }).click();
  await sleep(rand(2000, 3000));
  console.log('  Mailbox settings opened.\n');

  // Step 3: Generate disposable emails
  console.log(`[3/3] Generating ${keywords.length} disposable emails...\n`);

  const generatedEmails = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < keywords.length; i++) {
    const keyword = keywords[i];
    const tag = `[${i + 1}/${keywords.length}]`;

    try {
      // Click "Add disposable email address"
      await inbox.getByRole('button', { name: 'Tambahkan alamat email sekali' }).click();
      await sleep(rand(500, 1000));

      // Fill keyword
      const keywordInput = inbox.getByRole('textbox', { name: 'Tambahkan kata kunci' });
      await keywordInput.click();
      await sleep(rand(200, 500));
      await keywordInput.fill(keyword);
      await sleep(rand(300, 600));

      // Save
      await inbox.getByRole('button', { name: 'Simpan' }).click();
      await sleep(rand(1000, 2000));

      // Construct the disposable email address
      // Format: baseaddress-keyword@yahoo.com
      const baseAddress = CONFIG.yahooEmail.split('@')[0];
      const disposableEmail = `${baseAddress}-${keyword}@yahoo.com`;
      generatedEmails.push(disposableEmail);

      console.log(`${tag} OK: ${disposableEmail}`);
      successCount++;

      // Save to config.json every 10 emails (checkpoint)
      if ((i + 1) % 10 === 0 || i === keywords.length - 1) {
        saveConfig(generatedEmails);
        console.log(`${tag}   Checkpoint saved (${generatedEmails.length} emails)`);
      }

      // Small delay between generations
      await sleep(rand(500, 1500));

    } catch (err) {
      console.error(`${tag} FAIL: ${err.message}`);
      failCount++;
      // Try to recover by closing any dialog
      await inbox.keyboard.press('Escape').catch(() => {});
      await sleep(rand(1000, 2000));
    }
  }

  // Final save
  saveConfig(generatedEmails);

  console.log(`\n${'='.repeat(50)}`);
  console.log('  FINAL SUMMARY');
  console.log(`${'='.repeat(50)}`);
  console.log(`  Generated: ${successCount}`);
  console.log(`  Failed:    ${failCount}`);
  console.log(`  Total:     ${keywords.length}`);
  console.log(`  Output:    ${CONFIG.outputFile}`);
  console.log(`${'='.repeat(50)}\n`);

  await inbox.close();
  await page.close();
  await context.close();
  await browser.close();
}

function saveConfig(newEmails) {
  let existingEmails = [];
  if (fs.existsSync(CONFIG.outputFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG.outputFile, 'utf8'));
      existingEmails = raw.emails
        .split(',')
        .map(e => e.trim())
        .filter(e => e.length > 0);
    } catch (_) {}
  }
  const merged = [...new Set([...existingEmails, ...newEmails])];
  const config = {
    emails: merged.join(', '),
  };
  fs.writeFileSync(CONFIG.outputFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG };
