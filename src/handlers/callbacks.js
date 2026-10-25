import { InlineKeyboard } from 'grammy';
import { handleCreateInvoice, handleBuyCommand } from '../commands/buy.js';
import { handleStartCommand } from '../commands/start.js';
import { handleHelpCommand } from '../commands/help.js';
import { handleStatsCommand, handleExportCommand } from '../commands/admin.js';
import { isAdmin } from '../middleware/adminOnly.js';
import { logger } from '../utils/logger.js';

/**
 * Registers and routes all inline keyboard callback queries.
 *
 * @param {import('grammy').Bot} bot
 * @param {{
 *   orderService: import('../services/orderService.js').OrderService;
 *   invoiceService: import('../services/invoiceService.js').InvoiceService;
 *   repositories: ReturnType<typeof import('../database/repositories.js').createRepositories>;
 *   config?: ReturnType<typeof import('../config.js').getConfig>;
 * }} context
 */
export function registerCallbackHandlers(bot, { orderService, invoiceService, repositories, config }) {
  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from?.id;

    logger.debug({ userId, callbackData: data }, 'Handling callback query');

    try {
      // 1. User Store Callbacks
      if (data === 'cb_buy') {
        await ctx.answerCallbackQuery();
        await handleBuyCommand(ctx, orderService);
        return;
      }

      if (data === 'cb_create_invoice') {
        await ctx.answerCallbackQuery({ text: 'Generating Telegram Stars invoice...' });
        await handleCreateInvoice(ctx, orderService, invoiceService);
        return;
      }

      if (data === 'cb_info') {
        await ctx.answerCallbackQuery();
        const text = await orderService.formatInfoMessage();
        const product = await orderService.getProductSnapshot();
        const keyboard = new InlineKeyboard()
          .text(`⭐ Buy ${product.appName}`, 'cb_buy')
          .row()
          .text('🔙 Back to Store', 'cb_back_store');

        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        return;
      }

      if (data === 'cb_version') {
        await ctx.answerCallbackQuery();
        const text = await orderService.formatVersionMessage();
        const product = await orderService.getProductSnapshot();
        const keyboard = new InlineKeyboard()
          .text(`⭐ Buy ${product.appName}`, 'cb_buy')
          .row()
          .text('🔙 Back to Store', 'cb_back_store');

        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML' });
        return;
      }

      if (data === 'cb_help') {
        await ctx.answerCallbackQuery();
        await handleHelpCommand(ctx, orderService);
        return;
      }

      if (data === 'cb_back_store') {
        await ctx.answerCallbackQuery();
        await handleStartCommand(ctx, orderService);
        return;
      }

      // 2. Admin Quick Actions
      if (data.startsWith('admin_')) {
        if (!isAdmin(userId, config)) {
          await ctx.answerCallbackQuery({
            text: '⛔ Access denied. Administrator privilege required.',
            show_alert: true
          });
          return;
        }

        if (data === 'admin_quick_stats') {
          await ctx.answerCallbackQuery();
          await handleStatsCommand(ctx, repositories.orders);
          return;
        }

        if (data === 'admin_quick_orders') {
          await ctx.answerCallbackQuery();
          const orders = await repositories.orders.findAll(5, 0);
          if (orders.length === 0) {
            await ctx.reply('📑 No orders recorded yet.');
            return;
          }

          let msg = `📑 <b>5 Most Recent Orders:</b>\n\n`;
          for (const ord of orders) {
            msg += `• <code>${ord.order_id}</code>: ⭐ ${ord.price_stars} Stars | Pay: ${ord.payment_status} | Deliv: ${ord.delivery_status}\n`;
          }
          await ctx.reply(msg, { parse_mode: 'HTML' });
          return;
        }

        if (data === 'admin_quick_export') {
          await ctx.answerCallbackQuery();
          await handleExportCommand(ctx, repositories.orders);
          return;
        }
      }

      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.error({ error, callbackData: data }, 'Error processing callback query');
      try {
        await ctx.answerCallbackQuery({ text: 'An error occurred. Please try again.' });
      } catch {
        // Ignore answer errors
      }
    }
  });
}
