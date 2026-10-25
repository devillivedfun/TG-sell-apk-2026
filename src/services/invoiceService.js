import { logger } from '../utils/logger.js';

export class InvoiceService {
  /**
   * Constructs the official Telegram Stars invoice parameters.
   * @param {import('../database/repositories.js').OrderRecord} order
   * @returns {{
   *   title: string;
   *   description: string;
   *   payload: string;
   *   currency: string;
   *   prices: Array<{ label: string; amount: number }>;
   *   provider_token: string;
   * }}
   */
  buildInvoiceParams(order) {
    const title = `${order.product_name}`;
    const description = `Download ${order.product_name} v${order.product_version} for Android. Automatic delivery after Telegram Stars payment.`;
    const payload = order.invoice_payload;
    const currency = 'XTR'; // Official currency code for Telegram Stars
    const prices = [
      {
        label: `${order.product_name} v${order.product_version}`,
        amount: order.price_stars // Integer amount of Stars
      }
    ];

    return {
      title,
      description,
      payload,
      currency,
      prices,
      provider_token: '' // Empty string as strictly required for Telegram Stars digital goods
    };
  }

  /**
   * Sends the official Stars invoice to the user via grammY.
   * @param {import('grammy').Context} ctx
   * @param {import('../database/repositories.js').OrderRecord} order
   */
  async sendInvoice(ctx, order) {
    const params = this.buildInvoiceParams(order);

    logger.info(
      {
        orderId: order.order_id,
        telegramId: order.telegram_id,
        amount: order.price_stars,
        currency: params.currency
      },
      'Sending Telegram Stars invoice'
    );

    return ctx.replyWithInvoice(
      params.title,
      params.description,
      params.payload,
      params.currency,
      params.prices,
      {
        provider_token: params.provider_token,
        start_parameter: `buy_${order.order_id}`
      }
    );
  }
}
