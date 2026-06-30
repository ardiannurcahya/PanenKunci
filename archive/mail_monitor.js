import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://login.yahoo.com/');
  await page.getByRole('textbox', { name: 'Username, email or phone' }).fill('REDACTED_EMAIL');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('REDACTED_PASSWORD');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Lewati' }).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Check your mail' }).click();
  const page1 = await page1Promise;
  await page1.getByRole('button', { name: 'Belum dibaca' }).click();
  await page1.getByRole('link', { name: 'no-reply@fireworks.ai Verify your Fireworks account·Verify Your Email Address Wel… 12.52', exact: true }).click();
  const page3Promise = page1.waitForEvent('popup');
  await page1.goto('REDACTED_YAHOO_MAIL_URL');
  const page3 = await page3Promise;
  await page3.goto('REDACTED_CONFIRMATION_URL');
  await page1.goto('REDACTED_YAHOO_MAIL_URL');
  await page1.getByRole('button', { name: 'Dipilih, Email Masuk' }).click();
});
