import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CobrancaService } from '../../cobranca/cobranca.service';
import { MessagingService } from '../messaging.service';
import {
  AgendamentoConcluidoEvent,
  FINANCEIRO_CONSUME_QUEUE,
} from '../financeiro-events';

/**
 * Garantia 50% — quando o agendamento é concluído, cria cobrança Pix
 * no valor de metade do valorTotal. Mudar fator aqui se a regra de
 * garantia evoluir.
 */
const FATOR_GARANTIA = 0.5;

@Injectable()
export class CobrancaPendenteConsumer implements OnModuleInit {
  private readonly logger = new Logger(CobrancaPendenteConsumer.name);

  constructor(
    @Inject(MessagingService) private readonly messaging: MessagingService,
    @Inject(CobrancaService) private readonly cobranca: CobrancaService,
  ) {}

  async onModuleInit() {
    await this.messaging.consume(FINANCEIRO_CONSUME_QUEUE.COBRANCA_PENDENTE, (payload) =>
      this.handle(payload as AgendamentoConcluidoEvent),
    );
  }

  private async handle(event: AgendamentoConcluidoEvent) {
    if (!event?.agendamentoId || !event?.empresaId) {
      this.logger.warn('Evento sem agendamentoId/empresaId — ignorando');
      return;
    }

    const amount = Math.round(event.valorTotal * FATOR_GARANTIA);
    if (amount <= 0) {
      this.logger.warn(`valorTotal inválido em ${event.agendamentoId} — ignorando`);
      return;
    }

    await this.cobranca.criarCobranca({
      empresaId: event.empresaId,
      agendamentoId: event.agendamentoId,
      clienteId: event.clienteId,
      clienteNome: event.clienteNome,
      clienteTelefone: event.clienteTelefone,
      clienteEmail: this.fallbackEmail(event),
      clienteCpf: this.fallbackCpf(event),
      amount,
    });

    this.logger.log(`Cobrança Pix criada p/ agendamento ${event.agendamentoId} (R$ ${(amount / 100).toFixed(2)})`);
  }

  private fallbackEmail(event: AgendamentoConcluidoEvent): string {
    const sanitized = event.clienteTelefone.replace(/\D/g, '');
    return `cliente-${sanitized || event.clienteId}@plataforma-dias.local`;
  }

  private fallbackCpf(_event: AgendamentoConcluidoEvent): string {
    return '00000000000';
  }
}
