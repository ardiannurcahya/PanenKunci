# Auto Register

Multi-platform automated account registration bots using Playwright (Node.js, CommonJS) + temporary email.

## Supported Platforms

| Platform | Script | Command |
|----------|--------|---------|
| [Xiaomi MiMo](https://platform.xiaomimimo.com) | `src/bots/xiaomi/register.js` | `npm run register` |
| [Alibaba Cloud](https://account.alibabacloud.com) | `src/bots/alibaba/register.js` | `npm run alibaba` |
| [Qoder](https://qoder.com) | `src/bots/qoder/register.js` | `npm run qoder` |
| [Fireworks AI](https://app.fireworks.ai) | `src/bots/fireworks/register.js` | `npm run fireworks` |

## Prerequisites

- Node.js >= 18
- Chromium (auto-installed via Playwright)

## Installation

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
│   │   └── fireworks/        # Fireworks AI bot
│   └── lib/                  # Shared utilities
│       ├── env.js            # .env loader
│       ├── helpers.js        # sleep, rand, typeHuman, etc.
│       ├── names.js          # Random name generator
│       ├── tempmail.js       # Supabase temp email + OTP
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

## Configuration

### Environment Variables (.env)

```env
PLATFORM_PASSWORD=your_platform_password
PLATFORM_URL=https://your-platform-url.com
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

## Commands

```bash
# Single registration
npm run register              # Xiaomi MiMo
npm run alibaba               # Alibaba Cloud
npm run qoder                 # Qoder
npm run fireworks             # Fireworks AI (reads data/config.json)
npm run fireworks-login       # Fireworks login-only (reads data/password.txt)

# Multi-worker
npm run fireworks-multi       # Fireworks 5 concurrent workers
npm run multi-loop            # Alibaba concurrent workers
npm run multi-loop-mimo       # Xiaomi concurrent workers

# Loop mode
npm run loop                  # Xiaomi loop mode (proxy rotation)

# Verification
npm run verify                # Fireworks email verifier (Yahoo inbox monitor)

# Utilities
npm run fireworks-emails      # Generate 100 disposable Yahoo emails → data/config.json
npm run tempmail              # Test temp email helper
```

---

## Fireworks AI — Complete Workflow

Fireworks AI differs from other bots because it does **not** use temp email. It requires real Yahoo email addresses for verification.

### Prerequisites: Yahoo Plus & Disposable Email Setup

You need a Yahoo account with **disposable email address** support. This is a Yahoo Plus feature that lets you create alias addresses — all emails sent to these aliases arrive in your main Yahoo inbox.

**What is a base address?**

A base address is the disposable email prefix you create in Yahoo. For example, if your base address is `naidracn123`, you can generate aliases like `naidracn123-fw01@yahoo.com`, `naidracn123-fw02@yahoo.com`, etc. All of these arrive in your main Yahoo inbox.

**How to set up (one-time, manual):**

1. Log in to your Yahoo Mail account
2. Go to **Settings** (gear icon) → **More Settings**
3. Click **Writing email** tab → **Disposable email addresses**
4. Click **Create a base address** (e.g. `naidracn123`)
5. Remember this base address — you'll need it for `.env`

### Step 1: Add Yahoo Credentials to .env

Set the following in `.env`:

```env
YAHOO_EMAIL=your_main_yahoo@yahoo.com
YAHOO_PASSWORD=your_yahoo_password
YAHOO_BASE_ADDRESS=naidracn123
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
- Save checkpoint every 10 emails (merges with existing `data/config.json` if present)
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

## Other Platforms

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

```bash
npm run alibaba               # single run
npm run multi-loop            # concurrent workers (tiled windows)
```

The registration form is inside an `#alibaba-register-box` iframe. Captcha: CapMonster (Aliyun slider) + manual fallback.

### Qoder

```bash
npm run qoder
```

Modular steps in `src/bots/qoder/steps/`. Captcha: CapMonster (Aliyun slider) + manual fallback. OTP: Ant Design component (`input.ant-otp-input`).

---

## Output Files

| Platform | File | Columns |
|----------|------|---------|
| Xiaomi/Qoder | `output/keys.csv` | timestamp, email, password, api_key_name, api_key |
| Alibaba | `output/alibaba.csv` | timestamp, email, password, api_key |
| Fireworks | `output/fireworks.csv` | email, password, apikey |
| Fireworks multi-worker | `output/fireworks_worker_N.csv` | email, password, apikey |
| Fireworks login-only | `output/fireworks3.csv` | email, password, apikey |

All output files are gitignored.

## Notes

- Xiaomi, Qoder, Alibaba run **headed** (browser visible) for captcha fallback
- Fireworks runs **headless**
- Temp email: `moymoy.me` domain via Supabase (Xiaomi, Qoder, Alibaba)
- Fireworks: real Yahoo inboxes from `data/config.json`
- `.env` loaded by `src/lib/env.js` (not dotenv), does NOT overwrite existing env vars
- CommonJS throughout — use `require()`, not `import`
- If selectors don't match, update them in the respective script
