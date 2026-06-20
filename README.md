# Auto Register

Multi-platform automated account registration bot using Playwright + temporary email.

## Supported Platforms

| Platform                                        | Script                | Command              |
| ----------------------------------------------- | --------------------- | -------------------- |
| [Xiaomi MiMo API](https://platform.xiaomimimo.com) | `register.js`       | `npm run register` |
| [Qoder](https://qoder.com) (via llm-agent-trade)   | `register_qoder.js` | `npm run qoder`    |

## Features

- **Auto register** — fill form, handle captcha, verify OTP
- **Temp email** — generate disposable email + auto-extract OTP verification code
- **Terms & agreements** — auto-check + confirm
- **Cookie consent** — auto-accept on every page
- **Human-like typing** — character-by-character with randomized delays (Qoder)
- **Anti-bot detection** — stealth plugin, webdriver removal, fake browser properties
- **Captcha solving** — auto (OpenCV puzzle solver) with manual fallback
- **Multi-tab support** — dashboard stays open, OAuth in new tab per run
- **Loop mode** — register multiple accounts in one session
- **2captcha ready** — fill in API key, set `captchaMode: '2captcha'` (Xiaomi)

## Prerequisites

- Node.js >= 18
- Python 3 + `opencv-python` (for puzzle captcha solver)
- Chromium (auto-installed via Playwright)

## Installation

```bash
npm install
npx playwright install chromium
pip install opencv-python
```

## Configuration

### Environment Variables (.env)

Sensitive credentials are stored in `.env` (gitignored):

```env
PLATFORM_PASSWORD=your_platform_password
PLATFORM_URL=https://your-platform-url.com
QODER_URL=https://your-platform-url.com/dashboard/providers/qoder
QODER_ACCOUNT_PASSWORD=your_account_password
```

### Xiaomi MiMo

Edit the `CONFIG` section in `register.js`:

```js
const CONFIG = {
  registerUrl: 'https://...',    // platform registration URL
  consoleUrl: 'https://...',     // platform console URL
  password: '...',               // account password
  region: 'Indonesia',           // region (auto-detected from URL)
  apiKeyName: 'auto-xxx',        // API key name prefix
  outputFile: 'keys.csv',        // CSV output file
  captchaMode: 'manual',         // 'manual' | '2captcha'
  captchaApiKey: '',             // fill in if using 2captcha
};
```

### Qoder

Edit the `CONFIG` section in `register_qoder.js`:

```js
const CONFIG = {
  // URLs & passwords from .env
  platformUrl: process.env.9ROUTER_URL,
  qoderUrl: process.env.QODER_URL,
  platformPassword: process.env.9ROUTER_PASSWORD,
  password: process.env.QODER_ACCOUNT_PASSWORD,
  // Other settings
  outputFile: 'keys.csv',
  loops: 5,                      // number of registration loops
  captchaMode: 'auto',           // 'manual' | 'auto' (puzzle solver + manual fallback)
};
```

## Usage

### Xiaomi MiMo

```bash
npm run register
```

### Qoder

```bash
npm run qoder
```

### Loop Mode (Xiaomi)

```bash
npm run loop
```

## Flow

### Xiaomi MiMo (11 steps)

| Step | Description                                            |
| ---- | ------------------------------------------------------ |
| 1    | Launch Chromium browser                                |
| 2    | Generate temporary email                               |
| 3    | Open registration page + accept cookies                |
| 4    | Region auto-detected                                   |
| 5    | Fill email, password, confirm password, agree checkbox |
| 6    | Submit form + captcha (manual/auto)                    |
| 7    | Wait for OTP email → auto-extract → auto-fill        |
| 8    | Terms & agreements (checklist + confirm)               |
| 9    | Redirect to console + accept cookies                   |
| 10   | Navigate to API Keys → Create API Key                 |
| 11   | Extract API key → save to `keys.csv`                |

### Qoder (9 steps per loop)

| Step | Description                                                |
| ---- | ---------------------------------------------------------- |
| 1/9  | Navigate to platform → login (first time only)            |
| 2/9  | Navigate to Qoder provider page                            |
| 3/9  | Click "Add" → opens new tab                               |
| 4/9  | OAuth: Sign in with another account → Sign up             |
| 5/9  | Create temp email + generate random name                   |
| 6/9  | Fill form (First Name, Last Name, Email, Terms) + Continue |
| 7/9  | Enter password + Continue                                  |
| 8/9  | Click to verify → captcha (auto puzzle solver / manual)   |
| 9/9  | Wait OTP email → auto-fill (Ant Design OTP component)     |

After each loop, the OAuth tab stays open and the dashboard navigates back to Qoder page for the next registration.

## Output

### Xiaomi MiMo

```csv
timestamp,email,password,api_key_name,api_key
"2026-06-19T12:00:00.000Z","user_xxx@domain.com","***","auto-xxx","sk-xxxxxxxxxxxxxxxxx"
```

### Qoder

```csv
timestamp,platform,first_name,last_name,email,password,status
"2026-06-19T12:00:00.000Z","qoder","John","Smith","user_xxx@moymoy.me","***","registered"
```

## File Structure

| File                         | Description                            |
| ---------------------------- | -------------------------------------- |
| `register.js`              | Xiaomi MiMo bot (Playwright)           |
| `register_qoder.js`        | Qoder bot (Playwright + multi-tab)     |
| `loop.js`                  | Xiaomi loop runner with proxy rotation |
| `tempmail.js`              | Temp email + OTP extractor (Node)      |
| `tempmail.py`              | Temp email + OTP extractor (Python)    |
| `captcha_ocr.py`           | Keras OCR for Xiaomi custom captcha    |
| `captcha_puzzle_solver.py` | OpenCV puzzle captcha solver (Aliyun)  |
| `.env`                     | Credentials (gitignored)               |
| `keys.csv`                 | Output data (gitignored)               |

## Notes

- Xiaomi: captcha must be solved manually (browser opens in visible mode)
- Qoder: captcha auto-solved via OpenCV puzzle solver, falls back to manual
- Qoder: OTP uses Ant Design component (`input.ant-otp-input`, `size="1"`)
- Qoder: Aliyun captcha (`#aliyunCaptcha-*`) — puzzle slider type
- If selectors don't match, update them in the respective script
- Supabase anon key in `tempmail.js` is public
