import { describe, it, expect, vi, beforeEach } from 'vitest';
import healthHandler from '../api/health.js';
import telegramHandler from '../api/telegram.js';
import * as dbModule from '../src/database/connection.js';
import { createMockDb } from '../src/database/mockDb.js';

describe('Vercel Serverless Endpoints', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = createMockDb();
    vi.spyOn(dbModule, 'getDatabase').mockResolvedValue(mockDb);
  });

  describe('/api/health endpoint', () => {
    it('returns 200 with healthy JSON response', async () => {
      let statusCode = 0;
      let responseBody = null;

      const req = { method: 'GET' };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await healthHandler(req, res);
      expect(statusCode).toBe(200);
      expect(responseBody.status).toBe('ok');
      expect(responseBody.app).toBeDefined();
      expect(responseBody.version).toBeDefined();
      expect(responseBody.currency).toBe('XTR');
    });
  });

  describe('/api/telegram endpoint', () => {
    it('returns 200 on GET status check probe', async () => {
      let statusCode = 0;
      let responseBody = null;

      const req = { method: 'GET' };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await telegramHandler(req, res);
      expect(statusCode).toBe(200);
      expect(responseBody.status).toBe('ok');
      expect(responseBody.endpoint).toBe('/api/telegram');
    });

    it('returns 405 on unsupported HTTP methods like PUT', async () => {
      let statusCode = 0;
      let responseBody = null;

      const req = { method: 'PUT' };
      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          return this;
        }
      };

      await telegramHandler(req, res);
      expect(statusCode).toBe(405);
      expect(responseBody.error).toBe('Method Not Allowed');
    });

    it('handles incoming webhook updates on POST', async () => {
      let statusCode = 0;
      let responseBody = null;
      let ended = false;

      const req = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-telegram-bot-api-secret-token': process.env.WEBHOOK_SECRET || ''
        },
        body: {
          update_id: 99999,
          message: {
            message_id: 1,
            from: { id: 12345, first_name: 'WebhookTester' },
            chat: { id: 12345, type: 'private' },
            date: Math.floor(Date.now() / 1000),
            text: 'ping'
          }
        }
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          ended = true;
          return this;
        },
        end() {
          ended = true;
          return this;
        },
        send(data) {
          responseBody = data;
          ended = true;
          return this;
        },
        get writableEnded() {
          return ended;
        }
      };

      await telegramHandler(req, res);
      // Either 200 OK was returned or bot processed the update
      expect([200, 0]).toContain(statusCode);
    });
  });
});
