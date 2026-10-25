import { describe, it, expect } from 'vitest';
import { loadConfig, normalizeTelegramUsername, getTelegramSupportUrl } from '../src/config.js';

describe('Configuration & Environment Validation', () => {
  const validEnv = {
    BOT_TOKEN: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567',
    ADMIN_TELEGRAM_ID: '987654321',
    PORT: '4000',
    APP_NAME: 'TestApp',
    APP_VERSION: '1.0.0',
    APP_DESCRIPTION: 'Test Android Application',
    PRICE_STARS: '150',
    APK_PATH: './storage/test.apk',
    SUPPORT_USERNAME: '@test_support',
    MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/xogram_bot?retryWrites=true&w=majority',
    WEBHOOK_SECRET: 'super_secret_webhook_token_123'
  };

  it('loads valid configuration successfully', () => {
    const config = loadConfig(validEnv);
    expect(config.BOT_TOKEN).toBe(validEnv.BOT_TOKEN);
    expect(config.ADMIN_TELEGRAM_ID).toBe(987654321);
    expect(config.PORT).toBe(4000);
    expect(config.APP_NAME).toBe('TestApp');
    expect(config.APP_VERSION).toBe('1.0.0');
    expect(config.PRICE_STARS).toBe(150);
    expect(config.CURRENCY).toBe('XTR');
    expect(config.CLEAN_SUPPORT_USERNAME).toBe('test_support');
    expect(config.SUPPORT_URL).toBe('https://t.me/test_support');
    expect(config.MONGODB_URI).toBe(validEnv.MONGODB_URI);
    expect(config.WEBHOOK_SECRET).toBe('super_secret_webhook_token_123');
  });

  it('defaults PORT and WEBHOOK_SECRET if omitted', () => {
    const envMinimal = { ...validEnv };
    delete envMinimal.PORT;
    delete envMinimal.WEBHOOK_SECRET;
    const config = loadConfig(envMinimal);
    expect(config.PORT).toBe(3000);
    expect(config.WEBHOOK_SECRET).toBe('');
  });

  it('fails when BOT_TOKEN is missing', () => {
    const invalid = { ...validEnv, BOT_TOKEN: '' };
    expect(() => loadConfig(invalid)).toThrowError(/BOT_TOKEN is required/);
  });

  it('fails when ADMIN_TELEGRAM_ID is invalid or non-numeric', () => {
    const invalid = { ...validEnv, ADMIN_TELEGRAM_ID: 'not-a-number' };
    expect(() => loadConfig(invalid)).toThrowError(/ADMIN_TELEGRAM_ID/);
  });

  it('fails when PRICE_STARS is zero or negative', () => {
    expect(() => loadConfig({ ...validEnv, PRICE_STARS: '0' })).toThrowError(/PRICE_STARS/);
    expect(() => loadConfig({ ...validEnv, PRICE_STARS: '-50' })).toThrowError(/PRICE_STARS/);
  });

  it('fails when required text fields are missing', () => {
    expect(() => loadConfig({ ...validEnv, APP_NAME: '' })).toThrowError(/APP_NAME/);
    expect(() => loadConfig({ ...validEnv, APP_VERSION: '' })).toThrowError(/APP_VERSION/);
    expect(() => loadConfig({ ...validEnv, APP_DESCRIPTION: '' })).toThrowError(/APP_DESCRIPTION/);
    expect(() => loadConfig({ ...validEnv, APK_PATH: '' })).toThrowError(/APK_PATH/);
    expect(() => loadConfig({ ...validEnv, SUPPORT_USERNAME: '' })).toThrowError(/SUPPORT_USERNAME/);
  });

  it('normalizes support usernames correctly', () => {
    expect(normalizeTelegramUsername('@support_user')).toBe('support_user');
    expect(normalizeTelegramUsername('@@@support_user')).toBe('support_user');
    expect(normalizeTelegramUsername('support_user')).toBe('support_user');
    expect(normalizeTelegramUsername('')).toBe('');
    expect(getTelegramSupportUrl('@support_user')).toBe('https://t.me/support_user');
  });
});
