# Auto Register

Multi-platform automated account registration bot using Playwright + temporary email.

## Supported Platforms

| Platform | Status |
|----------|--------|
| [Xiaomi MiMo API](https://platform.xiaomimimo.com) | Supported |
| More coming soon... | — |

## Features

- **Auto register** — fill form, select region, handle captcha (manual)
- **Temp email** — generate disposable email + auto-extract OTP verification code
- **Terms & agreements** — auto-check + confirm
- **Cookie consent** — auto-accept on every page
- **API key extraction** — create API key automatically + save to file
- **2captcha ready** — fill in API key, set `captchaMode: '2captcha'`

## Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)

## Installation

```bash
npm install
npx playwright install chromium
```

## Usage

```bash
npm run register
```

### Configuration

Edit the `CONFIG` section in `register.js`:

```js
const CONFIG = {
  registerUrl: 'https://...',    // platform registration URL
  consoleUrl: 'https://...',     // platform console URL
  password: 'PortoAuto2025!',    // account password
  region: 'Indonesia',           // region (auto-detected from URL)
  apiKeyName: 'auto-xxx',        // API key name prefix
  outputFile: 'test.txt',        // API key output file
  captchaMode: 'manual',         // 'manual' | '2captcha'
  captchaApiKey: '',             // fill in if using 2captcha
};
```

## Flow (11 steps)

| Step | Description |
|------|-------------|
| 1 | Launch Chromium browser |
| 2 | Generate temporary email |
| 3 | Open registration page + accept cookies |
| 4 | Region auto-detected |
| 5 | Fill email, password, confirm password, agree checkbox |
| 6 | Submit form + **manual captcha** (auto-detect solved) |
| 7 | Wait for OTP email → auto-extract → auto-fill |
| 8 | Terms & agreements (checklist + confirm) |
| 9 | Redirect to console + accept cookies |
| 10 | Navigate to API Keys → Create API Key |
| 11 | Extract API key → save to `test.txt` |

## Output

Format in `test.txt` (append, not overwrite):

```
# Auto Register - Generated 2026-06-19T...
Email: user_xxx@domain.com
Password: PortoAuto2025!
API Key Name: auto-xxx
API Key: sk-xxxxxxxxxxxxxxxxx
```

## File Structure

| File | Description |
|------|-------------|
| `register.js` | Main bot (Playwright) |
| `tempmail.js` | Temp email + OTP extractor (Node) |
| `tempmail.py` | Temp email + OTP extractor (Python) |
| `test.txt` | API key output (gitignored) |
| `*.png` | Debug screenshots (gitignored) |

## Screenshots

The script automatically saves screenshots at each step for debugging:
- `before_submit.png` — form before submission
- `api_keys_page.png` — API keys page
- `api_key_created.png` — after API key creation
- `error.png` — on error

## Notes

- Captcha must be solved manually (browser opens in visible mode)
- If selectors don't match, check the screenshots and update selectors in `register.js`
- Supabase anon key in `tempmail.js` is public
