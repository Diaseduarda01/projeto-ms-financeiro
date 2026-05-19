/**
 * Contratos de mensageria do ms-financeiro.
 * Alinhado com ms-rabbitmq/src/messaging/topology.ts.
 */

export const FINANCEIRO_EXCHANGE = 'erp.events';

/** Filas que o ms-financeiro CONSOME */
export const FINANCEIRO_CONSUME_QUEUE = {
  COBRANCA_PENDENTE: 'financeiro.cobranca_pendente',
} as const;

/** Routing keys que o ms-financeiro PUBLICA */
export const FINANCEIRO_ROUTING_KEY = {
  PAGAMENTO_CONFIRMADO: 'pagamento.confirmado',
  PAGAMENTO_EXPIRADO: 'pagamento.expirado',
} as const;

// ─── Payloads consumidos ───────────────────────────────────────────────────────

/** Vem com routingKey `agendamento.concluido` na fila `financeiro.cobranca_pendente` */
export interface AgendamentoConcluidoEvent {
  agendamentoId: string;
  empresaId: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  valorTotal: number;
  servicoNome: string;
}

// ─── Payloads publicados ───────────────────────────────────────────────────────

export interface PagamentoConfirmadoEvent {
  agendamentoId: string;
  empresaId: string;
  cobrancaId: string;
  valorPago: number;
  formaPagamento: 'PIX';
  pagoEm: string;
}

export interface PagamentoExpiradoEvent {
  agendamentoId: string;
  empresaId: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  cobrancaId: string;
}
