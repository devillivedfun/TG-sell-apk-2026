import { webhookCallback } from 'grammy';
import { getConfig } from '../src/config.js';
import { getDatabase } from '../src/database/connection.js';
import { createRepositories } from '../src/database/repositories.js';
import { createBot } from '../src/bot.js';
import { logger } from '../src/utils/logger.js';

let cachedWebhookHandler = null;

/**
 * Initializes and caches the bot and webhook callback handler for serverless execution.
 */
async function initializeWebhook() {
  if (cachedWebhookHandler) {
    return cachedWebhookHandler;
  }

  const config = getConfig();
  const db = await getDatabase();
  const repositories = createRepositories(db);
  const bot = createBot({ config, db, repositories });

  // Custom adapter for Vercel Serverless Function (Node.js runtime)
  const vercelAdapter = (req, res) => ({
    get update() {
      if (typeof req.body === 'string') {
        try {
          return JSON.parse(req.body);
        } catch {
          return {};
        }
      }
      return req.body || {};
    },
    header: req.headers['x-telegram-bot-api-secret-token'],
    end: () => {
      if (!res.writableEnded) {
        if (typeof res.status === 'function') {
          res.status(200).end();
        } else {
          res.writeHead(200).end();
        }
      }
    },
    respond: (json) => {
      if (!res.writableEnded) {
        if (typeof res.status === 'function' && typeof res.json === 'function') {
          res.status(200).json(typeof json === 'string' ? JSON.parse(json) : json);
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(typeof json === 'string' ? json : JSON.stringify(json));
        }
      }
    },
    unauthorized: () => {
      if (!res.writableEnded) {
        if (typeof res.status === 'function') {
          res.status(401).send('unauthorized');
        } else {
          res.writeHead(401).end('unauthorized');
        }
      }
    }
  });

  const cb = webhookCallback(bot, vercelAdapter, {
    secretToken: config.WEBHOOK_SECRET || undefined,
    timeoutMilliseconds: 25000
  });

  cachedWebhookHandler = async (req, res) => {
    if (req.method === 'GET') {
      return res.status(200).json({
        status: 'ok',
        endpoint: '/api/telegram',
        app: config.APP_NAME,
        version: config.APP_VERSION,
        currency: config.CURRENCY
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    return cb(req, res);
  };

  return cachedWebhookHandler;
}

/**
 * Main Vercel Serverless Function entry point for Telegram Webhook updates.
 * Route: /api/telegram
 */
export default async function handler(req, res) {
  try {
    const webhook = await initializeWebhook();
    return await webhook(req, res);
  } catch (error) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Unhandled error in webhook endpoint');
    if (!res.writableEnded) {
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
