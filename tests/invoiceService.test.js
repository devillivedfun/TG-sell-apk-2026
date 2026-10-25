import { describe, it, expect, vi } from 'vitest';
import { InvoiceService } from '../src/services/invoiceService.js';

describe('InvoiceService', () => {
  const invoiceService = new InvoiceService();

  const mockOrder = {
    order_id: 'ORD-TEST-1',
    telegram_id: 12345,
    product_name: 'SuperApp',
    product_version: '5.0.0',
    price_stars: 300,
    currency: 'XTR',
    invoice_payload: 'order_payload_xyz123'
  };

  it('builds official Stars invoice parameters correctly', () => {
    const params = invoiceService.buildInvoiceParams(mockOrder);

    expect(params.currency).toBe('XTR');
    expect(params.provider_token).toBe('');
    expect(params.payload).toBe(mockOrder.invoice_payload);
    expect(params.prices).toHaveLength(1);
    expect(params.prices[0].amount).toBe(300);
    expect(params.prices[0].label).toContain('SuperApp v5.0.0');
  });

  it('calls ctx.replyWithInvoice with expected arguments', async () => {
    const ctx = {
      replyWithInvoice: vi.fn().mockResolvedValue({ message_id: 101 })
    };

    await invoiceService.sendInvoice(ctx, mockOrder);

    expect(ctx.replyWithInvoice).toHaveBeenCalledOnce();
    const args = ctx.replyWithInvoice.mock.calls[0];

    // title, description, payload, currency, prices, options
    expect(args[0]).toBe('SuperApp');
    expect(args[2]).toBe('order_payload_xyz123');
    expect(args[3]).toBe('XTR');
    expect(args[4][0].amount).toBe(300);
    expect(args[5].provider_token).toBe('');
  });
});
