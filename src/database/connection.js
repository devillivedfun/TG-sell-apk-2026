import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config.js';

let cachedClient = null;
let cachedDb = null;
let indexesEnsured = false;

/**
 * Creates and ensures all necessary MongoDB indexes for performance and data integrity.
 * @param {import('mongodb').Db} db
 */
export async function ensureIndexes(db) {
  if (indexesEnsured) return;

  try {
    const usersCol = db.collection('users');
    const ordersCol = db.collection('orders');
    const paymentEventsCol = db.collection('payment_events');
    const settingsCol = db.collection('settings');

    await Promise.all([
      usersCol.createIndex({ telegram_id: 1 }, { unique: true }),
      ordersCol.createIndex({ order_id: 1 }, { unique: true }),
      ordersCol.createIndex({ invoice_payload: 1 }, { unique: true }),
      ordersCol.createIndex(
        { telegram_payment_charge_id: 1 },
        { unique: true, sparse: true }
      ),
      ordersCol.createIndex({ telegram_id: 1, created_at: -1 }),
      ordersCol.createIndex({ payment_status: 1 }),
      paymentEventsCol.createIndex({ event_id: 1 }, { unique: true }),
      paymentEventsCol.createIndex({ telegram_payment_charge_id: 1 }, { unique: true }),
      paymentEventsCol.createIndex({ order_id: 1 }),
      settingsCol.createIndex({ key: 1 }, { unique: true })
    ]);

    indexesEnsured = true;
    logger.info('MongoDB indexes verified successfully');
  } catch (err) {
    logger.warn({ error: err.message }, 'Notice: MongoDB index creation check');
  }
}

/**
 * Initializes, caches, and returns the MongoDB database instance for Serverless reuse.
 * @param {string} [customUri]
 * @param {string} [customDbName]
 * @returns {Promise<import('mongodb').Db>}
 */
export async function getDatabase(customUri, customDbName) {
  if (cachedDb) {
    return cachedDb;
  }

  const config = getConfig();
  const uri = customUri || config.MONGODB_URI;

  if (!cachedClient) {
    logger.info('Establishing new MongoDB client connection');
    cachedClient = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000
    });
    await cachedClient.connect();
  }

  // Uses database from URI path (or optional override if provided)
  cachedDb = cachedClient.db(customDbName || undefined);
  await ensureIndexes(cachedDb);

  return cachedDb;
}

/**
 * Closes the active MongoDB connection and resets cache (useful during testing and teardown).
 */
export async function closeDatabase() {
  if (cachedClient) {
    try {
      await cachedClient.close();
      logger.info('MongoDB client connection closed.');
    } catch (err) {
      logger.error({ error: err.message }, 'Error closing MongoDB client');
    } finally {
      cachedClient = null;
      cachedDb = null;
      indexesEnsured = false;
    }
  }
}
