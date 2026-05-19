import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AbacatePayClient } from './abacatepay.client';
import * as crypto from 'crypto';

const baseConfig = {
  apiKey: 'sk_test_abc123',
  apiUrl: 'https://api.abacatepay.com/v2',
  webhookSecret: 'super-secret-key-12345',
};

function mockFetchOnce(response: unknown, init?: { ok?: boolean; status?: number }) {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => response,
    text: async () => JSON.stringify(response),
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('AbacatePayClient.createPixCharge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('cria cobrança Pix transparente e retorna brCode + status PENDING', async () => {
    const fetchMock = mockFetchOnce({
      data: {
        id: 'pix_char_abc123',
        amount: 10000,
        status: 'PENDING',
        brCode: '00020126...',
        brCodeBase64: 'data:image/png;base64,AAA',
        expiresAt: '2026-05-19T12:00:00.000Z',
      },
      error: null,
    });

    const client = new AbacatePayClient(baseConfig);
    const charge = await client.createPixCharge({
      amount: 10000,
      expiresIn: 3600,
      description: 'Garantia agendamento #123',
      externalId: 'agendamento-123',
      customer: {
        name: 'João da Silva',
        email: 'joao@example.com',
        cellphone: '11999999999',
        taxId: '12345678900',
      },
      metadata: { agendamentoId: 'agendamento-123' },
    });

    expect(charge.id).toBe('pix_char_abc123');
    expect(charge.status).toBe('PENDING');
    expect(charge.brCode).toContain('00020126');
    expect(charge.amount).toBe(10000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/create');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer sk_test_abc123');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.amount).toBe(10000);
    expect(body.metadata.agendamentoId).toBe('agendamento-123');
  });

  it('lança erro quando a API retorna falha', async () => {
    mockFetchOnce(
      { data: null, error: 'invalid_amount' },
      { ok: false, status: 400 },
    );

    const client = new AbacatePayClient(baseConfig);

    await expect(
      client.createPixCharge({
        amount: -1,
        expiresIn: 3600,
        customer: {
          name: 'X',
          email: 'x@x.com',
          cellphone: '1',
          taxId: '1',
        },
      }),
    ).rejects.toThrow(/abacatepay/i);
  });
});

describe('AbacatePayClient.checkPixStatus', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('consulta status da cobrança Pix por ID', async () => {
    const fetchMock = mockFetchOnce({
      data: {
        id: 'pix_char_abc123',
        amount: 10000,
        status: 'PAID',
        brCode: '00020126...',
        brCodeBase64: 'data:image/png;base64,AAA',
        expiresAt: '2026-05-19T12:00:00.000Z',
      },
      error: null,
    });

    const client = new AbacatePayClient(baseConfig);
    const result = await client.checkPixStatus('pix_char_abc123');

    expect(result.status).toBe('PAID');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.abacatepay.com/v2/transparents/check?id=pix_char_abc123');
    expect(init.method ?? 'GET').toBe('GET');
  });
});

describe('AbacatePayClient.verifyWebhookSignature', () => {
  it('aceita assinatura HMAC-SHA256 base64 válida', () => {
    const client = new AbacatePayClient(baseConfig);
    const rawBody = Buffer.from(JSON.stringify({ event: 'billing.paid', id: 'evt_1' }));
    const signature = crypto
      .createHmac('sha256', baseConfig.webhookSecret)
      .update(rawBody)
      .digest('base64');

    expect(client.verifyWebhookSignature(rawBody, signature)).toBe(true);
  });

  it('rejeita assinatura inválida', () => {
    const client = new AbacatePayClient(baseConfig);
    const rawBody = Buffer.from('{}');
    const fake = crypto
      .createHmac('sha256', 'outra-secret')
      .update(rawBody)
      .digest('base64');

    expect(client.verifyWebhookSignature(rawBody, fake)).toBe(false);
  });

  it('retorna false para assinatura ausente', () => {
    const client = new AbacatePayClient(baseConfig);
    expect(client.verifyWebhookSignature(Buffer.from('{}'), '')).toBe(false);
    expect(client.verifyWebhookSignature(Buffer.from('{}'), undefined as unknown as string)).toBe(false);
  });
});
