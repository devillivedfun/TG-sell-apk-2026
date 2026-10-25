import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';

/**
 * Explicit one-click setup endpoint to link your Vercel URL to Telegram.
 * Route: /api/setup
 * Simply open https://your-project.vercel.app/api/setup in any browser!
 */
export default async function handler(req, res) {
  try {
    const config = getConfig();
    const headers = req.headers || {};
    const host = headers['x-forwarded-host'] || headers.host || 'localhost';
    const proto = headers['x-forwarded-proto'] || 'https';
    const baseUrl = `${proto}://${host}`;
    const webhookUrl = `${baseUrl}/api/telegram`;

    const bot = new Bot(config.BOT_TOKEN);
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false
    });

    const info = await bot.api.getWebhookInfo();

    return res.status(200).json({
      ok: true,
      message: 'Telegram webhook connected successfully!',
      webhook_url: info.url,
      pending_updates: info.pending_update_count,
      has_custom_certificate: info.has_custom_certificate
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
