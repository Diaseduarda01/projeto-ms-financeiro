import { Inject, Injectable } from '@nestjs/common';
import { Cobranca, CobrancaStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

export interface CreateCobrancaData {
  empresaId: string;
  agendamentoId: string;
  clienteId: string;
  clienteNome: string;
  clienteTelefone: string;
  amount: number;
  externalId?: string;
  expiresAt: Date;
}

export interface UpdateCobrancaData {
  abacateId?: string;
  brCode?: string;
  brCodeBase64?: string;
  status?: CobrancaStatus;
  paidAmount?: number | null;
  paidAt?: Date | null;
  failureReason?: string | null;
  expiresAt?: Date;
}

@Injectable()
export class CobrancaRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  create(data: CreateCobrancaData): Promise<Cobranca> {
    return this.prisma.cobranca.create({ data });
  }

  findById(id: string): Promise<Cobranca | null> {
    return this.prisma.cobranca.findUnique({ where: { id } });
  }

  findByAgendamentoId(agendamentoId: string): Promise<Cobranca | null> {
    return this.prisma.cobranca.findUnique({ where: { agendamentoId } });
  }

  findByAbacateId(abacateId: string): Promise<Cobranca | null> {
    return this.prisma.cobranca.findUnique({ where: { abacateId } });
  }

  update(id: string, data: UpdateCobrancaData): Promise<Cobranca> {
    return this.prisma.cobranca.update({ where: { id }, data });
  }

  listExtrato(filters: {
    empresaId: string;
    inicio?: Date;
    fim?: Date;
    status?: CobrancaStatus;
  }): Promise<Cobranca[]> {
    const where: Prisma.CobrancaWhereInput = {
      empresaId: filters.empresaId,
      ...(filters.status && { status: filters.status }),
      ...((filters.inicio || filters.fim) && {
        createdAt: {
          ...(filters.inicio && { gte: filters.inicio }),
          ...(filters.fim && { lte: filters.fim }),
        },
      }),
    };
    return this.prisma.cobranca.findMany({ where, orderBy: { createdAt: 'desc' } });
  }

  findExpiradasPendentes(now: Date): Promise<Cobranca[]> {
    return this.prisma.cobranca.findMany({
      where: { status: 'PENDING', expiresAt: { lt: now } },
    });
  }

  logEvent(cobrancaId: string, type: string, payload: Prisma.InputJsonValue) {
    return this.prisma.cobrancaEvent.create({
      data: { cobrancaId, type, payload },
    });
  }

  markWebhookProcessed(externalEventId: string, type: string, payload: Prisma.InputJsonValue) {
    return this.prisma.webhookEvent.create({
      data: { externalEventId, type, payload },
    });
  }

  findWebhookEvent(externalEventId: string) {
    return this.prisma.webhookEvent.findUnique({ where: { externalEventId } });
  }
}
