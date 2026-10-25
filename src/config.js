import dotenv from 'dotenv';
import path from 'node:path';
import { z } from 'zod';

// Load .env file
dotenv.config();

export const configSchema = z.object({
  BOT_TOKEN: z.string().min(1, 'BOT_TOKEN is required and cannot be empty'),
  ADMIN_TELEGRAM_ID: z.coerce
    .number({
      invalid_type_error: 'ADMIN_TELEGRAM_ID must be a numeric Telegram ID'
    })
    .int('ADMIN_TELEGRAM_ID must be an integer')
    .positive('ADMIN_TELEGRAM_ID must be a positive integer'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required').default('mongodb://127.0.0.1:27017/xogram_bot'),
  WEBHOOK_SECRET: z.string().default(''),
  SECRET_KEY: z.string().default(''),
  PORT: z.coerce
    .number()
    .int()
    .min(1)
    .max(65535)
    .default(3000),
  APP_NAME: z.string().min(1, 'APP_NAME is required and cannot be empty'),
  APP_VERSION: z.string().min(1, 'APP_VERSION is required and cannot be empty'),
  APP_DESCRIPTION: z.string().min(1, 'APP_DESCRIPTION is required and cannot be empty'),
  PRICE_STARS: z.coerce
    .number({
      invalid_type_error: 'PRICE_STARS must be a numeric integer'
    })
    .int('PRICE_STARS must be an integer')
    .positive('PRICE_STARS must be greater than zero'),
  APK_PATH: z.string().min(1, 'APK_PATH is required and cannot be empty'),
  SUPPORT_USERNAME: z.string().min(1, 'SUPPORT_USERNAME is required and cannot be empty'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development')
});

/**
 * Normalizes Telegram username by stripping leading @ symbols.
 * @param {string} username
 * @returns {string}
 */
export function normalizeTelegramUsername(username) {
  if (!username) return '';
  return username.trim().replace(/^@+/, '');
}

/**
 * Builds direct Telegram profile/chat link from username.
 * @param {string} username
 * @returns {string}
 */
export function getTelegramSupportUrl(username) {
  const clean = normalizeTelegramUsername(username);
  return `https://t.me/${clean}`;
}

/**
 * Loads and validates configuration from environment variables.
 * @param {Record<string, any>} [rawEnv=process.env]
 */
export function loadConfig(rawEnv = process.env) {
  const parseResult = configSchema.safeParse(rawEnv);

  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((issue) => ` - [${issue.path.join('.')}]: ${issue.message}`)
      .join('\n');
    throw new Error(
      `[Config Error] Invalid or missing environment configuration:\n${errorDetails}\n` +
      `Please check your .env file against .env.example.`
    );
  }

  const validated = parseResult.data;
  const cleanSupport = normalizeTelegramUsername(validated.SUPPORT_USERNAME);

  return {
    ...validated,
    CURRENCY: 'XTR',
    RESOLVED_APK_PATH: path.resolve(process.cwd(), validated.APK_PATH),
    CLEAN_SUPPORT_USERNAME: cleanSupport,
    SUPPORT_URL: getTelegramSupportUrl(cleanSupport)
  };
}

let currentConfig = null;

export function getConfig() {
  if (!currentConfig) {
    currentConfig = loadConfig(process.env);
  }
  return currentConfig;
}

export default getConfig;
