import { InlineKeyboard } from 'grammy';

/**
 * Handles /myorders command.
 * Shows recent orders for the requesting Telegram user.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 */
export async function handleMyOrdersCommand(ctx, orderService) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply('Error: Unable to identify user.');
    return;
  }

  const text = await orderService.formatUserOrders(userId);
  const product = await orderService.getProductSnapshot();

  const keyboard = new InlineKeyboard()
    .text(`⭐ Buy ${product.appName}`, 'cb_buy')
    .url('💬 Support', product.supportUrl);

  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
}
