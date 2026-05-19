import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cobranca } from '@prisma/client';
import { Env } from '../config/env.schema';
import { AbacatePayClient } from '../abacatepay/abacatepay.client';
import { ABACATEPAY_CLIENT } from '../abacatepay/abacatepay.module';
import { PublisherService } from '../messaging/publisher.service';
import { CobrancaRepository } from './cobranca.repository';

export interface CriarCobrancaInput {
  empresaId: string;
  agendamentoId: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  clienteEmail: string;
  clienteCpf: string;
  amount: number;
}

export interface ConfirmarPagamentoInput {
  abacateId: string;
  paidAmount: number;
  paidAt: string;
}

export interface ServiceOptions {
  defaultTtlSeconds: number;
}

@Injectable()
export class CobrancaService {
  private readonly logger = new Logger(CobrancaService.name);

  constructor(
    @Inject(CobrancaRepository) private readonly repo: CobrancaRepository,
    @Inject(ABACATEPAY_CLIENT) private readonly abacate: AbacatePayClient,
    @Inject(PublisherService) private readonly publisher: PublisherService,
    @Inject('COBRANCA_OPTIONS') private readonly options: ServiceOptions,
  ) {}

  static fromConfig(
    repo: CobrancaRepository,
    abacate: AbacatePayClient,
    publisher: PublisherService,
    config: ConfigService<Env, true>,
  ): CobrancaService {
    return new CobrancaService(repo, abacate, publisher, {
      defaultTtlSeconds: config.get('COBRANCA_TTL_SECONDS'),
    });
  }

  async criarCobranca(input: CriarCobrancaInput): Promise<Cobranca> {
    const existente = await this.repo.findByAgendamentoId(input.agendamentoId);
    if (existente && existente.status === 'PENDING') {
      this.logger.log(`Cobrança já existente p/ agendamento ${input.agendamentoId}: ${existente.id}`);
      return existente;
    }
    if (existente && existente.status === 'PAID') {
      return existente;
    }

    const expiresAt = new Date(Date.now() + this.options.defaultTtlSeconds * 1000);

    const cobranca = await this.repo.create({
      empresaId: input.empresaId,
      agendamentoId: input.agendamentoId,
      clienteId: input.clienteId,
      clienteNome: input.clienteNome,
      clienteTelefone: input.clienteTelefone,
      amount: input.amount,
      expiresAt,
    });

    try {
      const charge = await this.abacate.createPixCharge({
        amount: input.amount,
        expiresIn: this.options.defaultTtlSeconds,
        description: `Cobrança agendamento ${input.agendamentoId}`,
        externalId: cobranca.id,
        customer: {
          name: input.clienteNome,
          email: input.clienteEmail,
          cellphone: input.clienteTelefone,
          taxId: input.clienteCpf,
        },
        metadata: {
          empresaId: input.empresaId,
          agendamentoId: input.agendamentoId,
          cobrancaId: cobranca.id,
        },
      });

      const atualizada = await this.repo.update(cobranca.id, {
        abacateId: charge.id,
        brCode: charge.brCode,
        brCodeBase64: charge.brCodeBase64,
        expiresAt: new Date(charge.expiresAt),
      });

      await this.safeLogEvent(cobranca.id, 'PIX_CREATED', { abacateId: charge.id });

      return atualizada;
    } catch (err: any) {
      const reason = err?.message ?? 'erro desconhecido';
      await this.repo.update(cobranca.id, { status: 'FAILED', failureReason: reason });
      await this.safeLogEvent(cobranca.id, 'PIX_CREATION_FAILED', { error: reason });
      throw err;
    }
  }

  async confirmarPagamentoPorAbacateId(input: ConfirmarPagamentoInput): Promise<void> {
    const cobranca = await this.repo.findByAbacateId(input.abacateId);
    if (!cobranca) {
      throw new NotFoundException(`Cobrança não encontrada para abacateId=${input.abacateId}`);
    }

    if (cobranca.status === 'PAID') {
      this.logger.log(`Cobrança ${cobranca.id} já está PAID — ignorando`);
      return;
    }

    await this.repo.update(cobranca.id, {
      status: 'PAID',
      paidAmount: input.paidAmount,
      paidAt: new Date(input.paidAt),
    });

    await this.safeLogEvent(cobranca.id, 'PAYMENT_CONFIRMED', {
      paidAmount: input.paidAmount,
      paidAt: input.paidAt,
    });

    await this.publisher.pagamentoConfirmado({
      agendamentoId: cobranca.agendamentoId,
      empresaId: cobranca.empresaId,
      cobrancaId: cobranca.id,
      valorPago: input.paidAmount,
      formaPagamento: 'PIX',
      pagoEm: input.paidAt,
    });
  }

  async expirarCobrancasVencidas(now: Date = new Date()): Promise<number> {
    const expiradas = await this.repo.findExpiradasPendentes(now);

    for (const cob of expiradas) {
      await this.repo.update(cob.id, { status: 'EXPIRED' });
      await this.safeLogEvent(cob.id, 'PAYMENT_EXPIRED', { expiredAt: now.toISOString() });
      await this.publisher.pagamentoExpirado({
        agendamentoId: cob.agendamentoId,
        empresaId: cob.empresaId,
        clienteId: cob.clienteId,
        clienteNome: cob.clienteNome,
        clienteTelefone: cob.clienteTelefone,
        cobrancaId: cob.id,
      });
    }

    return expiradas.length;
  }

  async consultarStatus(id: string): Promise<Cobranca> {
    const cobranca = await this.repo.findById(id);
    if (!cobranca) {
      throw new NotFoundException(`Cobrança não encontrada: ${id}`);
    }
    return cobranca;
  }

  listarExtrato(filters: {
    empresaId: string;
    inicio?: Date;
    fim?: Date;
  }): Promise<Cobranca[]> {
    return this.repo.listExtrato(filters);
  }

  private async safeLogEvent(cobrancaId: string, type: string, payload: any): Promise<void> {
    try {
      await this.repo.logEvent(cobrancaId, type, payload);
    } catch (err: any) {
      this.logger.warn(`Falha ao registrar evento ${type} para ${cobrancaId}: ${err.message}`);
    }
  }
}
