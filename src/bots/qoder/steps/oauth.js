// Steps 3 & 4: open the OAuth tab via the "Add" button, then drive the OAuth
// page to the sign-up form ("Sign in with another account" -> "Sign up").

const { sleep, rand, clickFirst, snap } = require('./_shared');

// Step 3: Click "Add" button which opens a new tab; store the OAuth page on ctx.
async function stepOpenOAuth(ctx) {
  const { dashPage, context, tag } = ctx;
  console.log(`${tag} [3/9] Clicking Add button...`);

  const [newTab] = await Promise.all([
    context.waitForEvent('page', { timeout: 10000 }).catch(() => null),
    clickFirst(dashPage, [
      'button:has-text("Add")',
      'a:has-text("Add")',
      'button:has-text("add")',
      'button:has-text("Add Account")',
      'button:has-text("Add account")',
      'button:has-text("Tambah")',
      '[class*="add" i]',
      'button:has-text("+")',
    ], 'Add button', 5000),
  ]);

  if (!newTab) {
    await snap(dashPage, `${ctx.runIndex}_02_no_new_tab`);
    throw new Error('Add button did not open new tab');
  }

  ctx.oauthPage = newTab;
  const oauthPage = newTab;
  await oauthPage.waitForLoadState('domcontentloaded');
  await sleep(rand(2000, 3000));
  await snap(oauthPage, `${ctx.runIndex}_02_new_tab`);
  console.log('  New tab opened, switched to OAuth page');
}

// Step 4: Drive the OAuth page from the account picker to the sign-up form.
async function stepHandleOAuth(ctx) {
  const { oauthPage, tag } = ctx;
  console.log(`${tag} [4/9] Handling OAuth page...`);
  await sleep(rand(2000, 3000));
  await snap(oauthPage, `${ctx.runIndex}_03_oauth_page`);

  // Click "Sign in with another account" if visible
  await clickFirst(oauthPage, [
    'text="Sign in with another account"',
    'text="Sign in with a different account"',
    'text="Use another account"',
    'a:has-text("another account")',
    'button:has-text("another account")',
    'text="Sign in with another"',
  ], 'Sign in with another account', 3000);

  await sleep(rand(1500, 3000));
  await snap(oauthPage, `${ctx.runIndex}_03b_after_another_account`);

  // Click "Sign up"
  const signUpClicked = await clickFirst(oauthPage, [
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

  if (!signUpClicked) {
    await snap(oauthPage, `${ctx.runIndex}_03c_no_signup`);
    throw new Error('Sign up link not found');
  }
  await sleep(rand(2000, 4000));
  await snap(oauthPage, `${ctx.runIndex}_03c_signup_page`);
}

module.exports = {
  stepOpenOAuth,
  stepHandleOAuth,
};
