import { Bot } from 'grammy';
import { getConfig } from '../src/config.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const config = getConfig();
  const bot = new Bot(config.BOT_TOKEN);

  try {
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    logger.info('✅ Telegram webhook deleted successfully.');
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to delete webhook');
  }
}

main();
