import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createMockDb } from '../src/database/mockDb.js';
import { ensureIndexes } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { DeliveryService, TELEGRAM_BOT_API_MAX_FILE_SIZE } from '../src/services/deliveryService.js';

describe('DeliveryService', () => {
  let db;
  let repos;
  let deliveryService;
  const testApkPath = path.resolve(process.cwd(), './storage/test_unit.apk');

  const mockConfig = {
    APP_NAME: 'TestApp',
    APP_VERSION: '2.0.0',
    APK_PATH: testApkPath,
    RESOLVED_APK_PATH: testApkPath,
    CLEAN_SUPPORT_USERNAME: 'support_bot',
    ADMIN_TELEGRAM_ID: 123456
  };

  beforeEach(async () => {
    db = createMockDb();
    await ensureIndexes(db);
    repos = createRepositories(db);
    deliveryService = new DeliveryService(repos.orders, mockConfig);

    // Create a dummy small test APK
    fs.writeFileSync(testApkPath, Buffer.from('FAKE_APK_BYTECODE_CONTENT_HEADER'));
  });

  afterEach(() => {
    if (fs.existsSync(testApkPath)) {
      fs.unlinkSync(testApkPath);
    }
  });

  it('delivers APK successfully for a paid order and updates DB to DELIVERED', async () => {
    await repos.orders.create({
      orderId: 'ORD-DELIV-1',
      telegramId: 8888,
      productName: 'TestApp',
      productVersion: '2.0.0',
      priceStars: 100,
      currency: 'XTR',
      invoicePayload: 'payload_deliv_1'
    });

    await repos.orders.markAsPaid({
      orderId: 'ORD-DELIV-1',
      chargeId: 'charge_deliv_1',
      paidAt: new Date().toISOString()
    });

    const paidOrder = await repos.orders.findByOrderId('ORD-DELIV-1');

    const mockBot = {
      api: {
        sendDocument: vi.fn().mockResolvedValue({ message_id: 55 }),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 56 })
      }
    };

    const result = await deliveryService.deliverApk(mockBot, paidOrder);
    expect(result.success).toBe(true);

    // Verify Telegram sendDocument call
    expect(mockBot.api.sendDocument).toHaveBeenCalledOnce();
    const [recipientId, inputFile, options] = mockBot.api.sendDocument.mock.calls[0];
    expect(recipientId).toBe(8888);
    expect(inputFile.filename).toBe('TestApp_v2.0.0.apk');
    expect(options.caption).toContain('TestApp');
    expect(options.caption).toContain('ORD-DELIV-1');
    expect(options.caption).toContain('Access Key:');
    expect(options.caption).toContain('Use this key to access the apk.');

    // Verify separate key message
    expect(mockBot.api.sendMessage).toHaveBeenCalled();
    const keyMsg = mockBot.api.sendMessage.mock.calls[0][1];
    expect(keyMsg).toContain('Access Key:');
    expect(keyMsg).toContain('Use this key to access the apk.');

    // Verify DB update
    const updated = await repos.orders.findByOrderId('ORD-DELIV-1');
    expect(updated.delivery_status).toBe('DELIVERED');
    expect(updated.delivered_at).toBeDefined();
  });

  it('refuses to deliver an unpaid order', async () => {
    const order = await repos.orders.create({
      orderId: 'ORD-UNPAID',
      telegramId: 8888,
      productName: 'TestApp',
      productVersion: '2.0.0',
      priceStars: 100,
      currency: 'XTR',
      invoicePayload: 'payload_unpaid'
    });

    const mockBot = { api: { sendDocument: vi.fn() } };
    const result = await deliveryService.deliverApk(mockBot, order);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot deliver unpaid order');
    expect(mockBot.api.sendDocument).not.toHaveBeenCalled();
  });

  it('handles missing APK file gracefully, marks order as FAILED, and notifies user without demanding payment', async () => {
    // Delete test APK
    if (fs.existsSync(testApkPath)) {
      fs.unlinkSync(testApkPath);
    }

    await repos.orders.create({
      orderId: 'ORD-MISSING-FILE',
      telegramId: 9999,
      productName: 'TestApp',
      productVersion: '2.0.0',
      priceStars: 100,
      currency: 'XTR',
      invoicePayload: 'payload_missing'
    });

    await repos.orders.markAsPaid({
      orderId: 'ORD-MISSING-FILE',
      chargeId: 'charge_missing',
      paidAt: new Date().toISOString()
    });

    const paidOrder = await repos.orders.findByOrderId('ORD-MISSING-FILE');

    const mockBot = {
      api: {
        sendDocument: vi.fn(),
        sendMessage: vi.fn().mockResolvedValue({ message_id: 99 })
      }
    };

    const result = await deliveryService.deliverApk(mockBot, paidOrder);
    expect(result.success).toBe(false);
    expect(result.error).toContain('APK file not found');

    const updated = await repos.orders.findByOrderId('ORD-MISSING-FILE');
    expect(updated.delivery_status).toBe('FAILED');
    expect(updated.last_delivery_error).toContain('APK file not found');

    // User is informed that payment is safe
    expect(mockBot.api.sendMessage).toHaveBeenCalledOnce();
    const userMessage = mockBot.api.sendMessage.mock.calls[0][1];
    expect(userMessage).toContain('Payment Received, but APK Delivery Failed');
    expect(userMessage).toContain('You will <b>never</b> be asked to pay again');
  });

  it('validates and rejects files exceeding Telegram upload limits', () => {
    vi.spyOn(fs, 'statSync').mockReturnValue({ size: TELEGRAM_BOT_API_MAX_FILE_SIZE + 1000 });

    const check = deliveryService.validateApkFile(testApkPath);
    expect(check.valid).toBe(false);
    expect(check.error).toContain('exceeds Telegram Bot API upload limit of 50 MB');

    vi.restoreAllMocks();
  });

  it('handles administrator redelivery retry for failed orders', async () => {
    await repos.orders.create({
      orderId: 'ORD-RETRY-1',
      telegramId: 5555,
      productName: 'TestApp',
      productVersion: '2.0.0',
      priceStars: 100,
      currency: 'XTR',
      invoicePayload: 'payload_retry'
    });

    await repos.orders.markAsPaid({
      orderId: 'ORD-RETRY-1',
      chargeId: 'charge_retry_1',
      paidAt: new Date().toISOString()
    });

    await repos.orders.updateDeliveryStatus({
      orderId: 'ORD-RETRY-1',
      deliveryStatus: 'FAILED',
      lastDeliveryError: 'Network timeout'
    });

    const mockBot = {
      api: {
        sendDocument: vi.fn().mockResolvedValue({ message_id: 10 }),
        sendMessage: vi.fn()
      }
    };

    const retryResult = await deliveryService.retryDelivery(mockBot, 'ORD-RETRY-1');
    expect(retryResult.success).toBe(true);
    expect(retryResult.message).toContain('redelivery succeeded');

    const updated = await repos.orders.findByOrderId('ORD-RETRY-1');
    expect(updated.delivery_status).toBe('DELIVERED');

    // Attempting retry again on delivered order should fail cleanly
    const duplicateRetry = await deliveryService.retryDelivery(mockBot, 'ORD-RETRY-1');
    expect(duplicateRetry.success).toBe(false);
    expect(duplicateRetry.message).toContain('already been delivered');
  });
});
