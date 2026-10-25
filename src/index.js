import { getConfig } from './config.js';
import { logger } from './utils/logger.js';
import { getDatabase, closeDatabase } from './database/connection.js';
import { createRepositories } from './database/repositories.js';
import { createBot } from './bot.js';

/**
 * Initializes and verifies the bot configuration, database connection, and Telegram commands.
 */
export async function initializeApplication() {
  logger.info('==========================================');
  logger.info('Telegram Stars Sales Bot (Vercel Serverless)');
  logger.info('==========================================');

  const config = getConfig();
  logger.info(
    {
      appName: config.APP_NAME,
      appVersion: config.APP_VERSION,
      priceStars: config.PRICE_STARS,
      currency: config.CURRENCY,
      apkPath: config.APK_PATH,
      adminId: config.ADMIN_TELEGRAM_ID,
      supportUsername: config.CLEAN_SUPPORT_USERNAME
    },
    'Configuration loaded and validated successfully'
  );

  // Initialize and verify MongoDB connection
  let db;
  let repositories;
  try {
    db = await getDatabase();
    repositories = createRepositories(db);
    logger.info('MongoDB Atlas connected and indexes verified');
  } catch (err) {
    logger.fatal({ error: err.message }, 'Failed to connect to MongoDB Atlas');
    throw err;
  }

  // Create Bot
  const bot = createBot({ config, db, repositories });

  // Register public menu commands with Telegram
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: `Open ${config.APP_NAME} Store menu` },
      { command: 'buy', description: `Purchase ${config.APP_NAME} with Stars` },
      { command: 'stars', description: 'Stars payment screen' },
      { command: 'myorders', description: 'View your order history' },
      { command: 'help', description: 'Support and purchase guidelines' }
    ]);
    logger.info('Bot commands registered with Telegram API');
  } catch (err) {
    logger.warn({ error: err.message }, 'Could not register bot commands with Telegram (skipped)');
  }

  return { bot, db, repositories, config };
}

// When executed directly (e.g. `npm start` or `node src/index.js`), run in Local Long Polling mode
if (process.argv[1] && process.argv[1].endsWith('src/index.js')) {
  initializeApplication()
    .then(async ({ bot, config }) => {
      // Ensure any lingering webhook is removed so local getUpdates polling succeeds
      try {
        await bot.api.deleteWebhook({ drop_pending_updates: false });
      } catch (err) {
        logger.warn({ error: err.message }, 'Notice when clearing webhook for local polling');
      }

      // Start long polling for local testing
      bot.start({
        drop_pending_updates: false,
        onStart: (info) => {
          logger.info('==========================================');
          logger.info({ botUsername: info.username }, '🚀 Bot is running locally in Long Polling mode!');
          logger.info(`Send /start to @${info.username} on Telegram to test.`);
          logger.info('Press Ctrl+C to stop.');
          logger.info('==========================================');
        }
      });

      // Handle graceful shutdown on Ctrl+C or kill
      const handleShutdown = async (signal) => {
        logger.info({ signal }, 'Stopping local bot...');
        try {
          bot.stop();
          await closeDatabase();
          logger.info('Local bot stopped cleanly.');
        } catch (err) {
          logger.error({ err }, 'Error during local bot shutdown');
        }
        process.exit(0);
      };

      process.once('SIGINT', () => handleShutdown('SIGINT'));
      process.once('SIGTERM', () => handleShutdown('SIGTERM'));
    })
    .catch((err) => {
      logger.fatal({ err }, 'Initialization failed');
      process.exit(1);
    });
}
