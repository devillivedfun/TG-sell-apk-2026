import { logger } from '../utils/logger.js';
import { isAdmin } from './adminOnly.js';

export class RateLimiter {
  /**
   * @param {{ windowMs?: number; maxRequests?: number }} [options]
   */
  constructor({ windowMs = 10000, maxRequests = 15 } = {}) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();
  }

  isAllowed(userId) {
    const now = Date.now();

    // Serverless-friendly lazy cleanup without background timers
    if (this.hits.size > 200) {
      for (const [id, rec] of this.hits.entries()) {
        if (now - rec.startTime > this.windowMs) {
          this.hits.delete(id);
        }
      }
    }

    const record = this.hits.get(userId);

    if (!record || now - record.startTime > this.windowMs) {
      this.hits.set(userId, { startTime: now, count: 1 });
      return true;
    }

    record.count += 1;
    if (record.count > this.maxRequests) {
      return false;
    }

    return true;
  }

  stop() {
    this.hits.clear();
  }
}

/**
 * Creates grammY middleware for rate limiting.
 * @param {{ windowMs?: number; maxRequests?: number }} [options]
 * @param {ReturnType<typeof import('../config.js').getConfig>} [config]
 */
export function createRateLimitMiddleware(options = {}, config) {
  const limiter = new RateLimiter(options);

  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      return next();
    }

    // Admins are exempt from rate limiting
    if (isAdmin(userId, config)) {
      return next();
    }

    if (!limiter.isAllowed(userId)) {
      logger.warn({ userId }, 'Rate limit exceeded for user');
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({
          text: '⚠️ You are sending requests too quickly. Please wait a moment.',
          show_alert: true
        });
      } else if (ctx.message) {
        await ctx.reply('⚠️ You are sending requests too quickly. Please wait a moment.');
      }
      return;
    }

    return next();
  };
}
