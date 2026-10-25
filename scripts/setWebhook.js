import { Bot } from 'grammy';
import readline from 'node:readline';
import { getConfig } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const config = getConfig();
  const bot = new Bot(config.BOT_TOKEN);

  const defaultUrl = process.env.VERCEL_URL
    ? (process.env.VERCEL_URL.startsWith('http') ? process.env.VERCEL_URL : `https://${process.env.VERCEL_URL}`) + '/api/telegram'
    : '';

  const cliArg = process.argv[2]?.trim();
  let answer = cliArg;

  if (!answer) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const question = (query) => new Promise((resolve) => rl.question(query, resolve));
    const promptText = defaultUrl
      ? `Enter your Vercel deployment URL [default: ${defaultUrl}]: `
      : 'Enter your Vercel deployment URL (e.g., https://your-app.vercel.app): ';

    answer = (await question(promptText)).trim();
    rl.close();
  }

  let webhookUrl = answer || defaultUrl;
  if (!webhookUrl) {
    logger.error('No webhook URL provided. Exiting.');
    process.exit(1);
  }

  if (!webhookUrl.startsWith('http://') && !webhookUrl.startsWith('https://')) {
    webhookUrl = `https://${webhookUrl}`;
  }

  if (!webhookUrl.endsWith('/api/telegram')) {
    webhookUrl = `${webhookUrl.replace(/\/+$/, '')}/api/telegram`;
  }

  logger.info({ webhookUrl }, 'Setting Telegram webhook...');

  try {
    await bot.api.setWebhook(webhookUrl, {
      secret_token: config.WEBHOOK_SECRET || undefined,
      allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
      drop_pending_updates: false
    });

    logger.info('✅ Telegram webhook registered successfully!');
    const info = await bot.api.getWebhookInfo();
    console.log('\n--- Webhook Status ---');
    console.log(`URL: ${info.url}`);
    console.log(`Has Custom Certificate: ${info.has_custom_certificate}`);
    console.log(`Pending Update Count: ${info.pending_update_count}`);
    console.log(`Last Error Date: ${info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : 'None'}`);
    console.log(`Last Error Message: ${info.last_error_message || 'None'}`);
    console.log('----------------------\n');
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to set Telegram webhook');
    process.exit(1);
  }
}

main();
