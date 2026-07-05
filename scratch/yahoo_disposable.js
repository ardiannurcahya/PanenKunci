const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://login.yahoo.com/');
  await page.getByRole('textbox', { name: 'Username, email or phone' }).click();
  await page.getByRole('textbox', { name: 'Username, email or phone' }).fill('REDACTED_EMAIL');
  await page.getByRole('textbox', { name: 'Username, email or phone' }).press('Enter');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).click();
  await page.getByRole('textbox', { name: 'Password' }).fill('REDACTED_PASSWORD');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Lewati' }).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Check your mail' }).click();
  const page1 = await page1Promise;
  await page1.getByRole('button', { name: 'Lainnya Lainnya' }).click();
  await page1.getByText('Pengaturan').click();
  await page1.getByRole('tab', { name: 'Kotak email' }).click();
  await page1.getByRole('button', { name: 'Tambahkan alamat email sekali' }).click();
  await page1.getByRole('textbox', { name: 'Tambahkan kata kunci' }).click();
  await page1.getByRole('textbox', { name: 'Tambahkan kata kunci' }).fill('kata-kunci');
  await page1.getByRole('button', { name: 'Simpan' }).click();
  await page1.getByRole('button', { name: 'Tambahkan alamat email sekali' }).click();
  await page1.getByRole('textbox', { name: 'Tambahkan kata kunci' }).click();
  await page1.getByRole('textbox', { name: 'Tambahkan kata kunci' }).fill('kata-kunci2');
  await page1.getByRole('button', { name: 'Simpan' }).click();
  await page1.close();
  await page.close();

  // ---------------------
  await context.close();
  await browser.close();
})();