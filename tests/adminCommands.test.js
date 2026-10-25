import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { createAdminOnlyMiddleware, isAdmin } from '../src/middleware/adminOnly.js';
import {
  handleStatsCommand,
  handleOrdersCommand,
  handlePriceCommand,
  handleSetPriceCommand,
  handleSetVersionCommand,
  handleExportCommand
} from '../src/commands/admin.js';
import { OrderService } from '../src/services/orderService.js';

describe('Admin Commands & Authorization', () => {
  let db;
  let repos;
  let orderService;

  const mockConfig = {
    ADMIN_TELEGRAM_ID: 123456789,
    APP_NAME: 'TestApp',
    APP_VERSION: '1.0.0',
    APP_DESCRIPTION: 'Test description',
    PRICE_STARS: 200,
    CURRENCY: 'XTR',
    CLEAN_SUPPORT_USERNAME: 'support',
    SUPPORT_URL: 'https://t.me/support'
  };

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);
    orderService = new OrderService(repos.orders, repos.settings, mockConfig);
  });

  describe('Authorization check', () => {
    it('accurately identifies configured administrator ID', () => {
      expect(isAdmin(123456789, mockConfig)).toBe(true);
      expect(isAdmin('123456789', mockConfig)).toBe(true);
      expect(isAdmin(999999999, mockConfig)).toBe(false);
      expect(isAdmin(null, mockConfig)).toBe(false);
      expect(isAdmin(undefined, mockConfig)).toBe(false);
    });

    it('blocks non-admin users with access denied in middleware', async () => {
      const middleware = createAdminOnlyMiddleware(mockConfig);
      const next = vi.fn();
      const ctx = {
        from: { id: 999999999, username: 'intruder' },
        reply: vi.fn().mockResolvedValue(true)
      };

      await middleware(ctx, next);

      expect(next).not.toHaveBeenCalled();
      expect(ctx.reply).toHaveBeenCalledOnce();
      expect(ctx.reply.mock.calls[0][0]).toContain('Access denied');
    });

    it('allows configured administrator through middleware', async () => {
      const middleware = createAdminOnlyMiddleware(mockConfig);
      const next = vi.fn().mockResolvedValue(true);
      const ctx = {
        from: { id: 123456789, username: 'real_admin' }
      };

      await middleware(ctx, next);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe('Admin commands execution', () => {
    it('/stats formats and displays database-recorded sales', async () => {
      const ctx = { reply: vi.fn() };
      await handleStatsCommand(ctx, repos.orders);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('Sales & Order Analytics');
      expect(text).toContain('database-recorded transactions');
      expect(text).toContain('<b>Total Orders:</b> 0');
    });

    it('/price shows active price and source', async () => {
      const ctx = { reply: vi.fn() };
      await handlePriceCommand(ctx, orderService);

      expect(ctx.reply).toHaveBeenCalledOnce();
      const text = ctx.reply.mock.calls[0][0];
      expect(text).toContain('⭐ <b>200 Stars</b>');
      expect(text).toContain('.env (PRICE_STARS)');
    });

    it('/setprice updates runtime price and rejects invalid inputs', async () => {
      const ctxValid = {
        message: { text: '/setprice 350' },
        reply: vi.fn()
      };

      await handleSetPriceCommand(ctxValid, repos.settings);
      expect(await repos.settings.getPriceOverride()).toBe(350);
      expect(ctxValid.reply.mock.calls[0][0]).toContain('Price updated successfully');

      // Invalid: negative or non-integer
      const ctxInvalid = {
        message: { text: '/setprice -50' },
        reply: vi.fn()
      };
      await handleSetPriceCommand(ctxInvalid, repos.settings);
      expect(ctxInvalid.reply.mock.calls[0][0]).toContain('Invalid price');

      // Price remains 350
      expect(await repos.settings.getPriceOverride()).toBe(350);
    });

    it('/setversion updates runtime version override', async () => {
      const ctx = {
        message: { text: '/setversion 1.5.0' },
        reply: vi.fn()
      };

      await handleSetVersionCommand(ctx, repos.settings);
      expect(await repos.settings.getVersionOverride()).toBe('1.5.0');
      expect(ctx.reply.mock.calls[0][0]).toContain('Version updated successfully');
    });

    it('/orders displays paginated orders and single order inspect', async () => {
      await repos.orders.create({
        orderId: 'ORD-INSPECT-1',
        telegramId: 1010,
        productName: 'TestApp',
        productVersion: '1.0.0',
        priceStars: 200,
        currency: 'XTR',
        invoicePayload: 'p_inspect'
      });

      // 1. Paginated list
      const ctxList = {
        message: { text: '/orders' },
        reply: vi.fn()
      };
      await handleOrdersCommand(ctxList, repos.orders);
      expect(ctxList.reply.mock.calls[0][0]).toContain('Orders List');
      expect(ctxList.reply.mock.calls[0][0]).toContain('ORD-INSPECT-1');

      // 2. Inspect specific order
      const ctxInspect = {
        message: { text: '/orders ORD-INSPECT-1' },
        reply: vi.fn()
      };
      await handleOrdersCommand(ctxInspect, repos.orders);
      expect(ctxInspect.reply.mock.calls[0][0]).toContain('<b>Order Details:</b> <code>ORD-INSPECT-1</code>');
      expect(ctxInspect.reply.mock.calls[0][0]).toContain('1010');
    });

    it('/export generates CSV file and sends via replyWithDocument', async () => {
      await repos.orders.create({
        orderId: 'ORD-CSV-1',
        telegramId: 4444,
        productName: 'TestApp',
        productVersion: '1.0.0',
        priceStars: 200,
        currency: 'XTR',
        invoicePayload: 'p_csv'
      });

      const ctx = {
        reply: vi.fn(),
        replyWithDocument: vi.fn().mockResolvedValue(true)
      };

      await handleExportCommand(ctx, repos.orders);
      expect(ctx.replyWithDocument).toHaveBeenCalledOnce();
      const [inputFile, options] = ctx.replyWithDocument.mock.calls[0];
      expect(inputFile.filename).toMatch(/orders_export_.*\.csv/);
      expect(options.caption).toContain('Total records exported: 1');
    });
  });
});
