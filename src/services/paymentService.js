import crypto from 'node:crypto';
import { logger } from '../utils/logger.js';

export class PaymentService {
  /**
   * @param {import('mongodb').Db} db
   * @param {{
   *   orders: import('../database/repositories.js').OrderRepository;
   *   paymentEvents: import('../database/repositories.js').PaymentEventRepository;
   * }} repositories
   */
  constructor(db, repositories) {
    this.db = db;
    this.orderRepo = repositories.orders;
    this.paymentEventRepo = repositories.paymentEvents;
  }

  /**
   * Validates a Telegram pre_checkout_query before approving the payment.
   * Ensures payment cannot proceed if order is invalid, mismatched, or already processed.
   *
   * @param {{
   *   id: string;
   *   from: { id: number };
   *   currency: string;
   *   total_amount: number;
   *   invoice_payload: string;
   * }} query
   * @returns {Promise<{ ok: boolean; order?: any; errorMessage?: string }>}
   */
  async validatePreCheckout(query) {
    logger.info(
      {
        queryId: query.id,
        telegramId: query.from?.id,
        currency: query.currency,
        amount: query.total_amount,
        payload: query.invoice_payload
      },
      'Validating pre_checkout_query'
    );

    if (!query.invoice_payload) {
      return { ok: false, errorMessage: 'Missing invoice payload.' };
    }

    const order = await this.orderRepo.findByPayload(query.invoice_payload);
    if (!order) {
      logger.warn({ payload: query.invoice_payload }, 'Pre-checkout rejected: Order not found');
      return {
        ok: false,
        errorMessage: 'Order not found or expired. Please start a new purchase via /buy.'
      };
    }

    // Check order payment status
    if (order.payment_status !== 'PENDING') {
      logger.warn(
        { orderId: order.order_id, status: order.payment_status },
        'Pre-checkout rejected: Order is not pending'
      );
      return {
        ok: false,
        errorMessage: `This order is already marked as ${order.payment_status.toLowerCase()}. Please check /myorders.`
      };
    }

    // Verify ownership
    if (Number(order.telegram_id) !== Number(query.from.id)) {
      logger.warn(
        { orderId: order.order_id, expectedUser: order.telegram_id, actualUser: query.from.id },
        'Pre-checkout rejected: User mismatch'
      );
      return {
        ok: false,
        errorMessage: 'This invoice belongs to another Telegram account.'
      };
    }

    // Verify currency is XTR (Telegram Stars)
    if (query.currency !== 'XTR') {
      logger.warn({ currency: query.currency }, 'Pre-checkout rejected: Invalid currency');
      return {
        ok: false,
        errorMessage: 'Invalid payment currency. Only Telegram Stars (XTR) are supported.'
      };
    }

    // Verify amount matches the stored order price
    if (Number(query.total_amount) !== Number(order.price_stars)) {
      logger.warn(
        { orderId: order.order_id, expected: order.price_stars, received: query.total_amount },
        'Pre-checkout rejected: Price mismatch'
      );
      return {
        ok: false,
        errorMessage: 'Payment amount mismatch. Please initiate a new order via /buy.'
      };
    }

    logger.info({ orderId: order.order_id }, 'Pre-checkout validation successful');
    return { ok: true, order };
  }

  /**
   * Processes a confirmed successful payment from Telegram idempotently.
   *
   * @param {{
   *   from: { id: number; username?: string };
   *   successful_payment: {
   *     currency: string;
   *     total_amount: number;
   *     invoice_payload: string;
   *     telegram_payment_charge_id: string;
   *     provider_payment_charge_id?: string;
   *   };
   * }} paymentMessage
   * @returns {Promise<{ success: boolean; order?: any; alreadyProcessed: boolean; error?: string }>}
   */
  async processSuccessfulPayment(paymentMessage) {
    const sp = paymentMessage.successful_payment;
    const from = paymentMessage.from;

    logger.info(
      {
        telegramId: from?.id,
        chargeId: sp.telegram_payment_charge_id,
        amount: sp.total_amount,
        currency: sp.currency,
        payload: sp.invoice_payload
      },
      'Processing successful_payment confirmation'
    );

    // 1. Check if this exact Telegram charge has already been processed
    const existingEvent = await this.paymentEventRepo.findByChargeId(sp.telegram_payment_charge_id);
    if (existingEvent) {
      logger.warn(
        { chargeId: sp.telegram_payment_charge_id, orderId: existingEvent.order_id },
        'Duplicate payment update received from Telegram. Already processed.'
      );
      const order = await this.orderRepo.findByOrderId(existingEvent.order_id);
      return { success: true, order, alreadyProcessed: true };
    }

    // 2. Find order by payload
    const order = await this.orderRepo.findByPayload(sp.invoice_payload);
    if (!order) {
      logger.error(
        { payload: sp.invoice_payload, chargeId: sp.telegram_payment_charge_id },
        'CRITICAL: Received successful payment for non-existent order payload!'
      );
      return {
        success: false,
        alreadyProcessed: false,
        error: 'Order record not found for invoice payload'
      };
    }

    // If order is already paid with another charge ID (edge case)
    if (order.payment_status === 'PAID') {
      logger.warn(
        { orderId: order.order_id, existingCharge: order.telegram_payment_charge_id },
        'Order is already marked as PAID.'
      );
      return { success: true, order, alreadyProcessed: true };
    }

    // 3. Verify payer ownership
    if (Number(order.telegram_id) !== Number(from.id)) {
      logger.error(
        { orderId: order.order_id, orderOwner: order.telegram_id, payer: from.id },
        'CRITICAL: Payment payer does not match order owner!'
      );
      return {
        success: false,
        alreadyProcessed: false,
        error: 'Payment payer does not match order owner'
      };
    }

    // 4. Verify currency
    if (sp.currency !== 'XTR') {
      logger.error(
        { orderId: order.order_id, expected: 'XTR', received: sp.currency },
        'Payment currency mismatch'
      );
      return {
        success: false,
        alreadyProcessed: false,
        error: 'Currency mismatch'
      };
    }

    // 5. Verify total amount
    if (Number(sp.total_amount) !== Number(order.price_stars)) {
      logger.error(
        { orderId: order.order_id, expected: order.price_stars, received: sp.total_amount },
        'Payment amount mismatch'
      );
      return {
        success: false,
        alreadyProcessed: false,
        error: 'Amount mismatch'
      };
    }

    // 6. Record payment event in audit log (catches duplicate key if concurrent update)
    const eventId = `pe_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    try {
      await this.paymentEventRepo.create({
        eventId,
        orderId: order.order_id,
        telegramPaymentChargeId: sp.telegram_payment_charge_id,
        providerPaymentChargeId: sp.provider_payment_charge_id || null,
        amount: sp.total_amount,
        currency: sp.currency,
        payload: sp.invoice_payload,
        status: 'SUCCESS',
        createdAt: now
      });
    } catch (err) {
      if (err.code === 11000 || String(err).includes('duplicate')) {
        logger.warn(
          { chargeId: sp.telegram_payment_charge_id },
          'Concurrent duplicate payment detected during event creation'
        );
        const existing = await this.orderRepo.findByOrderId(order.order_id);
        return { success: true, order: existing, alreadyProcessed: true };
      }
      throw err;
    }

    // 7. Update order to PAID
    await this.orderRepo.markAsPaid({
      orderId: order.order_id,
      chargeId: sp.telegram_payment_charge_id,
      paidAt: now
    });

    const updatedOrder = await this.orderRepo.findByOrderId(order.order_id);
    logger.info(
      { orderId: order.order_id, chargeId: sp.telegram_payment_charge_id },
      'Order successfully marked as PAID'
    );

    return {
      success: true,
      order: updatedOrder,
      alreadyProcessed: false
    };
  }
}
