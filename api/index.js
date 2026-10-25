import fs from 'node:fs';
import path from 'node:path';
import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

/**
 * Root Node.js route handler for Vercel.
 * Serves the landing page with the bot name and centered circular logo with light blue gradients.
 * Also automatically links Telegram webhook to this Vercel deployment if not already connected.
 * Route: /
 */
export default async function handler(req, res) {
  try {
    const config = getConfig();
    const appName = config.APP_NAME || 'NyxGram';

    // Auto-register Telegram webhook if running on a live hosted domain (Vercel)
    const headers = req.headers || {};
    const host = headers['x-forwarded-host'] || headers.host;
    const proto = headers['x-forwarded-proto'] || 'https';
    if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
      const webhookUrl = `${proto}://${host}/api/telegram`;
      try {
        const bot = new Bot(config.BOT_TOKEN);
        const info = await bot.api.getWebhookInfo();
        if (info.url !== webhookUrl) {
          await bot.api.setWebhook(webhookUrl, {
            secret_token: config.WEBHOOK_SECRET || undefined,
            allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
            drop_pending_updates: false
          });
          logger.info({ webhookUrl }, 'Telegram webhook registered automatically');
        }
      } catch (err) {
        logger.warn({ error: err.message }, 'Notice: Automatic webhook check');
      }
    }

    // Try to read the logo image as base64 for reliable zero-latency rendering
    let logoDataUri = '/logo.jpg';
    const possiblePaths = [
      path.resolve(process.cwd(), './image/logo.jpg'),
      path.resolve(process.cwd(), './public/logo.jpg')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        try {
          const imgBuffer = fs.readFileSync(p);
          logoDataUri = `data:image/jpeg;base64,${imgBuffer.toString('base64')}`;
          break;
        } catch {
          // Fall back to /logo.jpg
        }
      }
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appName}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      background-color: #000000;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    /* Subtle background radial glow in light blue */
    .bg-glow {
      position: absolute;
      width: 500px;
      height: 500px;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.18) 0%, rgba(14, 165, 233, 0.05) 50%, transparent 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 1;
    }
    .container {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 2rem;
    }
    /* Outer glowing circle with light blue gradient border */
    .logo-wrapper {
      position: relative;
      width: 170px;
      height: 170px;
      border-radius: 50%;
      padding: 4px;
      background: linear-gradient(135deg, #38bdf8 0%, #0284c7 50%, #bae6fd 100%);
      box-shadow: 0 0 35px rgba(56, 189, 248, 0.4), 0 0 70px rgba(14, 165, 233, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 2rem;
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .logo-wrapper:hover {
      transform: scale(1.04);
      box-shadow: 0 0 45px rgba(56, 189, 248, 0.6), 0 0 90px rgba(14, 165, 233, 0.3);
    }
    .logo-img {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      display: block;
      background-color: #000;
    }
    .bot-name {
      font-size: 2.8rem;
      font-weight: 700;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #ffffff 0%, #e0f2fe 40%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    @media (max-width: 480px) {
      .logo-wrapper {
        width: 140px;
        height: 140px;
      }
      .bot-name {
        font-size: 2.2rem;
      }
    }
  </style>
</head>
<body>
  <div class="bg-glow"></div>
  <div class="container">
    <div class="logo-wrapper">
      <img src="${logoDataUri}" alt="${appName} Logo" class="logo-img" />
    </div>
    <h1 class="bot-name">${appName}</h1>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).send('<h1>Internal Server Error</h1>');
  }
}
