import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CobrancaService } from './cobranca.service';
import type { CobrancaRepository } from './cobranca.repository';
import type { AbacatePayClient, AbacatePayChargeResponse } from '../abacatepay/abacatepay.client';
import type { PublisherService } from '../messaging/publisher.service';

function makeCharge(overrides: Partial<AbacatePayChargeResponse> = {}): AbacatePayChargeResponse {
  return {
    id: 'pix_abc',
    amount: 10000,
    status: 'PENDING',
    brCode: '00020126...',
    brCodeBase64: 'data:image/png;base64,AAA',
    expiresAt: '2026-05-19T13:00:00.000Z',
    ...overrides,
  };
}

function makeRepoMock(): CobrancaRepository {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByAgendamentoId: vi.fn(),
    findByAbacateId: vi.fn(),
    update: vi.fn(),
    listExtrato: vi.fn(),
    findExpiradasPendentes: vi.fn(),
    logEvent: vi.fn(),
    markWebhookProcessed: vi.fn(),
    findWebhookEvent: vi.fn(),
  } as unknown as CobrancaRepository;
}

function makeAbacateMock(): AbacatePayClient {
  return {
    createPixCharge: vi.fn(),
    checkPixStatus: vi.fn(),
    verifyWebhookSignature: vi.fn(),
  } as unknown as AbacatePayClient;
}

function makePublisherMock(): PublisherService {
  return {
    pagamentoConfirmado: vi.fn().mockResolvedValue(undefined),
    pagamentoExpirado: vi.fn().mockResolvedValue(undefined),
  } as unknown as PublisherService;
}

const baseInput = {
  empresaId: 'emp-1',
  agendamentoId: 'ag-1',
  clienteId: 'cli-1',
  clienteNome: 'João',
  clienteTelefone: '11999999999',
  clienteEmail: 'joao@example.com',
  clienteCpf: '12345678900',
  amount: 10000,
};

describe('CobrancaService.criarCobranca', () => {
  let repo: CobrancaRepository;
  let abacate: AbacatePayClient;
  let publisher: PublisherService;
  let service: CobrancaService;

  beforeEach(() => {
    repo = makeRepoMock();
    abacate = makeAbacateMock();
    publisher = makePublisherMock();
    service = new CobrancaService(repo, abacate, publisher, { defaultTtlSeconds: 3600 });
  });

  it('cria cobrança no banco e gera Pix na AbacatePay', async () => {
    (repo.findByAgendamentoId as any).mockResolvedValue(null);
    (repo.create as any).mockResolvedValue({
      id: 'cob-1',
      ...baseInput,
      status: 'PENDING',
      expiresAt: new Date(),
    });
    (abacate.createPixCharge as any).mockResolvedValue(makeCharge());
    (repo.update as any).mockImplementation((id: string, data: any) => ({
      id,
      ...baseInput,
      ...data,
    }));

    const result = await service.criarCobranca(baseInput);

    expect(repo.findByAgendamentoId).toHaveBeenCalledWith('ag-1');
    expect(repo.create).toHaveBeenCalled();
    expect(abacate.createPixCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10000,
        externalId: 'cob-1',
        customer: expect.objectContaining({
          name: 'João',
          cellphone: '11999999999',
        }),
      }),
    );
    expect(repo.update).toHaveBeenCalledWith('cob-1', expect.objectContaining({
      abacateId: 'pix_abc',
      brCode: expect.any(String),
      brCodeBase64: expect.any(String),
    }));
    expect(result.brCode).toBe('00020126...');
  });

  it('é idempotente — retorna cobrança existente do mesmo agendamento sem chamar AbacatePay novamente', async () => {
    (repo.findByAgendamentoId as any).mockResolvedValue({
      id: 'cob-existente',
      agendamentoId: 'ag-1',
      status: 'PENDING',
      brCode: 'existente-brcode',
      brCodeBase64: 'existente-b64',
      amount: 10000,
      expiresAt: new Date(Date.now() + 600_000),
    });

    const result = await service.criarCobranca(baseInput);

    expect(abacate.createPixCharge).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
    expect(result.id).toBe('cob-existente');
    expect(result.brCode).toBe('existente-brcode');
  });

  it('marca cobrança como FAILED se a AbacatePay falhar', async () => {
    (repo.findByAgendamentoId as any).mockResolvedValue(null);
    (repo.create as any).mockResolvedValue({
      id: 'cob-1',
      ...baseInput,
      status: 'PENDING',
      expiresAt: new Date(),
    });
    (abacate.createPixCharge as any).mockRejectedValue(new Error('AbacatePay: invalid_amount'));

    await expect(service.criarCobranca(baseInput)).rejects.toThrow(/invalid_amount/);

    expect(repo.update).toHaveBeenCalledWith('cob-1', expect.objectContaining({
      status: 'FAILED',
      failureReason: expect.stringContaining('invalid_amount'),
    }));
  });
});

describe('CobrancaService.confirmarPagamento', () => {
  let repo: CobrancaRepository;
  let abacate: AbacatePayClient;
  let publisher: PublisherService;
  let service: CobrancaService;

  beforeEach(() => {
    repo = makeRepoMock();
    abacate = makeAbacateMock();
    publisher = makePublisherMock();
    service = new CobrancaService(repo, abacate, publisher, { defaultTtlSeconds: 3600 });
  });

  it('marca cobrança como PAID e publica pagamento.confirmado', async () => {
    (repo.findByAbacateId as any).mockResolvedValue({
      id: 'cob-1',
      empresaId: 'emp-1',
      agendamentoId: 'ag-1',
      abacateId: 'pix_abc',
      status: 'PENDING',
      amount: 10000,
    });
    (repo.update as any).mockResolvedValue({
      id: 'cob-1',
      status: 'PAID',
    });

    await service.confirmarPagamentoPorAbacateId({
      abacateId: 'pix_abc',
      paidAmount: 10000,
      paidAt: '2026-05-19T12:30:00.000Z',
    });

    expect(repo.update).toHaveBeenCalledWith('cob-1', expect.objectContaining({
      status: 'PAID',
      paidAmount: 10000,
      paidAt: expect.any(Date),
    }));
    expect(publisher.pagamentoConfirmado).toHaveBeenCalledWith(expect.objectContaining({
      agendamentoId: 'ag-1',
      empresaId: 'emp-1',
      cobrancaId: 'cob-1',
      valorPago: 10000,
      formaPagamento: 'PIX',
    }));
  });

  it('é idempotente — não republica se já está PAID', async () => {
    (repo.findByAbacateId as any).mockResolvedValue({
      id: 'cob-1',
      empresaId: 'emp-1',
      agendamentoId: 'ag-1',
      abacateId: 'pix_abc',
      status: 'PAID',
      amount: 10000,
    });

    await service.confirmarPagamentoPorAbacateId({
      abacateId: 'pix_abc',
      paidAmount: 10000,
      paidAt: '2026-05-19T12:30:00.000Z',
    });

    expect(repo.update).not.toHaveBeenCalled();
    expect(publisher.pagamentoConfirmado).not.toHaveBeenCalled();
  });

  it('lança erro quando cobrança não encontrada', async () => {
    (repo.findByAbacateId as any).mockResolvedValue(null);

    await expect(
      service.confirmarPagamentoPorAbacateId({
        abacateId: 'pix_inexistente',
        paidAmount: 10000,
        paidAt: '2026-05-19T12:30:00.000Z',
      }),
    ).rejects.toThrow(/não encontrada/i);
  });
});

describe('CobrancaService.expirarCobrancasVencidas', () => {
  let repo: CobrancaRepository;
  let abacate: AbacatePayClient;
  let publisher: PublisherService;
  let service: CobrancaService;

  beforeEach(() => {
    repo = makeRepoMock();
    abacate = makeAbacateMock();
    publisher = makePublisherMock();
    service = new CobrancaService(repo, abacate, publisher, { defaultTtlSeconds: 3600 });
  });

  it('marca todas vencidas como EXPIRED e publica pagamento.expirado para cada', async () => {
    (repo.findExpiradasPendentes as any).mockResolvedValue([
      {
        id: 'cob-1',
        empresaId: 'emp-1',
        agendamentoId: 'ag-1',
        clienteId: 'cli-1',
        clienteNome: 'João',
        clienteTelefone: '11999',
        status: 'PENDING',
      },
      {
        id: 'cob-2',
        empresaId: 'emp-1',
        agendamentoId: 'ag-2',
        clienteId: 'cli-2',
        clienteNome: 'Maria',
        clienteTelefone: '11988',
        status: 'PENDING',
      },
    ]);
    (repo.update as any).mockImplementation((id: string) => ({ id, status: 'EXPIRED' }));

    const expiradas = await service.expirarCobrancasVencidas(new Date('2026-05-19T15:00:00Z'));

    expect(expiradas).toBe(2);
    expect(repo.update).toHaveBeenCalledTimes(2);
    expect(publisher.pagamentoExpirado).toHaveBeenCalledTimes(2);
    expect(publisher.pagamentoExpirado).toHaveBeenCalledWith(expect.objectContaining({
      cobrancaId: 'cob-1',
      agendamentoId: 'ag-1',
    }));
  });
});
