/**
 * MongoDB Atlas Repositories for Users, Orders, Payment Events, and Settings.
 */

export class UserRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.collection = db.collection('users');
  }

  async upsert({ telegramId, username = null, firstName = null }) {
    const now = new Date().toISOString();
    return this.collection.updateOne(
      { telegram_id: Number(telegramId) },
      {
        $set: {
          username: username || null,
          first_name: firstName || null,
          last_seen_at: now
        },
        $setOnInsert: {
          telegram_id: Number(telegramId),
          first_seen_at: now
        }
      },
      { upsert: true }
    );
  }

  async findById(telegramId) {
    return this.collection.findOne({ telegram_id: Number(telegramId) });
  }
}

export class OrderRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.collection = db.collection('orders');
  }

  async create({
    orderId,
    telegramId,
    productName,
    productVersion,
    priceStars,
    currency = 'XTR',
    invoicePayload,
    createdAt = new Date().toISOString()
  }) {
    const doc = {
      order_id: orderId,
      telegram_id: Number(telegramId),
      product_name: productName,
      product_version: productVersion,
      price_stars: Number(priceStars),
      currency,
      invoice_payload: invoicePayload,
      payment_status: 'PENDING',
      delivery_status: 'PENDING',
      telegram_payment_charge_id: null,
      created_at: createdAt,
      paid_at: null,
      delivered_at: null,
      last_delivery_error: null
    };

    await this.collection.insertOne(doc);
    return this.findByOrderId(orderId);
  }

  async findByOrderId(orderId) {
    return this.collection.findOne({ order_id: orderId });
  }

  async findByPayload(payload) {
    return this.collection.findOne({ invoice_payload: payload });
  }

  async findByChargeId(chargeId) {
    return this.collection.findOne({ telegram_payment_charge_id: chargeId });
  }

  async findByUserId(telegramId, limit = 10, offset = 0) {
    return this.collection
      .find({ telegram_id: Number(telegramId) })
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async findAll(limit = 10, offset = 0) {
    return this.collection
      .find({})
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();
  }

  async countAll() {
    return this.collection.countDocuments({});
  }

  async markAsPaid({ orderId, chargeId, paidAt = new Date().toISOString() }) {
    return this.collection.updateOne(
      { order_id: orderId },
      {
        $set: {
          payment_status: 'PAID',
          telegram_payment_charge_id: chargeId,
          paid_at: paidAt
        }
      }
    );
  }

  async updateDeliveryStatus({
    orderId,
    deliveryStatus,
    deliveredAt = null,
    lastDeliveryError = null
  }) {
    return this.collection.updateOne(
      { order_id: orderId },
      {
        $set: {
          delivery_status: deliveryStatus,
          delivered_at: deliveredAt,
          last_delivery_error: lastDeliveryError
        }
      }
    );
  }

  async getAllOrdersForExport() {
    const orders = await this.collection.find({}).sort({ created_at: -1 }).toArray();
    // Return objects without internal MongoDB _id for clean CSV export
    return orders.map((o) => {
      const { _id, ...rest } = o;
      return rest;
    });
  }

  async getStats() {
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const pipeline = [
      {
        $facet: {
          total_orders: [{ $count: 'count' }],
          successful_orders: [
            { $match: { payment_status: 'PAID' } },
            { $count: 'count' }
          ],
          pending_payments: [
            { $match: { payment_status: 'PENDING' } },
            { $count: 'count' }
          ],
          failed_deliveries: [
            { $match: { payment_status: 'PAID', delivery_status: 'FAILED' } },
            { $count: 'count' }
          ],
          total_stars: [
            { $match: { payment_status: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$price_stars' } } }
          ],
          sales_today: [
            { $match: { payment_status: 'PAID', paid_at: { $gte: todayStart } } },
            { $group: { _id: null, count: { $sum: 1 }, stars: { $sum: '$price_stars' } } }
          ],
          sales_7d: [
            { $match: { payment_status: 'PAID', paid_at: { $gte: sevenDaysAgo } } },
            { $group: { _id: null, count: { $sum: 1 }, stars: { $sum: '$price_stars' } } }
          ]
        }
      }
    ];

    const [res] = await this.collection.aggregate(pipeline).toArray();

    return {
      total_orders: res?.total_orders?.[0]?.count || 0,
      successful_orders: res?.successful_orders?.[0]?.count || 0,
      pending_payments: res?.pending_payments?.[0]?.count || 0,
      failed_deliveries: res?.failed_deliveries?.[0]?.count || 0,
      total_stars: res?.total_stars?.[0]?.total || 0,
      sales_today_count: res?.sales_today?.[0]?.count || 0,
      sales_today_stars: res?.sales_today?.[0]?.stars || 0,
      sales_7d_count: res?.sales_7d?.[0]?.count || 0,
      sales_7d_stars: res?.sales_7d?.[0]?.stars || 0
    };
  }
}

export class PaymentEventRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.collection = db.collection('payment_events');
  }

  async create({
    eventId,
    orderId,
    telegramPaymentChargeId,
    providerPaymentChargeId = null,
    amount,
    currency,
    payload,
    status = 'SUCCESS',
    createdAt = new Date().toISOString()
  }) {
    return this.collection.insertOne({
      event_id: eventId,
      order_id: orderId,
      telegram_payment_charge_id: telegramPaymentChargeId,
      provider_payment_charge_id: providerPaymentChargeId,
      amount: Number(amount),
      currency,
      payload,
      status,
      created_at: createdAt
    });
  }

  async findByChargeId(chargeId) {
    return this.collection.findOne({ telegram_payment_charge_id: chargeId });
  }
}

export class SettingsRepository {
  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.collection = db.collection('settings');
  }

  async get(key) {
    const doc = await this.collection.findOne({ key });
    return doc ? doc.value : null;
  }

  async set(key, value) {
    const now = new Date().toISOString();
    return this.collection.updateOne(
      { key },
      { $set: { value: String(value), updated_at: now } },
      { upsert: true }
    );
  }

  async getPriceOverride() {
    const val = await this.get('PRICE_OVERRIDE');
    if (val === null || val === undefined) return null;
    const parsed = parseInt(val, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  async setPriceOverride(price) {
    return this.set('PRICE_OVERRIDE', price);
  }

  async getVersionOverride() {
    return this.get('VERSION_OVERRIDE');
  }

  async setVersionOverride(version) {
    return this.set('VERSION_OVERRIDE', version);
  }
}

/**
 * Creates and bundles all repositories using the provided database connection.
 * @param {import('mongodb').Db} db
 */
export function createRepositories(db) {
  return {
    users: new UserRepository(db),
    orders: new OrderRepository(db),
    paymentEvents: new PaymentEventRepository(db),
    settings: new SettingsRepository(db)
  };
}
