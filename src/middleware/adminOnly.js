import { getConfig } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Checks whether a Telegram user ID matches the configured administrator ID.
 * @param {number|undefined|null} userId
 * @param {ReturnType<typeof getConfig>} [config]
 * @returns {boolean}
 */
export function isAdmin(userId, config = getConfig()) {
  if (!userId) return false;
  return Number(userId) === Number(config.ADMIN_TELEGRAM_ID);
}

/**
 * GrammY middleware to protect admin commands and callbacks.
 */
export function createAdminOnlyMiddleware(config = getConfig()) {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!isAdmin(userId, config)) {
      logger.warn(
        { userId, username: ctx.from?.username, command: ctx.message?.text },
        'Unauthorized access attempt to admin command'
      );

      const deniedText = '⛔ Access denied. This command is restricted to the bot administrator.';

      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text: deniedText, show_alert: true });
      } else {
        await ctx.reply(deniedText);
      }
      return;
    }

    return next();
  };
}
