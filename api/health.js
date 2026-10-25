import { getConfig } from '../src/config.js';

/**
 * Health check endpoint for monitoring on Vercel.
 * Route: /api/health
 */
export default async function handler(req, res) {
  try {
    const config = getConfig();
    return res.status(200).json({
      status: 'ok',
      app: config.APP_NAME,
      version: config.APP_VERSION,
      currency: config.CURRENCY,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.status(500).json({ status: 'error', message: err.message });
  }
}
