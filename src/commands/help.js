import { InlineKeyboard } from 'grammy';

/**
 * Handles /help command.
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 */
export async function handleHelpCommand(ctx, orderService) {
  const text = await orderService.formatHelpMessage();
  const product = await orderService.getProductSnapshot();

  const keyboard = new InlineKeyboard()
    .url('💬 Contact Support', product.supportUrl)
    .text('🛒 Buy Now', 'cb_buy')
    .row()
    .text('🔙 Back to Store', 'cb_back_store');

  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
}
