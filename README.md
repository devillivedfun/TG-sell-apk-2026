# Telegram Stars Sales Bot (Vercel Serverless + MongoDB Atlas)

A production-grade, secure Telegram Bot built with **Node.js (ES modules)**, **grammY**, and **MongoDB Atlas** to sell and automatically distribute Android applications (e.g., **NyxGram** / **XoGram**) using **Telegram Stars** (`XTR`), deployed serverless on **Vercel**.

---

## Table of Contents

- [Features](#features)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Project Directory Structure](#project-directory-structure)
- [Prerequisites](#prerequisites)
- [Environment Configuration (.env)](#environment-configuration-env)
- [Local Development & Testing](#local-development--testing)
- [Deploying to Vercel](#deploying-to-vercel)
  - [1. MongoDB Atlas Setup](#1-mongodb-atlas-setup)
  - [2. Deploy to Vercel](#2-deploy-to-vercel)
  - [3. Configure Environment Variables in Vercel](#3-configure-environment-variables-in-vercel)
  - [4. Register the Telegram Webhook](#4-register-the-telegram-webhook)
- [Customer & Admin Commands](#customer--admin-commands)
  - [Customer Commands](#customer-commands)
  - [Administrator Commands](#administrator-commands)
- [Access Key Generation (`SECRET_KEY`)](#access-key-generation-secret_key)
- [Telegram Stars Revenue & Payouts](#telegram-stars-revenue--payouts)
- [Webhook Management Scripts](#webhook-management-scripts)
- [Automated Tests](#automated-tests)

---

## Features

- **Vercel Serverless Architecture**: Fast, auto-scaling deployment using Telegram webhooks at `/api/telegram` with grammY's `webhookCallback`.
- **Official Telegram Stars (`XTR`) Integration**: Pure Telegram Stars invoice generation (`provider_token: ""`), pre-checkout verification, and instant confirmation handling.
- **MongoDB Atlas Persistence**: Connection caching across serverless invocations for users, orders, payment audit logs, and runtime settings overrides.
- **Automated Digital Goods Fulfillment**: Direct APK file delivery (`sendDocument`) bundled inside the deployment (`storage/`) immediately upon verified Stars payment.
- **6-Character Access Key Delivery**: Generates a secure HMAC-SHA256 access key on successful purchase and sends it to the buyer with the APK download.
- **Strict Security & Anti-Fraud**:
  - Webhook secret token validation (`X-Telegram-Bot-Api-Secret-Token`).
  - Strict numeric Telegram ID admin authorization (`ADMIN_TELEGRAM_ID`).
  - Cryptographically unpredictable invoice payloads (`crypto.randomBytes`).
  - Idempotent payment processing (duplicate webhook updates cannot trigger double delivery or double accounting).
  - Redaction of sensitive credentials (`BOT_TOKEN`) in Pino logs.
- **Dynamic Price & Version Overrides**: Administrators can update prices and versions on the fly using `/setprice` and `/setversion`.
- **Export & Analytics**: Paginated order inspection, sales metrics, and CSV export directly inside Telegram.

---

## Architecture & Tech Stack

| Component | Technology | Rationale |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v20+ or v22+ LTS) | Modern JavaScript ES Modules (`import`/`export`) |
| **Hosting Platform** | Vercel Serverless Functions | Serverless scalability with 0 maintenance servers |
| **Bot Framework** | grammY (`grammy`) | High performance, fully typed, maintained Telegram Bot API framework |
| **Database** | MongoDB Atlas (`mongodb`) | High availability, connection pooling, and automatic indexing |
| **Configuration** | Zod + dotenv | Fail-fast type-safe environment variable validation |
| **Logging** | Pino + pino-pretty | Structured JSON logging with automated credential redaction |
| **Testing** | Vitest | 100% offline automated unit, integration, and webhook test suite |

---

## Project Directory Structure

```text
├── api/
│   ├── telegram.js               # Vercel Serverless entry point for Telegram Webhook (/api/telegram)
│   └── health.js                 # Health check probe (/api/health)
├── src/
│   ├── index.js                  # Initialization & local connectivity verification
│   ├── config.js                 # Zod environment schema & validation
│   ├── bot.js                    # Bot factory, middlewares, and command registration
│   ├── commands/
│   │   ├── start.js              # /start handler with interactive store menu
│   │   ├── buy.js                # /buy & /stars handler with invoice triggering
│   │   ├── help.js               # /help guidelines and support contact
│   │   ├── orders.js             # /myorders customer history
│   │   └── admin.js              # /admin, /stats, /orders, /setprice, /setversion, /export
│   ├── handlers/
│   │   ├── callbacks.js          # Inline keyboard routing & actions
│   │   ├── preCheckout.js        # Telegram pre_checkout_query verification & approval
│   │   └── successfulPayment.js  # Payment settlement, key generation & APK delivery trigger
│   ├── services/
│   │   ├── orderService.js       # Order creation, formatting, and override resolution
│   │   ├── invoiceService.js     # Telegram Stars invoice payload generator
│   │   ├── paymentService.js     # Verification & idempotent transaction logic
│   │   └── deliveryService.js    # APK delivery, access key creation, and admin redelivery
│   ├── database/
│   │   ├── connection.js         # MongoDB connection manager & index assertion
│   │   ├── repositories.js       # Repositories (users, orders, paymentEvents, settings)
│   │   └── mockDb.js             # In-memory MongoDB mock for offline tests
│   ├── middleware/
│   │   ├── adminOnly.js          # Strict numeric user ID authorization guard
│   │   └── rateLimit.js          # Memory-safe sliding-window rate limiter
│   └── utils/
│       └── logger.js             # Pino structured logger with secret redaction
├── storage/                      # Directory holding the distributable Android APK (bundled on Vercel)
│   └── NyxGram.apk
├── scripts/                      # Webhook management utility scripts
│   ├── setWebhook.js             # Registers your Vercel deployment URL with Telegram
│   ├── getWebhookInfo.js         # Checks current webhook status and error details
│   └── deleteWebhook.js          # Removes webhook if switching back or resetting
├── tests/                        # Vitest automated test suite (53 tests, 9 suites)
├── generator.js                  # Access key and HMAC signature generator
├── vercel.json                   # Vercel serverless function configuration (includes storage/**)
├── package.json                  # Dependencies and NPM scripts
├── .env.example                  # Environment template
└── README.md                     # Documentation
```

---

## Prerequisites

- **Node.js**: Version 20.x, 22.x, or 24.x LTS.
- **Telegram Bot Token**: Created via [@BotFather](https://t.me/BotFather).
- **MongoDB Atlas Cluster**: Free M0 Sandbox or dedicated cluster.
- **Vercel Account**: For deploying serverless functions.

---

## Environment Configuration (.env)

Your `.env` file should contain only valid environment variables:

```dotenv
BOT_TOKEN=your_bot_token_from_botfather
ADMIN_TELEGRAM_ID=123456789
WEBHOOK_SECRET=your_random_secret_token_at_least_32_chars
MONGODB_URI=mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/xogram_bot?retryWrites=true&w=majority
APP_NAME=NyxGram
APP_VERSION=12.10.1
APP_DESCRIPTION=Download NyxGram for Android & iOS
PRICE_STARS=199
APK_PATH=./storage/NyxGram.apk
SUPPORT_USERNAME=your_telegram_username
SECRET_KEY=your_secret_key_at_least_32_bytes_long
PORT=3000
```

> **Important Notes on Variables:**
> 1. **`MONGODB_URI`**: The database name (e.g. `/xogram_bot`) is included directly inside the connection string. No separate `MONGODB_DB_NAME` variable is needed.
> 2. **`VERCEL_URL`**: You do **not** need `VERCEL_URL` in `.env`. Vercel automatically exposes the deployment domain at runtime.
> 3. **`WEBHOOK_SECRET`**: Telegram will send this token in the `X-Telegram-Bot-Api-Secret-Token` header to guarantee that updates only come from Telegram.

---

## Dual Mode: Running Locally & Running After Hosting

This project is engineered to work in **both environments** seamlessly:

### 1. Running Locally (Development & Testing)
To test and run the bot on your local machine:
```bash
npm start
# or with auto-restart on code changes:
npm run dev
```

- The bot starts in **Long Polling mode** using your configured MongoDB Atlas database.
- It automatically resets any lingering webhook on Telegram so your local process receives updates instantly.
- You can open Telegram and test commands (`/start`, `/buy`, `/stats`), purchase with Stars, and test APK downloads.
- Press `Ctrl+C` to cleanly stop the local bot.

### 2. Running After Hosting (Vercel Serverless)
When you deploy to Vercel:
- Vercel automatically routes webhook updates to `/api/telegram`.
- Run the webhook registration script once with your Vercel URL:
  ```bash
  node scripts/setWebhook.js https://your-project.vercel.app
  ```
- Telegram will now forward all updates directly to your Vercel serverless functions 24/7.

> **Switching back and forth**:
> - Whenever you run `npm start` locally, it automatically clears the webhook and switches back to local polling.
> - Whenever you want Vercel to take over again, simply run `node scripts/setWebhook.js https://your-project.vercel.app`.

---

## Deploying to Vercel

### 1. MongoDB Atlas Setup

1. Create a free cluster on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
2. Under **Database Access**, create a user with read/write privileges (e.g., `admin`).
3. Under **Network Access**, add IP address `0.0.0.0/0` (Allow Access from Anywhere) so Vercel's serverless IP pool can connect.
4. Click **Connect** -> **Drivers** -> Copy the connection string.
5. Append your database name before query parameters:
   ```text
   mongodb+srv://<username>:<password>@cluster0.abcde.mongodb.net/xogram_bot?retryWrites=true&w=majority
   ```

### 2. Deploy to Vercel

You can deploy using either the Vercel CLI or by pushing to GitHub/GitLab:

#### Option A: Vercel CLI
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy project
vercel
```

#### Option B: Vercel Dashboard
1. Push your repository to GitHub or GitLab.
2. Go to [vercel.com](https://vercel.com) and click **Add New Project**.
3. Import your repository.

### 3. Configure Environment Variables in Vercel

In the Vercel Project Settings under **Environment Variables**, add:

| Key | Description | Example |
| :--- | :--- | :--- |
| `BOT_TOKEN` | Token provided by @BotFather | `8708291202:AAHOlj...` |
| `ADMIN_TELEGRAM_ID` | Numeric Telegram ID of administrator | `8878240036` |
| `WEBHOOK_SECRET` | 32+ character secret for webhook auth | `4c9a8b736504123deacb8791052f4d1e` |
| `MONGODB_URI` | MongoDB Atlas URI with database name | `mongodb+srv://user:pass@cluster.mongodb.net/xogram_bot?retryWrites=true&w=majority` |
| `APP_NAME` | Display name of the application | `NyxGram` |
| `APP_VERSION` | Application release version | `12.10.1` |
| `APP_DESCRIPTION` | Short product description | `Download NyxGram for Android & iOS` |
| `PRICE_STARS` | Default price in Telegram Stars | `199` |
| `APK_PATH` | Path to APK relative to repository root | `./storage/NyxGram.apk` |
| `SUPPORT_USERNAME` | Support handle (without @) | `NyxGir1` |
| `SECRET_KEY` | HMAC secret for key generation | `ccf3372619193c40...` |

Redeploy the project if environment variables were added after first build.

### 4. Register the Telegram Webhook

Once your project is deployed on Vercel, register your webhook with Telegram:

```bash
# Pass your Vercel URL directly:
node scripts/setWebhook.js https://your-project.vercel.app

# Or run interactively:
npm run webhook:set
```

To verify the registration status:
```bash
npm run webhook:info
```

---

## Customer & Admin Commands

### Customer Commands

- `/start` - Displays the welcome store greeting, product description, and navigation buttons.
- `/buy` or `/stars` - Displays the product card with the configured Stars price and purchase button.
- `/myorders` - Displays past purchases with Order ID, version, Stars amount, payment status, and delivery status.
- `/help` - Displays step-by-step guidance and support contact links.

### Administrator Commands

> Only the Telegram account matching `ADMIN_TELEGRAM_ID` is authorized. Non-admins receive an access denied message.

| Command | Description | Example |
| :--- | :--- | :--- |
| `/admin` | Displays the admin control panel. | `/admin` |
| `/stats` | Shows total orders, sales, pending invoices, and recorded Stars volume. | `/stats` |
| `/orders` | Paginated list of recent orders. | `/orders` or `/orders 2` |
| `/orders <ID>` | Deep inspection of an order (charge ID, timestamps, errors). | `/orders ORD-1729600000-A1B2` |
| `/price` | Shows the active Stars price and its source. | `/price` |
| `/setprice <N>` | Updates the price in MongoDB; takes effect immediately. | `/setprice 250` |
| `/setversion <V>`| Updates the app version in MongoDB; takes effect immediately. | `/setversion 12.10.2` |
| `/retrydelivery <ID>`| Retries delivery for a paid order whose upload failed. | `/retrydelivery ORD-1729600000-A1B2` |
| `/export` | Exports all database order records as a CSV spreadsheet. | `/export` |

---

## Access Key Generation (`SECRET_KEY`)

When a customer completes a purchase, the bot automatically generates a 6-character access key derived from `SECRET_KEY` using HMAC-SHA256 via `generator.js`.

The key is sent directly to the customer in the delivery message:
```text
🔑 Access Key: <b>AB12CD</b>
<i>Use this key to access the apk.</i>
⚠️ <b>Important:</b> Do not lose or share this key.
```

---

## Webhook Management Scripts

| Script | Command | Purpose |
| :--- | :--- | :--- |
| `setWebhook.js` | `npm run webhook:set` | Connects your Vercel deployment URL to Telegram Bot API |
| `getWebhookInfo.js` | `npm run webhook:info` | Fetches webhook status, pending updates count, and recent errors |
| `deleteWebhook.js` | `npm run webhook:delete` | Removes webhook registration from Telegram |

---

## Automated Tests

Run the Vitest test suite (includes in-memory MongoDB mock and mocked Telegram API calls):

```bash
# Run all automated tests
npm test

# Run tests in watch mode
npm run test:watch
```

All 9 test suites run completely offline without requiring internet access or a live database.
