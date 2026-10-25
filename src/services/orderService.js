import crypto from 'node:crypto';
import { getConfig } from '../config.js';

export class OrderService {
  /**
   * @param {import('../database/repositories.js').OrderRepository} orderRepo
   * @param {import('../database/repositories.js').SettingsRepository} settingsRepo
   * @param {ReturnType<typeof getConfig>} [config]
   */
  constructor(orderRepo, settingsRepo, config = getConfig()) {
    this.orderRepo = orderRepo;
    this.settingsRepo = settingsRepo;
    this.config = config;
  }

  /**
   * Retrieves active price in Stars (DB override takes precedence over .env).
   * @returns {Promise<{ price: number; isOverridden: boolean }>}
   */
  async getActivePrice() {
    const override = await this.settingsRepo.getPriceOverride();
    if (override !== null && override > 0) {
      return { price: override, isOverridden: true };
    }
    return { price: this.config.PRICE_STARS, isOverridden: false };
  }

  /**
   * Retrieves active version (DB override takes precedence over .env).
   * @returns {Promise<{ version: string; isOverridden: boolean }>}
   */
  async getActiveVersion() {
    const override = await this.settingsRepo.getVersionOverride();
    if (override && override.trim().length > 0) {
      return { version: override.trim(), isOverridden: true };
    }
    return { version: this.config.APP_VERSION, isOverridden: false };
  }

  /**
   * Returns current product snapshot for display or purchase.
   */
  async getProductSnapshot() {
    const { price } = await this.getActivePrice();
    const { version } = await this.getActiveVersion();
    return {
      appName: this.config.APP_NAME,
      appDescription: this.config.APP_DESCRIPTION,
      version,
      priceStars: price,
      currency: this.config.CURRENCY,
      supportUsername: this.config.CLEAN_SUPPORT_USERNAME,
      supportUrl: this.config.SUPPORT_URL
    };
  }

  /**
   * Formats the /start message.
   */
  async formatStartMessage() {
    const product = await this.getProductSnapshot();
    return (
      `Welcome to ${product.appName} Store!\n\n` +
      `${product.appDescription}\n\n` +
      `Purchase the Android application using Telegram Stars. After successful payment, your download will be delivered automatically.\n\n` +
      `Choose an option below.`
    );
  }

  /**
   * Formats the /buy and /stars product message.
   */
  async formatBuyMessage() {
    const product = await this.getProductSnapshot();
    return (
      `📦 ${product.appName}\n\n` +
      `Version: ${product.version}\n\n` +
      `${product.appDescription}\n\n` +
      `Price: ⭐ ${product.priceStars} Stars\n\n` +
      `After successful payment, the APK will be delivered automatically.`
    );
  }

  /**
   * Formats the product information message.
   */
  async formatInfoMessage() {
    const product = await this.getProductSnapshot();
    return (
      `ℹ️ App Information: ${product.appName}\n\n` +
      `• Application: ${product.appName}\n` +
      `• Current Version: ${product.version}\n` +
      `• Description: ${product.appDescription}\n` +
      `• Platform: Android (APK)\n` +
      `• Standard Price: ⭐ ${product.priceStars} Stars (${product.currency})\n` +
      `• Delivery: Instant automatic delivery in this chat immediately after Telegram payment confirmation.\n\n` +
      `Tap "Buy ${product.appName}" below to proceed with purchase.`
    );
  }

  /**
   * Formats the version and release notes message.
   */
  async formatVersionMessage() {
    const product = await this.getProductSnapshot();
    return (
      `🚀 Version & Release Information\n\n` +
      `• Product: ${product.appName}\n` +
      `• Active Version: ${product.version}\n` +
      `• Build Type: Release APK\n` +
      `• Distribution: Official Telegram Stars Distribution\n\n` +
      `All purchases receive the latest release build verified against official distribution hashes.`
    );
  }

  /**
   * Formats the help message.
   */
  async formatHelpMessage() {
    const product = await this.getProductSnapshot();
    return (
      `❓ Help & Customer Support\n\n` +
      `How to purchase:\n` +
      `1. Send /buy or /stars.\n` +
      `2. Click the payment button and pay using Telegram Stars.\n` +
      `3. Once confirmed, the bot will upload and deliver the ${product.appName} APK directly to this chat.\n\n` +
      `What if payment succeeded but delivery failed?\n` +
      `• Check your order status anytime using /myorders.\n` +
      `• If the delivery failed due to network or upload limits, your order is safely marked as PAID in our database.\n` +
      `• You will never be asked to pay again for an already-paid order.\n` +
      `• Contact our administrator/support team at @${product.supportUsername} with your Order ID for immediate redelivery.`
    );
  }

  /**
   * Formats the customer's order history.
   * @param {number} telegramId
   */
  async formatUserOrders(telegramId) {
    const orders = await this.orderRepo.findByUserId(telegramId, 10, 0);
    if (!orders || orders.length === 0) {
      return (
        `📑 You have no orders yet.\n\n` +
        `Use /buy to purchase ${this.config.APP_NAME}.`
      );
    }

    let text = `📑 Your Recent Orders:\n\n`;
    for (const ord of orders) {
      const payStatusIcon = ord.payment_status === 'PAID' ? '✅' : ord.payment_status === 'PENDING' ? '⏳' : '❌';
      const delivIcon = ord.delivery_status === 'DELIVERED' ? '📦 Delivered' : ord.delivery_status === 'FAILED' ? '⚠️ Delivery Failed' : '⏳ Pending';

      text += (
        `• Order: <code>${ord.order_id}</code>\n` +
        `  Product: ${ord.product_name} v${ord.product_version}\n` +
        `  Amount: ⭐ ${ord.price_stars} Stars\n` +
        `  Payment: ${payStatusIcon} ${ord.payment_status}\n` +
        `  Delivery: ${delivIcon}\n` +
        `  Date: ${new Date(ord.created_at).toLocaleString('en-US', { timeZone: 'UTC' })} UTC\n\n`
      );
    }

    text += `Need assistance? Contact support at @${this.config.CLEAN_SUPPORT_USERNAME}.`;
    return text;
  }

  /**
   * Creates a new pending order with snapshot price and version.
   * @param {number} telegramId
   * @returns {Promise<any>}
   */
  async createPendingOrder(telegramId) {
    const product = await this.getProductSnapshot();
    const orderTimestamp = Date.now();
    const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
    const orderId = `ORD-${orderTimestamp}-${randomHex}`;

    // Cryptographically secure, unpredictable invoice payload
    const payloadEntropy = crypto.randomBytes(16).toString('hex');
    const invoicePayload = `order_${orderId}_${payloadEntropy}`;

    return this.orderRepo.create({
      orderId,
      telegramId,
      productName: product.appName,
      productVersion: product.version,
      priceStars: product.priceStars,
      currency: this.config.CURRENCY,
      invoicePayload
    });
  }
}
