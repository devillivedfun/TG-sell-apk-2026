import { InlineKeyboard } from 'grammy';
import { logger } from '../utils/logger.js';

/**
 * Handles /buy and /stars commands.
 * Shows the product purchase details and purchase/support buttons.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 */
export async function handleBuyCommand(ctx, orderService) {
  const text = await orderService.formatBuyMessage();
  const product = await orderService.getProductSnapshot();

  const keyboard = new InlineKeyboard()
    .text(`⭐ Pay ${product.priceStars} Stars`, 'cb_create_invoice')
    .row()
    .url('💬 Support', product.supportUrl)
    .text('🔙 Back to Store', 'cb_back_store');

  await ctx.reply(text, {
    reply_markup: keyboard,
    parse_mode: 'HTML'
  });
}

/**
 * Handles generating order and sending the official Stars invoice.
 *
 * @param {import('grammy').Context} ctx
 * @param {import('../services/orderService.js').OrderService} orderService
 * @param {import('../services/invoiceService.js').InvoiceService} invoiceService
 */
export async function handleCreateInvoice(ctx, orderService, invoiceService) {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply('Error: Unable to identify user.');
    return;
  }

  try {
    // 1. Create pending order in database
    const order = await orderService.createPendingOrder(userId);
    logger.info({ userId, orderId: order.order_id, price: order.price_stars }, 'Created pending order for invoice');

    // 2. Dispatch official Telegram Stars invoice
    await invoiceService.sendInvoice(ctx, order);
  } catch (error) {
    logger.error({ error, userId }, 'Failed to create and dispatch invoice');
    await ctx.reply('⚠️ Failed to generate invoice. Please try again or contact support.');
  }
}
