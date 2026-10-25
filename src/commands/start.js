import { InlineKeyboard } from 'grammy';

/**
 * Handles /start command.
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 */
export async function handleStartCommand(ctx, orderService) {
  const text = await orderService.formatStartMessage();
  const product = await orderService.getProductSnapshot();

  const keyboard = new InlineKeyboard()
    .text(`⭐ Buy ${product.appName} (${product.priceStars} Stars)`, 'cb_buy')
    .row()
    .text('ℹ️ App Information', 'cb_info')
    .text('🚀 Version & Release Notes', 'cb_version')
    .row()
    .text('❓ Help & Support', 'cb_help')
    .url('💬 Contact Support', product.supportUrl);

  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
}
