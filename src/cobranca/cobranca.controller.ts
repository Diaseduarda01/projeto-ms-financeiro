import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { CobrancaService } from './cobranca.service';
import { criarCobrancaSchema } from './dto/criar-cobranca.dto';
import { extratoQuerySchema } from './dto/extrato-query.dto';

@Controller()
export class CobrancaController {
  constructor(
    @Inject(CobrancaService) private readonly service: CobrancaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('cobrancas')
  async criar(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: unknown,
  ) {
    this.assertInternalKey(internalKey);

    const parsed = criarCobrancaSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const cobranca = await this.service.criarCobranca(parsed.data);
    return {
      id: cobranca.id,
      status: cobranca.status,
      amount: cobranca.amount,
      brCode: cobranca.brCode,
      brCodeBase64: cobranca.brCodeBase64,
      expiresAt: cobranca.expiresAt,
    };
  }

  @Get('cobrancas/:id/status')
  async status(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Param('id') id: string,
  ) {
    this.assertInternalKey(internalKey);
    const cobranca = await this.service.consultarStatus(id);
    return {
      id: cobranca.id,
      status: cobranca.status,
      amount: cobranca.amount,
      paidAmount: cobranca.paidAmount,
      paidAt: cobranca.paidAt,
      expiresAt: cobranca.expiresAt,
    };
  }

  @Get('extrato')
  async extrato(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Query() query: unknown,
  ) {
    this.assertInternalKey(internalKey);
    const parsed = extratoQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    const items = await this.service.listarExtrato({
      empresaId: parsed.data.empresaId,
      inicio: parsed.data.inicio ? new Date(parsed.data.inicio) : undefined,
      fim: parsed.data.fim ? new Date(parsed.data.fim) : undefined,
    });

    return {
      total: items.length,
      totalRecebido: items
        .filter((c) => c.status === 'PAID')
        .reduce((sum, c) => sum + (c.paidAmount ?? c.amount), 0),
      items: items.map((c) => ({
        id: c.id,
        agendamentoId: c.agendamentoId,
        clienteNome: c.clienteNome,
        amount: c.amount,
        paidAmount: c.paidAmount,
        status: c.status,
        createdAt: c.createdAt,
        paidAt: c.paidAt,
      })),
    };
  }

  private assertInternalKey(internalKey: string | undefined): void {
    const expected = this.config.get('INTERNAL_API_KEY');
    if (!internalKey || internalKey !== expected) {
      throw new ForbiddenException('Chave interna inválida');
    }
  }
}
