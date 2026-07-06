<div align="center">

# 🌥 PanenKunci

### Multi-platform automated account registration bots

![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?logo=node.js&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-1.61-2EAD33?logo=playwright&logoColor=white)
![CommonJS](https://img.shields.io/badge/Module-CommonJS-F7DF1E)
![Platform](https://img.shields.io/badge/Platforms-5-blue)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

**Playwright** · **Temporary Email** · **Real Chrome CDP** · **Captcha Solving** · **Multi-worker**

</div>

---

> ⚠️ **Disclaimer:** This repository is for fun and automation experimentation. The author is not responsible for any misuse. Use at your own risk and in compliance with the terms of service of each platform.

## ✨ Features

- 🔓 **5 platform bots** — Xiaomi MiMo, Alibaba Cloud, Qoder, Fireworks AI, Cloudflare
- 📧 **Temp email + Yahoo** — Supabase disposable emails (Xiaomi/Qoder/Alibaba), real Yahoo inboxes (Fireworks/Cloudflare)
- 🧩 **Captcha solving** — recaptcha-solver (free), 2Captcha, CapMonster (Aliyun slider, Turnstile)
- ⚡ **Multi-worker** — concurrent registration with tiled windows (Alibaba, Xiaomi, Fireworks)
- 🔄 **Loop mode** — proxy rotation for continuous registration
- 🔑 **API key extraction** — auto-create and harvest API keys to CSV
- 📊 **Provider upload** — push keys to the llm-agent-trade dashboard (anti-duplikat)

## 📋 Supported Platforms

| Platform                                         | Script                              | Command                | Free Tier                                  |
| ------------------------------------------------ | ----------------------------------- | ---------------------- | ------------------------------------------ |
| [Xiaomi MiMo](https://platform.xiaomimimo.com)    | `src/bots/xiaomi/register.js`     | `npm run register`   | ✅ Yes ($0.72 credits)                     |
| [Alibaba Cloud](https://account.alibabacloud.com) | `src/bots/alibaba/register.js`    | `npm run alibaba`    | ⚠️ No (Free tier is no longer supported) |
| [Qoder](https://qoder.com)                        | `src/bots/qoder/register.js`      | `npm run qoder`      | ⚠️ No (Free tier is no longer supported) |
| [Fireworks AI](https://app.fireworks.ai)          | `src/bots/fireworks/register.js`  | `npm run fireworks`  | ⚠️ No (Free tier is no longer supported) |
| [Cloudflare](https://dash.cloudflare.com)         | `src/bots/cloudflare/register.js` | `npm run cloudflare` | ✅ Yes (reset 10 credit/day)               |

## 📦 Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)

## 🛠 Installation

```bash
npm install
npx playwright install chromium
```

## Project Structure

```
automation/
├── src/
│   ├── bots/
│   │   ├── xiaomi/           # Xiaomi MiMo bot
│   │   ├── qoder/            # Qoder bot (modular steps)
│   │   ├── alibaba/          # Alibaba Cloud bot
│   │   ├── fireworks/        # Fireworks AI bot
│   │   └── cloudflare/       # Cloudflare bot (real Chrome via CDP)
│   └── lib/                  # Shared utilities
│       ├── env.js            # .env loader
│       ├── helpers.js        # sleep, rand, typeHuman, etc.
│       ├── names.js          # Random name generator
│       ├── tempmail.js       # Supabase temp email + OTP, thanks to https://mocasus.my.id for providing the email service.
│       ├── csv.js            # CSV read/write with file locking
│       ├── captcha.js        # 2Captcha solver
│       ├── capmonster.js     # CapMonster solver
│       └── ffmpeg.js         # ffmpeg path finder
├── data/                     # Config input files
├── output/                   # CSV output files (gitignored)
├── scripts/                  # Python standalone scripts
├── archive/                  # Deprecated files (gitignored)
├── .env                      # Credentials (gitignored)
└── package.json
```

## ⚙️ Configuration

### Environment Variables (.env)

```env
PLATFORM_9ROUTER_PASSWORD=your_PLATFORM_9ROUTER_PASSWORD
PLATFORM_9ROUTER_URL=https://your-platform-url.com
QODER_URL=https://your-platform-url.com/dashboard/providers/qoder
QODER_ACCOUNT_PASSWORD=your_account_password
ALIBABA_PASSWORD=your_alibaba_password
CAPMONSTER_API_KEY=your_capmonster_key
PROXY=http://user:pass@host:port
SOLVECAPTCHA_API_KEY=your_solvecaptcha_key
YAHOO_EMAIL=your_yahoo_email
YAHOO_PASSWORD=your_yahoo_password
YAHOO_BASE_ADDRESS=your_disposable_base_address
```

## 🚀 Commands

```bash
# Single registration
npm run register              # Xiaomi MiMo
npm run alibaba               # Alibaba Cloud
npm run qoder                 # Qoder
npm run fireworks             # Fireworks AI (reads data/config.json)
npm run fireworks-login       # Fireworks login-only (reads data/password.txt)
npm run cloudflare            # Cloudflare register (loops unused emails in data/config.json)
npm run cloudflare-login      # Cloudflare login-only (email + password as CLI args, or auto-pick from CSV)

# Multi-worker
npm run fireworks-multi       # Fireworks 5 concurrent workers
npm run multi-loop            # Alibaba concurrent workers
npm run multi-loop-mimo       # Xiaomi concurrent workers

# Loop mode
npm run loop                  # Xiaomi loop mode (proxy rotation)

# Verification
npm run verify                # Fireworks email verifier (Yahoo inbox monitor)

# Provider upload (push Cloudflare API keys to llm-agent-trade dashboard)
npm run cloudflare-provider   # Upload all cloudflare.csv rows that have an api_key (anti-duplikat)

# Utilities
npm run fireworks-emails      # Generate 100 disposable Yahoo emails → data/config.json
npm run tempmail              # Test temp email helper
```

---

## 🎆 Fireworks AI — Complete Workflow

Fireworks AI differs from other bots because it does **not** use temp email. It requires real Yahoo email addresses for verification.

### Prerequisites: Yahoo Plus & Disposable Email Setup

You need a Yahoo account with **disposable email address** support. This is a Yahoo Plus feature that lets you create alias addresses — all emails sent to these aliases arrive in your main Yahoo inbox.

**What is a base address?**

A base address is the disposable email prefix you create in Yahoo. For example, if your base address is `naidracn123`, you can generate aliases like `naidracn123-fw01@yahoo.com`, `naidracn123-fw02@yahoo.com`, etc. All of these arrive in your main Yahoo inbox.

**How to set up (one-time, manual):**

1. Log in to your Yahoo Mail account
2. Go to **Settings** (gear icon) → **More Settings**
3. Click **Writing email** tab → **Disposable email addresses**
4. Click **Create a base address** (e.g. nasihnjayahs)
5. Remember this base address — you'll need it for `.env`

### Step 1: Add Yahoo Credentials to .env

Set the following in `.env`:

```env
YAHOO_EMAIL=your_main_yahoo@yahoo.com
YAHOO_PASSWORD=your_yahoo_password
YAHOO_BASE_ADDRESS=your_base_address
```

- `YAHOO_EMAIL` / `YAHOO_PASSWORD` — your main Yahoo account login (used by generator + verifier)
- `YAHOO_BASE_ADDRESS` — the disposable base address you created in Yahoo (without `@yahoo.com`)

The generator uses `YAHOO_BASE_ADDRESS` to construct disposable emails like `{baseAddress}-fw01@yahoo.com`.

### Step 2: Generate Disposable Yahoo Emails

Run the email generator to automatically create 100 disposable Yahoo email addresses:

```bash
npm run fireworks-emails
```

The script will:

- Log in to Yahoo using `YAHOO_EMAIL` / `YAHOO_PASSWORD` from `.env`
- Navigate to Settings → Mailbox → Disposable email addresses
- Generate 100 disposable emails (keywords: `fw01`, `fw02`, ..., `fw100`)
- Format: `yourbaseaddress-fw01@yahoo.com`, `yourbaseaddress-fw02@yahoo.com`, etc.
- Save checkpoint every emails (merges with existing `data/config.json` if present)
- Output all emails to `data/config.json`

Edit `src/bots/fireworks/generate-emails.js` to change:

- `totalEmails`: number of emails to generate (default: 100)
- `keywordPrefix`: keyword prefix (default: `fw`)

**Manual alternative:** Log in to Yahoo → Settings → More Settings → Writing email → Disposable email addresses → Create addresses manually → Save them to `data/config.json`:

```json
{
  "emails": "email1@yahoo.com, email2@yahoo.com, email3@yahoo.com"
}
```

### Step 3: Run Email Verifier (FIRST — keep running)

**Start the verifier BEFORE running registration.** It monitors the Yahoo inbox and auto-clicks verification links:

```bash
npm run verify
```

The verifier will:

- Log in to Yahoo Mail using `YAHOO_EMAIL` / `YAHOO_PASSWORD`
- Monitor the unread inbox in real-time
- Search for **all** emails from `no-reply@fireworks.ai` per cycle (not just one)
- Auto-click the verification link in each email
- Immediately re-loop if new emails are found (no delay)
- Keep running until stopped (Ctrl+C)

**Keep the verifier running in a separate terminal throughout the entire registration process.**

### Step 4: Run Registration

Open a **new terminal** and start registration:

#### Single worker (sequential):

```bash
npm run fireworks
```

#### Multi-worker (5 parallel workers — recommended):

```bash
npm run fireworks-multi
```

For each email, the bot will:

1. Open the Fireworks signup page
2. Fill in email + auto-generated password
3. Click "Create Account"
4. Wait for email verification (handled by the verifier in the other terminal)
5. Log in with the newly created credentials
6. Fill in profile (First Name, Last Name, agree to terms)
7. Select random checkboxes (reasons + use cases)
8. Submit to get $6 credits
9. Create API Key → extract → save to CSV

Output: `output/fireworks.csv` (single) or `output/fireworks_worker_N.csv` (multi-worker)

### Step 5: Fallback — Login-Only (for verified emails that failed to get API key)

If registration fails at steps 6-9 (profile/API key) but the email is already verified, use login-only mode:

1. Create a file `data/password.txt` in tab-separated format:

```
email1@yahoo.com	password1
email2@yahoo.com	password2
email3@yahoo.com	password3
```

2. Run:

```bash
npm run fireworks-login
```

The bot will:

- Skip signup (go straight to login)
- Log in with email + password from the file
- Fill in profile + checkboxes + get credits
- Create API key
- Save to `output/fireworks3.csv`

### Fireworks Multi-Worker Configuration

Edit `src/bots/fireworks/multi-loop.js`:

```js
const CONCURRENT_WORKERS = 5;    // number of parallel workers
const PROXIES = [
  // 'http://user:pass@ip:port',
  // 'http://user:pass@ip:port',
];
```

Each worker gets a subset of emails and a separate output CSV (`fireworks_worker_N.csv`).

---

## ☁️ Cloudflare — Complete Workflow

Cloudflare is the most different from the other bots. It does **not** use Playwright's bundled Chromium — it launches your **real Google Chrome** via the Chrome DevTools Protocol (CDP). It also does **not** use temp email; like Fireworks it verifies via real Yahoo inboxes, and it shares the same email, default config is `data/config2.json` email pool as Fireworks.

### Prerequisites

- **Google Chrome installed** at the standard Windows path (`C:\Program Files\Google\Chrome\Application\chrome.exe`). Playwright's Chromium is not used for Cloudflare.
- **Yahoo credentials** in `.env` (`YAHOO_EMAIL`, `YAHOO_PASSWORD`) — used for email verification.
- **CapMonster API key** in `.env` (`CAPMONSTER_API_KEY`) — used for Cloudflare Turnstile captcha solving.
- **Emails in `data/config.json`** — the same comma-separated Yahoo email list used by Fireworks. Run `npm run fireworks-emails` to generate them, or add them manually.

> ⚠️ The Cloudflare bot **kills any running `chrome.exe`** before launching its own Chrome instance (to avoid CDP port conflicts). Close your normal Chrome tabs first.

### How it works

The bot launches real Chrome on debug port 9222, connects to it via `connectOverCDP`, and reuses a persistent profile at `output/chrome-cf-profile` (so Yahoo login sessions persist between runs).

For each unused email in `data/config.json`:

1. Open the Cloudflare signup page
2. Fill email + auto-generated password
3. Solve Cloudflare Turnstile (physical click → CapMonster `TurnstileTaskProxyless` → manual fallback)
4. Submit the signup form
5. Wait for the Cloudflare verification email (read inline from Yahoo Mail in a new tab)
6. Open the verification link (may have a second Turnstile)
7. Save the account to `output/cloudflare.csv` (status = `registered` → `verified`)
8. **Create an AI Gateway authentication token** (API key) — see below
9. Log out, then proceed to the next email

```bash
npm run cloudflare                     # loop all unused emails
npm run cloudflare -- email@yahoo.com  # single email
```

### Login-Only (for accounts that registered but weren't verified / no API key)

If signup succeeded but verification or API key creation failed, use login-only mode:

```bash
npm run cloudflare-login                                  # auto-picks last unverified row from cloudflare.csv
npm run cloudflare-login -- email@yahoo.com mypassword    # explicit email + password
```

The bot logs in, verifies the email via Yahoo, creates the API key, and updates the CSV status to `verified`.

### API Key creation (automatic)

After a successful verification, both `register` and `cloudflare-login` automatically call `src/bots/cloudflare/get-api-key.js`, which:

1. Opens a new tab → navigates to **AI Gateway** (`/{accountId}/ai/ai-gateway`)
2. Clicks **"Create authentication token"**
3. Fills the token name (defaults to `auto-<timestamp>`)
4. Submits the form
5. Captures the token (from the API response, with page-scrape fallback)
6. Appends it as an `api_key` column to the account's row in `cloudflare.csv`

This runs **before logout** — the account stays logged in, the key is created, then the bot logs out.

### Upload API keys to the provider dashboard (`cloudflare-provider`)

Once `cloudflare.csv` has rows with an `api_key`, push them to the `llm-agent-trade` provider dashboard:

```bash
npm run cloudflare-provider        # upload all rows that have an api_key (anti-duplikat)
npm run cloudflare-provider -- 3   # upload first 3 only (for testing)
```

This is a separate automation (`src/bots/cloudflare/add-provider.js`) that:

1. Logs in to `api.llm-agent-trade.my.id` (password from `PLATFORM_9ROUTER_PASSWORD`, URL from `PLATFORM_9ROUTER_URL`)
2. Opens **Providers → Cloudflare**
3. For each CSV row with an `api_key`: clicks **Add**, fills **Production Key** (= email/name), **password field** (= api_key), **account-id field** (= account_id), then **Save**
4. Repeats Add → Save for every row

**Fields are cleared before each fill** (the form retains the previous entry's values on the second Add).

**Anti-duplikat:** successfully uploaded emails are recorded in `output/cloudflare_provider.csv` (`email,status,timestamp`). Re-runs skip them and only process new entries. Failed entries (Save didn't close the form) are not marked and will be retried on the next run.

To watch it run (headed):

```powershell
$env:ADD_PROVIDER_HEADLESS='false'; npm run cloudflare-provider
```

---

## 📌 Other Platforms

### Xiaomi MiMo

```bash
npm run register              # single run
npm run loop                  # loop mode with proxy rotation
npm run multi-loop-mimo       # concurrent workers (tiled windows)
```

Edit CONFIG in `src/bots/xiaomi/register.js`:

- `captchaMode`: `'manual'` | `'audio'` | `'2captcha'`
- Default: `'audio'` (uses recaptcha-solver, offline/free)

### Alibaba Cloud

> ⚠️ **No longer offers a free tier** — Alibaba Cloud has stopped providing free credits/free-tier API access for new accounts. These bots may no longer yield usable free API keys.

```bash
npm run alibaba               # single run
npm run multi-loop            # concurrent workers (tiled windows)
```

The registration form is inside an `#alibaba-register-box` iframe. Captcha: CapMonster (Aliyun slider) + manual fallback.

### Qoder

> ⚠️ **No longer offers a free tier** — Qoder has stopped providing free credits/free-tier API access for new accounts. These bots may no longer yield usable oauth usages.

```bash
npm run qoder
```

Modular steps in `src/bots/qoder/steps/`. Captcha: CapMonster (Aliyun slider) + manual fallback. OTP: Ant Design component (`input.ant-otp-input`).

---

## 📁 Output Files

| Platform               | File                               | Columns                                           |
| ---------------------- | ---------------------------------- | ------------------------------------------------- |
| Xiaomi/Qoder           | `output/keys.csv`                | timestamp, email, password, api_key_name, api_key |
| Alibaba                | `output/alibaba.csv`             | timestamp, email, password, api_key               |
| Fireworks              | `output/fireworks.csv`           | email, password, apikey                           |
| Fireworks multi-worker | `output/fireworks_worker_N.csv`  | email, password, apikey                           |
| Fireworks login-only   | `output/fireworks3.csv`          | email, password, apikey                           |
| Cloudflare             | `output/cloudflare.csv`          | email, password, account_id, status, api_key      |
| Cloudflare provider    | `output/cloudflare_provider.csv` | email, status, timestamp                          |

All output files are gitignored.

## 📝 Notes

- Xiaomi and Fireworks run **headless**; Qoder and Alibaba run **headed** (browser visible) for captcha fallback
- Cloudflare launches your **real Google Chrome** via CDP (headed, visible) — Playwright's bundled Chromium is not used
- Temp email: `openfile.my.id` / `neorastorepl.my.id` / `moymoy.me` domains via Supabase (Xiaomi, Qoder, Alibaba)
- Fireworks & Cloudflare: real Yahoo inboxes from `data/config.json` (shared email pool)
- Cloudflare captcha is **Cloudflare Turnstile**. `register` uses a 3-tier fallback: **physical click → CapMonster (`TurnstileTaskProxyless`) → manual** (requires `CAPMONSTER_API_KEY`). `cloudflare-login` does **not** import CapMonster — it relies on **physical click → manual** only.
- Cloudflare also requires `YAHOO_EMAIL`/`YAHOO_PASSWORD` (verification) and real Chrome installed
- ⚠️ **Alibaba Cloud & Qoder no longer offer a free tier** — these bots may no longer produce usable free API keys
- `.env` loaded by `src/lib/env.js` (not dotenv), does NOT overwrite existing env vars
- CommonJS throughout — use `require()`, not `import`
- If selectors don't match, update them in the respective script
