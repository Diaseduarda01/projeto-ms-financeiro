import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { CobrancaController } from './cobranca.controller';
import type { CobrancaService } from './cobranca.service';
import type { ConfigService } from '@nestjs/config';

function makeServiceMock(): CobrancaService {
  return {
    criarCobranca: vi.fn(),
    consultarStatus: vi.fn(),
    listarExtrato: vi.fn(),
  } as unknown as CobrancaService;
}

function makeConfig(internalKey: string): ConfigService {
  return { get: vi.fn().mockReturnValue(internalKey) } as unknown as ConfigService;
}

const validInternal = 'dias-internal-key-dev-32-chars!!';
const validBody = {
  empresaId: '11111111-1111-1111-1111-111111111111',
  agendamentoId: '22222222-2222-2222-2222-222222222222',
  clienteId: '33333333-3333-3333-3333-333333333333',
  clienteNome: 'João',
  clienteTelefone: '11999999999',
  clienteEmail: 'joao@example.com',
  clienteCpf: '12345678900',
  amount: 10000,
};

describe('CobrancaController.criar', () => {
  let service: CobrancaService;
  let config: ConfigService;
  let controller: CobrancaController;

  beforeEach(() => {
    service = makeServiceMock();
    config = makeConfig(validInternal);
    controller = new CobrancaController(service, config);
  });

  it('cria cobrança quando internal key e body são válidos', async () => {
    (service.criarCobranca as any).mockResolvedValue({
      id: 'cob-1',
      status: 'PENDING',
      amount: 10000,
      brCode: '0002...',
      brCodeBase64: 'AAA',
      expiresAt: new Date('2026-05-19T13:00:00Z'),
    });

    const result = await controller.criar(validInternal, validBody);

    expect(service.criarCobranca).toHaveBeenCalledWith(validBody);
    expect(result.id).toBe('cob-1');
    expect(result.brCode).toBe('0002...');
  });

  it('rejeita com 403 quando internal key não bate', async () => {
    await expect(controller.criar('errada', validBody)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.criarCobranca).not.toHaveBeenCalled();
  });

  it('rejeita com 400 quando body é inválido', async () => {
    await expect(
      controller.criar(validInternal, { ...validBody, amount: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CobrancaController.extrato', () => {
  let service: CobrancaService;
  let controller: CobrancaController;

  beforeEach(() => {
    service = makeServiceMock();
    controller = new CobrancaController(service, makeConfig(validInternal));
  });

  it('soma totalRecebido apenas de cobranças PAID', async () => {
    (service.listarExtrato as any).mockResolvedValue([
      { id: '1', agendamentoId: 'a', clienteNome: 'A', amount: 1000, paidAmount: 1000, status: 'PAID', createdAt: new Date(), paidAt: new Date() },
      { id: '2', agendamentoId: 'b', clienteNome: 'B', amount: 2000, paidAmount: null, status: 'PENDING', createdAt: new Date(), paidAt: null },
      { id: '3', agendamentoId: 'c', clienteNome: 'C', amount: 3000, paidAmount: 3000, status: 'PAID', createdAt: new Date(), paidAt: new Date() },
    ]);

    const result = await controller.extrato(validInternal, {
      empresaId: '44444444-4444-4444-4444-444444444444',
    });

    expect(result.total).toBe(3);
    expect(result.totalRecebido).toBe(4000);
    expect(result.items).toHaveLength(3);
  });

  it('aceita filtro de período inicio/fim', async () => {
    (service.listarExtrato as any).mockResolvedValue([]);

    await controller.extrato(validInternal, {
      empresaId: '44444444-4444-4444-4444-444444444444',
      inicio: '2026-05-01T00:00:00Z',
      fim: '2026-05-31T23:59:59Z',
    });

    expect(service.listarExtrato).toHaveBeenCalledWith({
      empresaId: '44444444-4444-4444-4444-444444444444',
      inicio: new Date('2026-05-01T00:00:00Z'),
      fim: new Date('2026-05-31T23:59:59Z'),
    });
  });
});
