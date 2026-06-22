// Steps 5-7: create temp email + random names, fill the registration form,
// then enter the password.

const TempMail = require('../tempmail');
const { randomFirstName, randomLastName } = require('../utils/names');
const { sleep, rand, fillHuman, humanMouseMove, clickFirst, snap } = require('./_shared');

// Step 5: Generate temporary email + random names; store them on ctx.
async function stepCreateCredentials(ctx) {
  const { tag } = ctx;
  console.log(`${tag} [5/9] Creating temporary email...`);
  const tempmail = new TempMail();
  const inbox = await tempmail.createInbox();
  ctx.tempmail = tempmail;
  ctx.email = inbox.address;
  ctx.firstName = randomFirstName();
  ctx.lastName = randomLastName();
  console.log(`  Email: ${ctx.email}`);
  console.log(`  Name: ${ctx.firstName} ${ctx.lastName}`);
}

// Step 6: Fill the registration form (First Name, Last Name, Email, Terms) + Continue.
async function stepFillForm(ctx) {
  const { oauthPage, tag, firstName, lastName, email } = ctx;
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
  await snap(oauthPage, `${ctx.runIndex}_05_form_filled`);

  // Click Continue
  console.log(`${tag} [6/9] Clicking Continue...`);
  await clickFirst(oauthPage, [
    'button:has-text("Continue")', 'button:has-text("Next")',
    'button:has-text("Submit")', 'button:has-text("Create")',
    'button[type="submit"]', 'input[type="submit"]',
  ], 'Continue button', 3000);

  await sleep(rand(2000, 4000));
  await snap(oauthPage, `${ctx.runIndex}_05b_after_continue`);
}

// Step 7: Enter password (+ confirm) and Continue.
async function stepEnterPassword(ctx) {
  const { oauthPage, tag, CONFIG } = ctx;
  console.log(`${tag} [7/9] Entering password...`);
  let filled = false;
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
  await snap(oauthPage, `${ctx.runIndex}_06_password`);

  // Click Continue again
  console.log(`${tag} [7/9] Clicking Continue (password step)...`);
  await clickFirst(oauthPage, [
    'button:has-text("Continue")', 'button:has-text("Next")',
    'button:has-text("Submit")', 'button:has-text("Create")',
    'button:has-text("Sign up")', 'button[type="submit"]',
  ], 'Continue button (password)', 3000);

  await sleep(rand(2000, 4000));
  await snap(oauthPage, `${ctx.runIndex}_06b_after_password`);
}

module.exports = {
  stepCreateCredentials,
  stepFillForm,
  stepEnterPassword,
};
