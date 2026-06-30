const { loadEnv } = require('./utils/env.js');
loadEnv();

const { chromium } = require('playwright');

const fs = require('fs');
const path = require('path');
const { sleep, rand } = require('./utils/helpers.js');
const { randomFirstName, randomLastName } = require('./utils/names.js');

// ─── CONFIG ──────────────────────────────────────────────
const CONFIG = {
  signupUrl: 'https://app.fireworks.ai/signup',
  loginUrl: 'https://app.fireworks.ai/login/email?redirectURI=%2Faccount%2Fhome',
  homeUrl: 'https://app.fireworks.ai/account/home',
  password: 'FireworksAuto2025!',
  outputFile: path.join(__dirname, 'fireworks.csv'),
  configJson: path.join(__dirname, 'config.json'),
  // Time to wait for manual email verification (ms)
  verificationWaitMs: 60000,
  navigateTimeout: 30000,
  proxy: process.env.PROXY || '',
};

// ─── CHECKBOX OPTIONS ────────────────────────────────────
// Category 1: Reasons / motivations
const CATEGORY_1 = [
  'Prototype with open models',
  'Faster speeds or lower costs',
  'Migrate from self-hosting to',
  'Flexible capacity for experimentation',
  'Flexible capacity for production',
  'Fine-tune models for quality',
  'High reliability inference',
  'Migrate from closed to open',
];

// Category 2: Use cases / applications
const CATEGORY_2 = [
  'Code Assistance',
  'Conversational AI',
  'Agentic AI',
  'Search',
  'Multimedia RAG',
];

// ─── HELPERS ─────────────────────────────────────────────
function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  const specials = '#!@';
  let pw = '';
  for (let i = 0; i < 6; i++) pw += chars[rand(0, chars.length)];
  for (let i = 0; i < 2; i++) pw += nums[rand(0, nums.length)];
  pw += specials[rand(0, specials.length)];
  return pw;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, minCount = 1, maxCount = 3) {
  const count = rand(minCount, Math.min(maxCount + 1, arr.length + 1));
  return shuffleArray(arr).slice(0, count);
}

function loadEmails() {
  if (!fs.existsSync(CONFIG.configJson)) {
    console.error(`Config file not found: ${CONFIG.configJson}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(CONFIG.configJson, 'utf8'));
  const emails = raw.emails
    .split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0);
  if (emails.length === 0) {
    console.error('No emails found in config.json');
    process.exit(1);
  }
  return emails;
}

function saveToCsv(email, password, apiKey) {
  const csvHeaders = 'email,password,apikey';
  const csvRow = [email, password, apiKey || '']
    .map(v => `"${String(v).replace(/"/g, '""')}"`)
    .join(',');

  if (!fs.existsSync(CONFIG.outputFile)) {
    fs.writeFileSync(CONFIG.outputFile, csvHeaders + '\n' + csvRow + '\n', 'utf8');
  } else {
    // Ensure file ends with newline before appending
    let content = fs.readFileSync(CONFIG.outputFile, 'utf8');
    if (!content.endsWith('\n')) {
      content += '\n';
      fs.writeFileSync(CONFIG.outputFile, content, 'utf8');
    }
    fs.appendFileSync(CONFIG.outputFile, csvRow + '\n', 'utf8');
  }
  console.log(`  Saved to: ${CONFIG.outputFile}`);
}

function updateCsvApiKey(email, apiKey) {
  if (!fs.existsSync(CONFIG.outputFile)) return;
  const content = fs.readFileSync(CONFIG.outputFile, 'utf8');
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes(email)) continue;
    // Parse quoted CSV: "email","password","apikey"
    const matches = lines[i].match(/"([^"]*)"(?=,|$)/g);
    if (matches && matches.length >= 3) {
      matches[2] = `"${String(apiKey || 'NOT_FOUND').replace(/"/g, '""')}"`;
      lines[i] = matches.join(',');
    }
    break;
  }
  let result = lines.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  fs.writeFileSync(CONFIG.outputFile, result, 'utf8');
  console.log(`  Updated CSV with API key`);
}

// ─── REGISTER ONE EMAIL ──────────────────────────────────

async function dismissOverlay(page) {
  const selectors = [
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    '#onetrust-accept-btn-handler',
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.click();
        console.log(`  Dismissed overlay: ${sel}`);
        await sleep(500);
        return true;
      }
    } catch (_) {}
  }
  return false;
}

async function registerOne(page, email, index, total) {
  const password = generatePassword();
  const firstName = randomFirstName();
  const lastName = randomLastName();
  const tag = `[${index + 1}/${total}]`;

  console.log(`\n${'='.repeat(50)}`);
  console.log(`${tag} Registering: ${email}`);
  console.log(`${tag} Password: ${password}`);
  console.log(`${tag} Name: ${firstName} ${lastName}`);
  console.log(`${'='.repeat(50)}\n`);

  // Save credentials to CSV immediately
  saveToCsv(email, password, '');

  try {
    // Step 1: Go to signup page
    console.log(`${tag} [1/9] Opening signup page...`);
    await page.goto(CONFIG.signupUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await sleep(rand(2000, 4000));
    await dismissOverlay(page);

    // Step 2: Fill email
    console.log(`${tag} [2/9] Filling email...`);
    const emailInput = page.getByRole('textbox', { name: 'Email' });
    await emailInput.click();
    await sleep(rand(300, 600));
    await emailInput.fill(email);
    await sleep(rand(500, 1000));

    // Step 3: Click Next
    console.log(`${tag} [3/9] Clicking Next...`);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await sleep(rand(2000, 4000));

    // Step 4: Fill password + confirm password
    console.log(`${tag} [4/9] Filling password...`);
    const pwInput = page.getByRole('textbox', { name: 'Password', exact: true });
    await pwInput.click();
    await sleep(rand(300, 600));
    await pwInput.fill(password);
    await sleep(rand(400, 800));

    const confirmPwInput = page.getByRole('textbox', { name: 'Confirm Password' });
    await confirmPwInput.click();
    await sleep(rand(300, 600));
    await confirmPwInput.fill(password);
    await sleep(rand(500, 1000));

    // Step 5: Click Create Account — exact locator from track
    console.log(`${tag} [5/9] Creating account...`);
    await dismissOverlay(page);
    await sleep(500);
    await page.getByRole('button', { name: 'Create Account' }).click();
    await sleep(rand(3000, 5000));

    // Step 6: Wait for manual email verification
    const verifyWait = rand(25000, 50000);
    console.log(`${tag} [6/9] Waiting ${Math.round(verifyWait / 1000)}s for manual email verification...`);
    console.log(`${tag}         >>> Please verify the email manually NOW! <<<`);
    await sleep(verifyWait);

    // Step 7: Login — open new tab (like track file uses page1)
    console.log(`${tag} [7/9] Logging in...`);
    const loginPage = await page.context().newPage();
    await loginPage.goto(CONFIG.loginUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    await sleep(rand(2000, 4000));
    await dismissOverlay(loginPage);

    const loginEmail = loginPage.getByTestId('login-form-email');
    await loginEmail.click();
    await sleep(rand(300, 600));
    await loginEmail.fill(email);
    await sleep(rand(400, 800));

    const loginPw = loginPage.getByTestId('login-form-password');
    await loginPw.click();
    await sleep(rand(300, 600));
    await loginPw.fill(password);
    await sleep(rand(500, 1000));

    await loginPage.getByTestId('login-form-submit').click();
    await sleep(rand(3000, 6000));
    await loginPage.waitForURL(/app\.fireworks\.ai/, { timeout: 15000 }).catch(() => {});

    // Step 8: Fill profile + checkboxes (on loginPage)
    console.log(`${tag} [8/9] Filling profile...`);
    // First name
    const firstNameInput = loginPage.getByRole('textbox', { name: 'First Name' });
    await firstNameInput.click();
    await sleep(rand(300, 600));
    await firstNameInput.fill(firstName);
    await sleep(rand(400, 800));

    // Last name
    const lastNameInput = loginPage.getByRole('textbox', { name: 'Last Name' });
    await lastNameInput.click();
    await sleep(rand(300, 600));
    await lastNameInput.fill(lastName);
    await sleep(rand(500, 1000));

    // Agree to terms
    await loginPage.getByRole('checkbox', { name: 'I agree to the Terms of' }).click();
    await sleep(rand(500, 1000));

    // Click Continue
    await loginPage.getByRole('button', { name: 'Continue' }).click();
    await sleep(rand(2000, 4000));

    // Random checkbox selections
    console.log(`${tag} Selecting random checkboxes...`);
    const pickedCat1 = pickRandom(CATEGORY_1, 1, 3);
    const pickedCat2 = pickRandom(CATEGORY_2, 1, 3);
    const allPicked = [...pickedCat1, ...pickedCat2];

    console.log(`${tag} Category 1 picks: ${pickedCat1.join(', ')}`);
    console.log(`${tag} Category 2 picks: ${pickedCat2.join(', ')}`);

    // Click each picked checkbox by matching its label text
    for (const label of allPicked) {
      try {
        const cb = loginPage.getByRole('checkbox', { name: new RegExp(label, 'i') });
        if (await cb.isVisible({ timeout: 1000 }).catch(() => false)) {
          await cb.click();
          await sleep(rand(300, 700));
        }
      } catch (_) {
        console.log(`${tag} [WARN] Checkbox not found: ${label}`);
      }
    }

    // Submit to get credits — wait for loading to finish
    console.log(`${tag} Submitting to get credits...`);
    await loginPage.getByRole('button', { name: 'Submit to get $6 Credits' }).click();
    console.log(`${tag} Waiting for loading...`);
    await sleep(rand(30000, 40000));

    // Step 9: Create API Key — navigate to home (track file does goto after submit)
    // console.log(`${tag} [9/9] Navigating to home...`);
    // await loginPage.goto(CONFIG.homeUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.navigateTimeout });
    // await sleep(rand(5000, 8000));
    // await dismissOverlay(loginPage);

    // 1. Click Test Models
    console.log(`${tag} Clicking Test Models...`);
    await loginPage.getByRole('link', { name: 'Test Models' }).click();
    await sleep(rand(3000, 6000));

    // 2. Click Try the API
    console.log(`${tag} Clicking Try the API...`);
    await loginPage.getByRole('button', { name: 'Try the API' }).click();
    await sleep(rand(2000, 4000));

    // 3. Click Get API Key (opens popup)
    console.log(`${tag} Clicking Get API Key...`);
    const popupPromise = loginPage.waitForEvent('popup');
    await loginPage.getByRole('link', { name: 'Get API Key' }).click();
    const popup = await popupPromise;
    await sleep(rand(3000, 5000));

    // 4. Click Create API Key (in popup)
    console.log(`${tag} Clicking Create API Key...`);
    await popup.getByRole('button', { name: 'Create API Key' }).click();
    await sleep(rand(2000, 4000));

    // 5. Click API Key menu item
    console.log(`${tag} Selecting API Key menu item...`);
    await popup.getByRole('menuitem', { name: 'API Key', exact: true }).click();
    await sleep(rand(2000, 4000));

    // 6. Fill API key name
    console.log(`${tag} Filling API key name...`);
    const keyName = `auto-${Date.now().toString(36)}`;
    await popup.getByRole('textbox', { name: 'API Key Name *' }).fill(keyName);
    await sleep(rand(1000, 2000));

    // 7. Generate Key
    console.log(`${tag} Generating key...`);
    await popup.getByRole('button', { name: 'Generate Key' }).click();
    await sleep(rand(5000, 8000));

    // Extract API key from popup
    let apiKey = '';
    await sleep(rand(3000, 5000));
    try {
      const keySelectors = [
        'code',
        'pre',
        '[class*="key"]',
        '[class*="token"]',
        'input[readonly]',
        '.copyable',
      ];
      for (const sel of keySelectors) {
        const el = popup.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const text = await el.textContent().catch(() => '');
          if (text && text.trim().startsWith('fw_') && text.trim().length > 10) {
            apiKey = text.trim();
            break;
          }
        }
      }

      // Fallback: try to find any element containing fw_ prefix
      if (!apiKey) {
        const allText = await popup.locator('text=/^fw_[a-zA-Z0-9]{20,}$/').first();
        if (await allText.isVisible({ timeout: 2000 }).catch(() => false)) {
          apiKey = await allText.textContent().catch(() => '');
        }
      }
    } catch (_) {
      console.log(`${tag} [WARN] Could not extract API key automatically`);
    }

    console.log(`${tag} API Key: ${apiKey || 'NOT_FOUND'}`);

    // Update CSV with API key
    updateCsvApiKey(email, apiKey);

    console.log(`${tag} Registration complete!`);
    return true;

  } catch (err) {
    console.error(`${tag} ERROR: ${err.message}`);
    // Update CSV with ERROR status
    updateCsvApiKey(email, 'ERROR');
    return false;
  }
}

// ─── MAIN ────────────────────────────────────────────────
async function main() {
  console.log('=== Fireworks AI Auto-Registration Bot ===\n');

  const emails = loadEmails();
  console.log(`Emails to register: ${emails.length}`);
  emails.forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
  console.log('');

  // Launch browser — plain like track file
  console.log('Launching browser...');
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < emails.length; i++) {
    // Launch fresh browser per email
    console.log('Launching browser...');
    const launchOpts = { headless: true };
    if (CONFIG.proxy) {
      launchOpts.proxy = { server: CONFIG.proxy };
      console.log(`  Proxy: ${CONFIG.proxy}`);
    }
    const browser = await chromium.launch(launchOpts);
    const context = await browser.newContext();
    const page = await context.newPage();

    const success = await registerOne(page, emails[i], i, emails.length);
    if (success) {
      successCount++;
    } else {
      failCount++;
    }

    // Close browser after each registration
    console.log('Closing browser...');
    await browser.close();

    // Delay between registrations (except last)
    if (i < emails.length - 1) {
      const delay = rand(10000, 20000);
      console.log(`\nWaiting ${Math.round(delay / 1000)}s before next registration...\n`);
      await sleep(delay);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('  FINAL SUMMARY');
  console.log(`${'='.repeat(50)}`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed:  ${failCount}`);
  console.log(`  Total:   ${emails.length}`);
  console.log(`  Output:  ${CONFIG.outputFile}`);
  console.log(`${'='.repeat(50)}\n`);
}

// ─── CLI ─────────────────────────────────────────────────
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main, CONFIG };
