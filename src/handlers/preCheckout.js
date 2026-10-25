import { logger } from '../utils/logger.js';

/**
 * Registers the Telegram pre_checkout_query handler.
 * Telegram requires an answer within ~10 seconds.
 *
 * @param {import('grammy').Bot} bot
 * @param {import('../services/paymentService.js').PaymentService} paymentService
 */
export function registerPreCheckoutHandler(bot, paymentService) {
  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.preCheckoutQuery;

    logger.info(
      {
        queryId: query.id,
        userId: query.from?.id,
        amount: query.total_amount,
        currency: query.currency,
        payload: query.invoice_payload
      },
      'Received pre_checkout_query'
    );

    try {
      const result = await paymentService.validatePreCheckout(query);

      if (result.ok) {
        logger.info({ queryId: query.id, orderId: result.order?.order_id }, 'Approving pre_checkout_query');
        await ctx.answerPreCheckoutQuery(true);
      } else {
        logger.warn(
          { queryId: query.id, reason: result.errorMessage },
          'Rejecting pre_checkout_query'
        );
        await ctx.answerPreCheckoutQuery(false, {
          error_message: result.errorMessage || 'Unable to process checkout. Please try again.'
        });
      }
    } catch (error) {
      logger.error({ error, queryId: query.id }, 'Exception while answering pre_checkout_query');
      try {
        await ctx.answerPreCheckoutQuery(false, {
          error_message: 'A temporary error occurred. Please contact support.'
        });
      } catch (innerError) {
        logger.error({ innerError }, 'Failed to send rejection response for pre_checkout_query');
      }
    }
  });
}
