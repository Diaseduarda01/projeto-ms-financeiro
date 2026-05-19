import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CobrancaPendenteConsumer } from './cobranca-pendente.consumer';
import type { MessagingService } from '../messaging.service';
import type { CobrancaService } from '../../cobranca/cobranca.service';

function makeMessagingMock(): MessagingService {
  return {
    consume: vi.fn().mockResolvedValue(undefined),
  } as unknown as MessagingService;
}

function makeCobrancaMock(): CobrancaService {
  return {
    criarCobranca: vi.fn().mockResolvedValue({ id: 'cob-1' }),
  } as unknown as CobrancaService;
}

describe('CobrancaPendenteConsumer', () => {
  let messaging: MessagingService;
  let cobranca: CobrancaService;
  let consumer: CobrancaPendenteConsumer;

  beforeEach(() => {
    messaging = makeMessagingMock();
    cobranca = makeCobrancaMock();
    consumer = new CobrancaPendenteConsumer(messaging, cobranca);
  });

  it('registra consumer na fila correta no onModuleInit', async () => {
    await consumer.onModuleInit();

    expect(messaging.consume).toHaveBeenCalledTimes(1);
    const [queue, handler] = (messaging.consume as any).mock.calls[0];
    expect(queue).toBe('financeiro.cobranca_pendente');
    expect(typeof handler).toBe('function');
  });

  it('handler chama CobrancaService.criarCobranca com 50% do valorTotal', async () => {
    await consumer.onModuleInit();
    const handler = (messaging.consume as any).mock.calls[0][1];

    await handler({
      agendamentoId: 'ag-1',
      empresaId: 'emp-1',
      clienteId: 'cli-1',
      clienteNome: 'Maria',
      clienteTelefone: '11988887777',
      valorTotal: 20000,
      servicoNome: 'Corte',
    });

    expect(cobranca.criarCobranca).toHaveBeenCalledWith(expect.objectContaining({
      empresaId: 'emp-1',
      agendamentoId: 'ag-1',
      clienteId: 'cli-1',
      clienteNome: 'Maria',
      clienteTelefone: '11988887777',
      amount: 10000,
    }));
  });

  it('ignora payload sem agendamentoId silenciosamente', async () => {
    await consumer.onModuleInit();
    const handler = (messaging.consume as any).mock.calls[0][1];

    await handler({ empresaId: 'emp-1', valorTotal: 1000 });
    expect(cobranca.criarCobranca).not.toHaveBeenCalled();
  });
});
