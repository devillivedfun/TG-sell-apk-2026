import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { PaymentService } from '../src/services/paymentService.js';

describe('PaymentService', () => {
  let db;
  let repos;
  let paymentService;

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);
    paymentService = new PaymentService(db, repos);
  });

  const createTestOrder = async (overrides = {}) => {
    return repos.orders.create({
      orderId: 'ORD-TEST-100',
      telegramId: 123456,
      productName: 'SampleApp',
      productVersion: '1.0.0',
      priceStars: 200,
      currency: 'XTR',
      invoicePayload: 'payload_sample_100',
      ...overrides
    });
  };

  describe('pre_checkout_query validation', () => {
    it('approves a valid pre_checkout_query', async () => {
      await createTestOrder();

      const query = {
        id: 'query_1',
        from: { id: 123456 },
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: 'payload_sample_100'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(true);
      expect(result.order).toBeDefined();
      expect(result.order.order_id).toBe('ORD-TEST-100');
    });

    it('rejects query with unknown invoice payload', async () => {
      const query = {
        id: 'query_2',
        from: { id: 123456 },
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: 'payload_does_not_exist'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('Order not found');
    });

    it('rejects query if order is already paid', async () => {
      await createTestOrder();
      await repos.orders.markAsPaid({
        orderId: 'ORD-TEST-100',
        chargeId: 'charge_existing',
        paidAt: new Date().toISOString()
      });

      const query = {
        id: 'query_3',
        from: { id: 123456 },
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: 'payload_sample_100'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('already marked as paid');
    });

    it('rejects query if user does not own the order', async () => {
      await createTestOrder();

      const query = {
        id: 'query_4',
        from: { id: 999999 }, // Different user
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: 'payload_sample_100'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('another Telegram account');
    });

    it('rejects query if currency is not XTR', async () => {
      await createTestOrder();

      const query = {
        id: 'query_5',
        from: { id: 123456 },
        currency: 'USD',
        total_amount: 200,
        invoice_payload: 'payload_sample_100'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('Only Telegram Stars (XTR) are supported');
    });

    it('rejects query if payment amount mismatches order price', async () => {
      await createTestOrder();

      const query = {
        id: 'query_6',
        from: { id: 123456 },
        currency: 'XTR',
        total_amount: 150, // Should be 200
        invoice_payload: 'payload_sample_100'
      };

      const result = await paymentService.validatePreCheckout(query);
      expect(result.ok).toBe(false);
      expect(result.errorMessage).toContain('Payment amount mismatch');
    });
  });

  describe('successful_payment processing & idempotency', () => {
    it('processes and transitions order to PAID and logs payment event', async () => {
      await createTestOrder();

      const paymentMessage = {
        from: { id: 123456, username: 'customer' },
        successful_payment: {
          currency: 'XTR',
          total_amount: 200,
          invoice_payload: 'payload_sample_100',
          telegram_payment_charge_id: 'tg_charge_abc123',
          provider_payment_charge_id: ''
        }
      };

      const result = await paymentService.processSuccessfulPayment(paymentMessage);
      expect(result.success).toBe(true);
      expect(result.alreadyProcessed).toBe(false);
      expect(result.order.payment_status).toBe('PAID');
      expect(result.order.telegram_payment_charge_id).toBe('tg_charge_abc123');

      // Verify payment event was stored
      const event = await repos.paymentEvents.findByChargeId('tg_charge_abc123');
      expect(event).toBeDefined();
      expect(event.order_id).toBe('ORD-TEST-100');
      expect(event.amount).toBe(200);
      expect(event.currency).toBe('XTR');
    });

    it('handles duplicate payment updates idempotently without duplicating orders or records', async () => {
      await createTestOrder();

      const paymentMessage = {
        from: { id: 123456, username: 'customer' },
        successful_payment: {
          currency: 'XTR',
          total_amount: 200,
          invoice_payload: 'payload_sample_100',
          telegram_payment_charge_id: 'tg_charge_duplicate_test',
          provider_payment_charge_id: ''
        }
      };

      // First confirmation
      const res1 = await paymentService.processSuccessfulPayment(paymentMessage);
      expect(res1.success).toBe(true);
      expect(res1.alreadyProcessed).toBe(false);

      // Duplicate confirmation from Telegram
      const res2 = await paymentService.processSuccessfulPayment(paymentMessage);
      expect(res2.success).toBe(true);
      expect(res2.alreadyProcessed).toBe(true);

      // Verify no duplicate order or duplicate event in database
      const count = await db.collection('payment_events').countDocuments({
        telegram_payment_charge_id: 'tg_charge_duplicate_test'
      });
      expect(count).toBe(1);
    });

    it('rejects successful payment if payer does not match order owner', async () => {
      await createTestOrder();

      const paymentMessage = {
        from: { id: 999999, username: 'imposter' },
        successful_payment: {
          currency: 'XTR',
          total_amount: 200,
          invoice_payload: 'payload_sample_100',
          telegram_payment_charge_id: 'tg_charge_imposter'
        }
      };

      const result = await paymentService.processSuccessfulPayment(paymentMessage);
      expect(result.success).toBe(false);
      expect(result.error).toContain('payer does not match order owner');
    });
  });
});
