import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const config = getConfig();
  const bot = new Bot(config.BOT_TOKEN);

  try {
    const info = await bot.api.getWebhookInfo();
    console.log('\n--- Telegram Webhook Info ---');
    console.log(`URL: ${info.url || 'Not set (Polling Mode)'}`);
    console.log(`Pending Updates: ${info.pending_update_count}`);
    console.log(`IP Address: ${info.ip_address || 'None'}`);
    console.log(`Last Error Date: ${info.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : 'None'}`);
    console.log(`Last Error Message: ${info.last_error_message || 'None'}`);
    console.log('-----------------------------\n');
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to fetch webhook info');
  }
}

main();
