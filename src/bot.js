import { Bot } from 'grammy';
import { logger } from './utils/logger.js';
import { createAdminOnlyMiddleware } from './middleware/adminOnly.js';
import { createRateLimitMiddleware } from './middleware/rateLimit.js';

import { handleStartCommand } from './commands/start.js';
import { handleBuyCommand } from './commands/buy.js';
import { handleHelpCommand } from './commands/help.js';
import { handleMyOrdersCommand } from './commands/orders.js';
import {
  handleAdminMenu,
  handleStatsCommand,
  handleOrdersCommand,
  handlePriceCommand,
  handleSetPriceCommand,
  handleSetVersionCommand,
  handleRetryDeliveryCommand,
  handleExportCommand
} from './commands/admin.js';

import { registerCallbackHandlers } from './handlers/callbacks.js';
import { registerPreCheckoutHandler } from './handlers/preCheckout.js';
import { registerSuccessfulPaymentHandler } from './handlers/successfulPayment.js';

import { OrderService } from './services/orderService.js';
import { InvoiceService } from './services/invoiceService.js';
import { PaymentService } from './services/paymentService.js';
import { DeliveryService } from './services/deliveryService.js';

/**
 * Creates and configures the grammY bot instance.
 *
 * @param {{
 *   config: ReturnType<typeof import('./config.js').getConfig>;
 *   db: import('mongodb').Db;
 *   repositories: ReturnType<typeof import('./database/repositories.js').createRepositories>;
 *   services?: {
 *     orderService?: OrderService;
 *     invoiceService?: InvoiceService;
 *     paymentService?: PaymentService;
 *     deliveryService?: DeliveryService;
 *   };
 *   botInstance?: Bot;
 * }} options
 * @returns {Bot}
 */
export function createBot({ config, db, repositories, services = {}, botInstance }) {
  const bot = botInstance || new Bot(config.BOT_TOKEN);

  // Initialize services
  const orderService = services.orderService || new OrderService(repositories.orders, repositories.settings, config);
  const invoiceService = services.invoiceService || new InvoiceService();
  const paymentService = services.paymentService || new PaymentService(db, repositories);
  const deliveryService = services.deliveryService || new DeliveryService(repositories.orders, config);

  // Global Error Handler
  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        updateId: ctx.update?.update_id,
        userId: ctx.from?.id,
        stack: error instanceof Error ? error.stack : undefined
      },
      'Unhandled error in Telegram Bot update processing'
    );
  });

  // Middleware 1: User Activity Tracker (updates `users` collection)
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      try {
        await repositories.users.upsert({
          telegramId: ctx.from.id,
          username: ctx.from.username || null,
          firstName: ctx.from.first_name || null
        });
      } catch (err) {
        logger.warn({ error: err.message }, 'Failed to record user activity in database');
      }
    }
    return next();
  });

  // Middleware 2: Rate Limiting
  bot.use(createRateLimitMiddleware({}, config));

  // Public Customer Commands
  bot.command('start', (ctx) => handleStartCommand(ctx, orderService));
  bot.command(['buy', 'stars'], (ctx) => handleBuyCommand(ctx, orderService));
  bot.command('help', (ctx) => handleHelpCommand(ctx, orderService));
  bot.command('myorders', (ctx) => handleMyOrdersCommand(ctx, orderService));

  // Admin Only Middleware & Commands
  const adminOnly = createAdminOnlyMiddleware(config);

  bot.command('admin', adminOnly, (ctx) => handleAdminMenu(ctx));
  bot.command('stats', adminOnly, (ctx) => handleStatsCommand(ctx, repositories.orders));
  bot.command('orders', adminOnly, (ctx) => handleOrdersCommand(ctx, repositories.orders));
  bot.command('price', adminOnly, (ctx) => handlePriceCommand(ctx, orderService));
  bot.command('setprice', adminOnly, (ctx) => handleSetPriceCommand(ctx, repositories.settings));
  bot.command('setversion', adminOnly, (ctx) => handleSetVersionCommand(ctx, repositories.settings));
  bot.command('retrydelivery', adminOnly, (ctx) => handleRetryDeliveryCommand(ctx, deliveryService));
  bot.command('export', adminOnly, (ctx) => handleExportCommand(ctx, repositories.orders));

  // Register Handlers
  registerCallbackHandlers(bot, { orderService, invoiceService, repositories, config });
  registerPreCheckoutHandler(bot, paymentService);
  registerSuccessfulPaymentHandler(bot, { paymentService, deliveryService });

  return bot;
}
