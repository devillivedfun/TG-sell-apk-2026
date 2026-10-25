import fs from 'node:fs';
import path from 'node:path';
import { InputFile } from 'grammy';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';
import { generateKey } from '../handlers/generator.js';

// Maximum file size in bytes supported by the official Telegram Bot API cloud servers
export const TELEGRAM_BOT_API_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 Megabytes

export class DeliveryService {
  /**
   * @param {import('../database/repositories.js').OrderRepository} orderRepo
   * @param {ReturnType<typeof getConfig>} [config]
   */
  constructor(orderRepo, config = getConfig()) {
    this.orderRepo = orderRepo;
    this.config = config;
    // In-memory set to lock concurrent delivery attempts for the same order
    this.inFlightDeliveries = new Set();
  }

  /**
   * Validates if the APK file exists, is readable, and is within Telegram Bot API upload limits.
   * @param {string} filePath
   * @returns {{ valid: boolean; size?: number; error?: string }}
   */
  validateApkFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return {
        valid: false,
        error: `APK file not found at path: ${filePath}. Please ensure the file exists in the storage directory.`
      };
    }

    try {
      fs.accessSync(filePath, fs.constants.R_OK);
    } catch {
      return {
        valid: false,
        error: `APK file exists at ${filePath} but is not readable due to permissions.`
      };
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return {
        valid: false,
        error: `APK file at ${filePath} is empty (0 bytes).`
      };
    }

    if (stats.size > TELEGRAM_BOT_API_MAX_FILE_SIZE) {
      const sizeMb = (stats.size / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        size: stats.size,
        error:
          `APK file size (${sizeMb} MB) exceeds Telegram Bot API upload limit of 50 MB.\n` +
          `To deliver files larger than 50 MB, run a self-hosted Telegram Bot API server or configure a secure external download link.`
      };
    }

    return { valid: true, size: stats.size };
  }

  /**
   * Delivers the APK to the customer who paid for the order.
   *
   * @param {import('grammy').Bot | { api: any }} bot
   * @param {any} order
   * @returns {Promise<{ success: boolean; error?: string }>}
   */
  async deliverApk(bot, order) {
    if (this.inFlightDeliveries.has(order.order_id)) {
      logger.warn({ orderId: order.order_id }, 'Delivery attempt already in progress for this order');
      return { success: false, error: 'Delivery attempt already in progress' };
    }

    this.inFlightDeliveries.add(order.order_id);

    try {
      // 1. Confirm that order is paid
      if (order.payment_status !== 'PAID') {
        const err = `Cannot deliver unpaid order ${order.order_id} (Status: ${order.payment_status})`;
        logger.error({ orderId: order.order_id, status: order.payment_status }, err);
        return { success: false, error: err };
      }

      // 2. Check if already delivered
      if (order.delivery_status === 'DELIVERED') {
        logger.info({ orderId: order.order_id }, 'Order has already been delivered successfully');
        return { success: true };
      }

      // 3. Verify APK file
      const apkPath = this.config.RESOLVED_APK_PATH;
      const fileCheck = this.validateApkFile(apkPath);

      if (!fileCheck.valid) {
        logger.error({ orderId: order.order_id, error: fileCheck.error }, 'APK file validation failed');
        await this.orderRepo.updateDeliveryStatus({
          orderId: order.order_id,
          deliveryStatus: 'FAILED',
          lastDeliveryError: fileCheck.error
        });

        // Notify user about delivery issue without asking to pay again
        await this.notifyUserOfDeliveryFailure(bot, order, fileCheck.error);
        return { success: false, error: fileCheck.error };
      }

      // 4. Send the file through Telegram sendDocument
      const accessKey = generateKey();
      const filename = `${order.product_name.replace(/[^a-zA-Z0-9_-]/g, '_')}_v${order.product_version}.apk`;
      const caption =
        `🎉 Thank you for your purchase!\n\n` +
        `📦 <b>${order.product_name}</b>\n` +
        `Version: <code>${order.product_version}</code>\n` +
        `Order Reference: <code>${order.order_id}</code>\n` +
        `Telegram Charge ID: <code>${order.telegram_payment_charge_id || 'N/A'}</code>\n\n` +
        `🔑 <b>Access Key:</b> <code>${accessKey}</code>\n` +
        `Use this key to access the apk.\n` +
        `⚠️ <i>Warning: Do not lose this key! Save it safely.</i>\n\n` +
        `Please open the APK file to install the application.\n` +
        `Need support? Contact @${this.config.CLEAN_SUPPORT_USERNAME}`;

      logger.info(
        { orderId: order.order_id, telegramId: order.telegram_id, apkPath, filename, accessKey },
        'Uploading APK document via Telegram'
      );

      await bot.api.sendDocument(
        order.telegram_id,
        new InputFile(apkPath, filename),
        {
          caption,
          parse_mode: 'HTML'
        }
      );

      // Send dedicated copyable access key message with warning
      try {
        await bot.api.sendMessage(
          order.telegram_id,
          `🔑 <b>Access Key:</b> <code>${accessKey}</code>\n\n` +
          `Use this key to access the apk.\n\n` +
          `⚠️ <b>Warning:</b> Please save this key now! Do not lose it, you will need it to access the app.`,
          { parse_mode: 'HTML' }
        );
      } catch (keyErr) {
        logger.warn({ error: keyErr, orderId: order.order_id }, 'Failed to send separate access key message');
      }

      // 5. Record successful delivery
      const now = new Date().toISOString();
      await this.orderRepo.updateDeliveryStatus({
        orderId: order.order_id,
        deliveryStatus: 'DELIVERED',
        deliveredAt: now,
        lastDeliveryError: null
      });

      logger.info({ orderId: order.order_id }, 'APK delivered successfully to user');
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ orderId: order.order_id, error: errorMsg }, 'Error during APK delivery');

      await this.orderRepo.updateDeliveryStatus({
        orderId: order.order_id,
        deliveryStatus: 'FAILED',
        lastDeliveryError: errorMsg
      });

      await this.notifyUserOfDeliveryFailure(bot, order, errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      this.inFlightDeliveries.delete(order.order_id);
    }
  }

  /**
   * Informs user when delivery encountered an issue, reassuring them that payment is safe.
   */
  async notifyUserOfDeliveryFailure(bot, order, errorMsg) {
    try {
      const message =
        `⚠️ <b>Payment Received, but APK Delivery Failed</b>\n\n` +
        `Your payment of ⭐ <b>${order.price_stars} Stars</b> was successfully confirmed!\n` +
        `However, our server encountered an issue while transferring your APK file.\n\n` +
        `<b>Details:</b>\n` +
        `• Order ID: <code>${order.order_id}</code>\n` +
        `• Status: <b>PAID</b> (Delivery Pending)\n\n` +
        `<b>What should you do?</b>\n` +
        `• You will <b>never</b> be asked to pay again for this order.\n` +
        `• Our administrator has been notified.\n` +
        `• You can also contact support directly at @${this.config.CLEAN_SUPPORT_USERNAME} and provide your Order ID.`;

      await bot.api.sendMessage(order.telegram_id, message, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ error: err }, 'Failed to send delivery failure notification to user');
    }
  }

  /**
   * Notifies the admin about a new sale.
   */
  async notifyAdminOfSale(bot, order, deliverySuccess) {
    try {
      const adminId = this.config.ADMIN_TELEGRAM_ID;
      const statusIcon = deliverySuccess ? '✅ DELIVERED' : '⚠️ DELIVERY FAILED';

      const text =
        `🔔 <b>New Telegram Stars Sale!</b>\n\n` +
        `• <b>Order ID:</b> <code>${order.order_id}</code>\n` +
        `• <b>Customer ID:</b> <code>${order.telegram_id}</code>\n` +
        `• <b>Product:</b> ${order.product_name} (v${order.product_version})\n` +
        `• <b>Amount:</b> ⭐ ${order.price_stars} Stars\n` +
        `• <b>Charge ID:</b> <code>${order.telegram_payment_charge_id}</code>\n` +
        `• <b>Delivery Status:</b> ${statusIcon}\n` +
        (order.last_delivery_error ? `• <b>Error:</b> <i>${order.last_delivery_error}</i>\n` : '') +
        `\nUse <code>/orders ${order.order_id}</code> to inspect or <code>/retrydelivery ${order.order_id}</code> to retry delivery.`;

      await bot.api.sendMessage(adminId, text, { parse_mode: 'HTML' });
    } catch (err) {
      logger.error({ error: err }, 'Failed to send sale notification to administrator');
    }
  }

  /**
   * Retries delivery for a paid order (Administrator action).
   *
   * @param {import('grammy').Bot | { api: any }} bot
   * @param {string} orderId
   * @returns {Promise<{ success: boolean; message: string }>}
   */
  async retryDelivery(bot, orderId) {
    const order = await this.orderRepo.findByOrderId(orderId);
    if (!order) {
      return { success: false, message: `Order <code>${orderId}</code> not found.` };
    }

    if (order.payment_status !== 'PAID') {
      return {
        success: false,
        message: `Order <code>${orderId}</code> has payment status <b>${order.payment_status}</b>. Only PAID orders can be delivered.`
      };
    }

    if (order.delivery_status === 'DELIVERED') {
      return {
        success: false,
        message: `Order <code>${orderId}</code> has already been delivered successfully on ${order.delivered_at}.`
      };
    }

    const result = await this.deliverApk(bot, order);
    if (result.success) {
      return {
        success: true,
        message: `✅ Order <code>${orderId}</code> APK redelivery succeeded!`
      };
    }

    return {
      success: false,
      message: `❌ Order <code>${orderId}</code> redelivery failed: ${result.error}`
    };
  }
}
