import { logger } from '../utils/logger.js';

/**
 * Registers the Telegram successful_payment message handler.
 * Triggered automatically by Telegram once the Stars payment is confirmed on-chain / on Telegram servers.
 *
 * @param {import('grammy').Bot} bot
 * @param {{
 *   paymentService: import('../services/paymentService.js').PaymentService;
 *   deliveryService: import('../services/deliveryService.js').DeliveryService;
 * }} services
 */
export function registerSuccessfulPaymentHandler(bot, { paymentService, deliveryService }) {
  bot.on(':successful_payment', async (ctx) => {
    const sp = ctx.message.successful_payment;
    const from = ctx.message.from;

    logger.info(
      {
        userId: from.id,
        chargeId: sp.telegram_payment_charge_id,
        amount: sp.total_amount,
        currency: sp.currency,
        payload: sp.invoice_payload
      },
      'Received successful_payment event from Telegram'
    );

    try {
      // 1. Process and record payment transaction idempotently in database
      const result = await paymentService.processSuccessfulPayment(ctx.message);

      if (!result.success) {
        logger.error(
          { error: result.error, chargeId: sp.telegram_payment_charge_id },
          'Failed to record successful payment in database'
        );
        await ctx.reply(
          `⚠️ We detected your payment (Charge ID: <code>${sp.telegram_payment_charge_id}</code>), but our database encountered an error recording it.\n` +
          `Please contact support immediately with your Charge ID so we can verify and deliver your app.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // If this was an idempotent duplicate webhook update from Telegram, do nothing further
      if (result.alreadyProcessed) {
        logger.info(
          { orderId: result.order?.order_id, chargeId: sp.telegram_payment_charge_id },
          'Duplicate payment update ignored safely.'
        );
        return;
      }

      const order = result.order;

      // 2. Deliver the APK
      const deliveryResult = await deliveryService.deliverApk(bot, order);

      // 3. Notify administrator about the sale
      await deliveryService.notifyAdminOfSale(bot, order, deliveryResult.success);
    } catch (error) {
      logger.error(
        { error, chargeId: sp.telegram_payment_charge_id },
        'Unhandled exception in successful_payment handler'
      );
      try {
        await ctx.reply(
          `⚠️ Your payment of ⭐ <b>${sp.total_amount} Stars</b> was received by Telegram, but a server error occurred during fulfillment.\n\n` +
          `<b>Telegram Charge ID:</b> <code>${sp.telegram_payment_charge_id}</code>\n\n` +
          `Please contact our administrator with this Charge ID for immediate manual delivery.`,
          { parse_mode: 'HTML' }
        );
      } catch (replyErr) {
        logger.error({ replyErr }, 'Could not send error notice to buyer');
      }
    }
  });
}
