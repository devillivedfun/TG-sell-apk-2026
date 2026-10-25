import { describe, it, expect, beforeEach } from 'vitest';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { OrderService } from '../src/services/orderService.js';

describe('OrderService', () => {
  let db;
  let repos;
  let orderService;

  const mockConfig = {
    APP_NAME: 'CustomApp',
    APP_VERSION: '1.2.3',
    APP_DESCRIPTION: 'Best messaging app for Android',
    PRICE_STARS: 120,
    CURRENCY: 'XTR',
    CLEAN_SUPPORT_USERNAME: 'helpdesk',
    SUPPORT_URL: 'https://t.me/helpdesk'
  };

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);
    orderService = new OrderService(repos.orders, repos.settings, mockConfig);
  });

  it('formats start message correctly without hardcoding names', async () => {
    const msg = await orderService.formatStartMessage();
    expect(msg).toContain('Welcome to CustomApp Store!');
    expect(msg).toContain('Best messaging app for Android');
    expect(msg).toContain('Purchase the Android application using Telegram Stars.');
  });

  it('formats buy message with exact configured product details and price', async () => {
    const msg = await orderService.formatBuyMessage();
    expect(msg).toContain('📦 CustomApp');
    expect(msg).toContain('Version: 1.2.3');
    expect(msg).toContain('Price: ⭐ 120 Stars');
  });

  it('generates unique order IDs and unpredictable invoice payloads', async () => {
    const order1 = await orderService.createPendingOrder(12345);
    const order2 = await orderService.createPendingOrder(12345);

    expect(order1.order_id).toMatch(/^ORD-\d+-[A-F0-9]+$/);
    expect(order2.order_id).toMatch(/^ORD-\d+-[A-F0-9]+$/);
    expect(order1.order_id).not.toBe(order2.order_id);

    expect(order1.invoice_payload).toMatch(/^order_ORD-\d+-[A-F0-9]+_[a-f0-9]{32}$/);
    expect(order2.invoice_payload).toMatch(/^order_ORD-\d+-[A-F0-9]+_[a-f0-9]{32}$/);
    expect(order1.invoice_payload).not.toBe(order2.invoice_payload);
  });

  it('respects administrator price override over environment configuration', async () => {
    const priceBefore = await orderService.getActivePrice();
    expect(priceBefore.price).toBe(120);
    expect(priceBefore.isOverridden).toBe(false);

    await repos.settings.setPriceOverride(250);

    const active = await orderService.getActivePrice();
    expect(active.price).toBe(250);
    expect(active.isOverridden).toBe(true);

    const buyMsg = await orderService.formatBuyMessage();
    expect(buyMsg).toContain('Price: ⭐ 250 Stars');

    const newOrder = await orderService.createPendingOrder(999);
    expect(newOrder.price_stars).toBe(250);
  });

  it('respects administrator version override over environment configuration', async () => {
    const versionBefore = await orderService.getActiveVersion();
    expect(versionBefore.version).toBe('1.2.3');
    expect(versionBefore.isOverridden).toBe(false);

    await repos.settings.setVersionOverride('1.3.0');

    const active = await orderService.getActiveVersion();
    expect(active.version).toBe('1.3.0');
    expect(active.isOverridden).toBe(true);

    const buyMsg = await orderService.formatBuyMessage();
    expect(buyMsg).toContain('Version: 1.3.0');

    const newOrder = await orderService.createPendingOrder(999);
    expect(newOrder.product_version).toBe('1.3.0');
  });

  it('formats customer order history for requesting user only', async () => {
    const userA = 1111;
    const userB = 2222;

    const ordA = await orderService.createPendingOrder(userA);
    await orderService.createPendingOrder(userB);

    const historyA = await orderService.formatUserOrders(userA);
    expect(historyA).toContain(ordA.order_id);
    expect(historyA).toContain('CustomApp');

    const historyC = await orderService.formatUserOrders(3333);
    expect(historyC).toContain('You have no orders yet');
  });
});
