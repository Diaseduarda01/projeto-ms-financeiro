import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WebhookController } from './webhook.controller';
import type { AbacatePayClient } from '../abacatepay/abacatepay.client';
import type { CobrancaService } from '../cobranca/cobranca.service';
import type { CobrancaRepository } from '../cobranca/cobranca.repository';
import * as crypto from 'crypto';

function makeAbacateMock(verifies: boolean): AbacatePayClient {
  return {
    createPixCharge: vi.fn(),
    checkPixStatus: vi.fn(),
    verifyWebhookSignature: vi.fn().mockReturnValue(verifies),
  } as unknown as AbacatePayClient;
}

function makeServiceMock(): CobrancaService {
  return {
    confirmarPagamentoPorAbacateId: vi.fn().mockResolvedValue(undefined),
  } as unknown as CobrancaService;
}

function makeRepoMock(): CobrancaRepository {
  return {
    findWebhookEvent: vi.fn().mockResolvedValue(null),
    markWebhookProcessed: vi.fn().mockResolvedValue(undefined),
  } as unknown as CobrancaRepository;
}

const billingPaidPayload = {
  event: 'billing.paid',
  id: 'evt_123',
  data: {
    billing: {
      id: 'pix_abc',
      amount: 10000,
      status: 'PAID',
      externalId: 'cob-1',
      paidAt: '2026-05-19T12:30:00.000Z',
    },
  },
};

describe('WebhookController.abacatepayWebhook', () => {
  let abacate: AbacatePayClient;
  let service: CobrancaService;
  let repo: CobrancaRepository;
  let controller: WebhookController;

  beforeEach(() => {
    abacate = makeAbacateMock(true);
    service = makeServiceMock();
    repo = makeRepoMock();
    controller = new WebhookController(abacate, service, repo);
  });

  it('processa billing.paid e chama confirmarPagamentoPorAbacateId', async () => {
    const raw = Buffer.from(JSON.stringify(billingPaidPayload));
    const signature = 'sig-base64';

    const result = await controller.handle(raw, signature);

    expect(abacate.verifyWebhookSignature).toHaveBeenCalledWith(raw, signature);
    expect(service.confirmarPagamentoPorAbacateId).toHaveBeenCalledWith({
      abacateId: 'pix_abc',
      paidAmount: 10000,
      paidAt: '2026-05-19T12:30:00.000Z',
    });
    expect(repo.markWebhookProcessed).toHaveBeenCalledWith(
      'evt_123',
      'billing.paid',
      expect.any(Object),
    );
    expect(result).toEqual({ received: true });
  });

  it('rejeita com 401 quando a assinatura é inválida', async () => {
    abacate = makeAbacateMock(false);
    controller = new WebhookController(abacate, service, repo);
    const raw = Buffer.from(JSON.stringify(billingPaidPayload));

    await expect(controller.handle(raw, 'sig-invalida')).rejects.toMatchObject({
      status: 401,
    });
    expect(service.confirmarPagamentoPorAbacateId).not.toHaveBeenCalled();
  });

  it('idempotência — não reprocessa o mesmo eventId duas vezes', async () => {
    (repo.findWebhookEvent as any).mockResolvedValue({
      externalEventId: 'evt_123',
      type: 'billing.paid',
    });
    const raw = Buffer.from(JSON.stringify(billingPaidPayload));

    const result = await controller.handle(raw, 'sig');

    expect(result).toEqual({ received: true, idempotent: true });
    expect(service.confirmarPagamentoPorAbacateId).not.toHaveBeenCalled();
    expect(repo.markWebhookProcessed).not.toHaveBeenCalled();
  });

  it('ignora eventos desconhecidos sem erro', async () => {
    const raw = Buffer.from(JSON.stringify({ event: 'desconhecido', id: 'evt_x', data: {} }));

    const result = await controller.handle(raw, 'sig');

    expect(service.confirmarPagamentoPorAbacateId).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true, ignored: true });
  });

  it('400 quando payload é JSON inválido', async () => {
    const raw = Buffer.from('not-json');
    await expect(controller.handle(raw, 'sig')).rejects.toMatchObject({ status: 400 });
  });
});

describe('Integração HMAC com AbacatePayClient real', () => {
  it('aceita assinatura gerada com a mesma secret', async () => {
    const { AbacatePayClient } = await import('../abacatepay/abacatepay.client');
    const client = new AbacatePayClient({
      apiKey: 'k',
      apiUrl: 'https://x',
      webhookSecret: 'secret-de-teste',
    });
    const raw = Buffer.from(JSON.stringify(billingPaidPayload));
    const sig = crypto.createHmac('sha256', 'secret-de-teste').update(raw).digest('base64');

    const service = makeServiceMock();
    const repo = makeRepoMock();
    const controller = new WebhookController(client, service, repo);

    const result = await controller.handle(raw, sig);
    expect(result).toEqual({ received: true });
  });
});
