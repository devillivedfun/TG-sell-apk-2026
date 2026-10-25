import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';

describe('MongoDB Repositories & Collections', () => {
  let db;
  let repos;

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);
  });

  it('ensures all required collections have indexes', async () => {
    const usersCol = db.collection('users');
    const ordersCol = db.collection('orders');
    const paymentEventsCol = db.collection('payment_events');
    const settingsCol = db.collection('settings');

    expect(usersCol.indexes.length).toBeGreaterThan(0);
    expect(ordersCol.indexes.length).toBeGreaterThan(0);
    expect(paymentEventsCol.indexes.length).toBeGreaterThan(0);
    expect(settingsCol.indexes.length).toBeGreaterThan(0);
  });

  it('persists and updates user activity in users repository', async () => {
    await repos.users.upsert({ telegramId: 1001, username: 'tester', firstName: 'Test' });
    let user = await repos.users.findById(1001);
    expect(user).toBeDefined();
    expect(user.username).toBe('tester');

    // Update with new first name
    await repos.users.upsert({ telegramId: 1001, username: 'tester_updated', firstName: 'Updated' });
    user = await repos.users.findById(1001);
    expect(user.username).toBe('tester_updated');
    expect(user.first_name).toBe('Updated');
  });

  it('creates and manages orders with status transitions', async () => {
    const order = await repos.orders.create({
      orderId: 'ORD-1234',
      telegramId: 1001,
      productName: 'SampleApp',
      productVersion: '1.0.0',
      priceStars: 100,
      currency: 'XTR',
      invoicePayload: 'payload_unique_123'
    });

    expect(order.order_id).toBe('ORD-1234');
    expect(order.payment_status).toBe('PENDING');
    expect(order.delivery_status).toBe('PENDING');

    // Lookups
    expect(await repos.orders.findByOrderId('ORD-1234')).toBeDefined();
    expect(await repos.orders.findByPayload('payload_unique_123')).toBeDefined();

    // Mark as paid
    await repos.orders.markAsPaid({
      orderId: 'ORD-1234',
      chargeId: 'tg_charge_999',
      paidAt: new Date().toISOString()
    });

    const paidOrder = await repos.orders.findByOrderId('ORD-1234');
    expect(paidOrder.payment_status).toBe('PAID');
    expect(paidOrder.telegram_payment_charge_id).toBe('tg_charge_999');

    // Update delivery status
    await repos.orders.updateDeliveryStatus({
      orderId: 'ORD-1234',
      deliveryStatus: 'DELIVERED',
      deliveredAt: new Date().toISOString()
    });

    const deliveredOrder = await repos.orders.findByOrderId('ORD-1234');
    expect(deliveredOrder.delivery_status).toBe('DELIVERED');
  });

  it('calculates aggregate sales and order statistics', async () => {
    await repos.orders.create({
      orderId: 'ORD-P1',
      telegramId: 1001,
      productName: 'SampleApp',
      productVersion: '1.0.0',
      priceStars: 200,
      currency: 'XTR',
      invoicePayload: 'p1'
    });
    await repos.orders.markAsPaid({
      orderId: 'ORD-P1',
      chargeId: 'c1',
      paidAt: new Date().toISOString()
    });

    await repos.orders.create({
      orderId: 'ORD-P2',
      telegramId: 1002,
      productName: 'SampleApp',
      productVersion: '1.0.0',
      priceStars: 300,
      currency: 'XTR',
      invoicePayload: 'p2'
    });
    // P2 left as PENDING

    const stats = await repos.orders.getStats();
    expect(stats.total_orders).toBe(2);
    expect(stats.successful_orders).toBe(1);
    expect(stats.pending_payments).toBe(1);
    expect(stats.total_stars).toBe(200);
    expect(stats.sales_today_count).toBe(1);
    expect(stats.sales_today_stars).toBe(200);
  });

  it('manages settings overrides for price and version', async () => {
    expect(await repos.settings.getPriceOverride()).toBeNull();
    expect(await repos.settings.getVersionOverride()).toBeNull();

    await repos.settings.setPriceOverride(350);
    expect(await repos.settings.getPriceOverride()).toBe(350);

    await repos.settings.setVersionOverride('2.0.0');
    expect(await repos.settings.getVersionOverride()).toBe('2.0.0');
  });

  it('records payment events with unique charge IDs', async () => {
    await repos.paymentEvents.create({
      eventId: 'evt_1',
      orderId: 'ORD-1',
      telegramPaymentChargeId: 'chg_1',
      providerPaymentChargeId: 'p_1',
      amount: 199,
      currency: 'XTR',
      payload: 'order_payload_1'
    });

    const event = await repos.paymentEvents.findByChargeId('chg_1');
    expect(event).toBeDefined();
    expect(event.amount).toBe(199);
    expect(event.telegram_payment_charge_id).toBe('chg_1');
  });
});
