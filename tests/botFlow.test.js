import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Bot } from 'grammy';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { createBot } from '../src/bot.js';
import { OrderService } from '../src/services/orderService.js';
import { InvoiceService } from '../src/services/invoiceService.js';
import { PaymentService } from '../src/services/paymentService.js';
import { DeliveryService } from '../src/services/deliveryService.js';

describe('Bot Interaction Flow', () => {
  let db;
  let repos;
  let bot;
  let orderService;
  let invoiceService;
  let paymentService;
  let deliveryService;

  const mockConfig = {
    BOT_TOKEN: '123456789:AAFakeTokenForUnitTestingPurposesOnly',
    ADMIN_TELEGRAM_ID: 123456789,
    APP_NAME: 'XoGram',
    APP_VERSION: '12.10.1',
    APP_DESCRIPTION: 'Download XoGram for Android',
    PRICE_STARS: 200,
    CURRENCY: 'XTR',
    APK_PATH: './storage/XoGram.apk',
    RESOLVED_APK_PATH: '/test/storage/XoGram.apk',
    CLEAN_SUPPORT_USERNAME: 'telegram_support',
    SUPPORT_URL: 'https://t.me/telegram_support'
  };

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);

    orderService = new OrderService(repos.orders, repos.settings, mockConfig);
    invoiceService = new InvoiceService();
    paymentService = new PaymentService(db, repos);
    deliveryService = new DeliveryService(repos.orders, mockConfig);

    // Mock deliveryService deliverApk and notifyAdmin
    vi.spyOn(deliveryService, 'deliverApk').mockResolvedValue({ success: true });
    vi.spyOn(deliveryService, 'notifyAdminOfSale').mockResolvedValue();

    const testBotInstance = new Bot(mockConfig.BOT_TOKEN, {
      botInfo: {
        id: 12345,
        is_bot: true,
        first_name: 'XoGramBot',
        username: 'xogram_bot',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false
      }
    });

    bot = createBot({
      config: mockConfig,
      db,
      repositories: repos,
      botInstance: testBotInstance,
      services: {
        orderService,
        invoiceService,
        paymentService,
        deliveryService
      }
    });
  });

  it('handles /start update and replies with store menu and inline keyboard', async () => {
    const update = {
      update_id: 1,
      message: {
        message_id: 10,
        from: { id: 7001, first_name: 'Alice', username: 'alice' },
        chat: { id: 7001, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/start',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }]
      }
    };

    const replySpy = vi.fn().mockResolvedValue(true);
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendMessage') {
        replySpy(payload);
        return { ok: true, result: { message_id: 11 } };
      }
      return prev(method, payload, signal);
    });

    await bot.handleUpdate(update);

    expect(replySpy).toHaveBeenCalledOnce();
    const payload = replySpy.mock.calls[0][0];
    expect(payload.text).toContain('Welcome to XoGram Store!');
    expect(payload.reply_markup).toBeDefined();

    // Verify user activity was recorded in users table
    const user = await repos.users.findById(7001);
    expect(user).toBeDefined();
    expect(user.username).toBe('alice');
  });

  it('handles /buy update and presents purchase information with configured Stars price', async () => {
    const update = {
      update_id: 2,
      message: {
        message_id: 12,
        from: { id: 7001, first_name: 'Alice' },
        chat: { id: 7001, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        text: '/buy',
        entities: [{ type: 'bot_command', offset: 0, length: 4 }]
      }
    };

    const replySpy = vi.fn().mockResolvedValue(true);
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendMessage') {
        replySpy(payload);
        return { ok: true, result: { message_id: 13 } };
      }
      return prev(method, payload, signal);
    });

    await bot.handleUpdate(update);

    expect(replySpy).toHaveBeenCalledOnce();
    const payload = replySpy.mock.calls[0][0];
    expect(payload.text).toContain('📦 XoGram');
    expect(payload.text).toContain('Version: 12.10.1');
    expect(payload.text).toContain('Price: ⭐ 200 Stars');
  });

  it('handles cb_create_invoice callback query and sends official Stars invoice', async () => {
    const sendInvoiceSpy = vi.fn().mockResolvedValue({ ok: true, result: { message_id: 20 } });
    const answerCbSpy = vi.fn().mockResolvedValue({ ok: true, result: true });

    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'sendInvoice') {
        sendInvoiceSpy(payload);
        return { ok: true, result: { message_id: 20 } };
      }
      if (method === 'answerCallbackQuery') {
        answerCbSpy(payload);
        return { ok: true, result: true };
      }
      return prev(method, payload, signal);
    });

    const update = {
      update_id: 3,
      callback_query: {
        id: 'cb_query_1',
        from: { id: 7001, first_name: 'Alice' },
        message: { message_id: 15, chat: { id: 7001, type: 'private' }, date: 1700000000 },
        chat_instance: 'test_inst',
        data: 'cb_create_invoice'
      }
    };

    await bot.handleUpdate(update);

    expect(sendInvoiceSpy).toHaveBeenCalledOnce();
    const invoicePayload = sendInvoiceSpy.mock.calls[0][0];
    expect(invoicePayload.title).toBe('XoGram');
    expect(invoicePayload.currency).toBe('XTR');
    expect(invoicePayload.prices[0].amount).toBe(200);

    // Verify order was created in DB
    const orders = await repos.orders.findByUserId(7001);
    expect(orders).toHaveLength(1);
    expect(orders[0].price_stars).toBe(200);
    expect(orders[0].payment_status).toBe('PENDING');
  });

  it('handles pre_checkout_query update and answers ok', async () => {
    // Create pending order for user 7001
    const order = await orderService.createPendingOrder(7001);

    const answerPreCheckoutSpy = vi.fn().mockResolvedValue({ ok: true, result: true });
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (method === 'answerPreCheckoutQuery') {
        answerPreCheckoutSpy(payload);
        return { ok: true, result: true };
      }
      return prev(method, payload, signal);
    });

    const update = {
      update_id: 4,
      pre_checkout_query: {
        id: 'pc_query_10',
        from: { id: 7001, first_name: 'Alice' },
        currency: 'XTR',
        total_amount: 200,
        invoice_payload: order.invoice_payload
      }
    };

    await bot.handleUpdate(update);

    expect(answerPreCheckoutSpy).toHaveBeenCalledOnce();
    const payload = answerPreCheckoutSpy.mock.calls[0][0];
    expect(payload.pre_checkout_query_id).toBe('pc_query_10');
    expect(payload.ok).toBe(true);
  });

  it('handles successful_payment message update and triggers delivery', async () => {
    const order = await orderService.createPendingOrder(7001);

    const update = {
      update_id: 5,
      message: {
        message_id: 30,
        from: { id: 7001, first_name: 'Alice' },
        chat: { id: 7001, type: 'private' },
        date: Math.floor(Date.now() / 1000),
        successful_payment: {
          currency: 'XTR',
          total_amount: 200,
          invoice_payload: order.invoice_payload,
          telegram_payment_charge_id: 'charge_flow_test_1',
          provider_payment_charge_id: ''
        }
      }
    };

    await bot.handleUpdate(update);

    // Verify delivery was called
    expect(deliveryService.deliverApk).toHaveBeenCalledOnce();
    expect(deliveryService.notifyAdminOfSale).toHaveBeenCalledOnce();

    // Verify order is marked PAID in database
    const updated = await repos.orders.findByOrderId(order.order_id);
    expect(updated.payment_status).toBe('PAID');
    expect(updated.telegram_payment_charge_id).toBe('charge_flow_test_1');
  });
});
