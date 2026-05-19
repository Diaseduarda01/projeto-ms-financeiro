import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ABACATEPAY_CLIENT } from '../abacatepay/abacatepay.module';
import { AbacatePayClient } from '../abacatepay/abacatepay.client';
import { CobrancaService } from '../cobranca/cobranca.service';
import { CobrancaRepository } from '../cobranca/cobranca.repository';

interface BillingPaidEvent {
  event: 'billing.paid';
  id: string;
  data: {
    billing: {
      id: string;
      amount: number;
      paidAt: string;
      status: string;
      externalId?: string | null;
    };
  };
}

@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    @Inject(ABACATEPAY_CLIENT) private readonly abacate: AbacatePayClient,
    @Inject(CobrancaService) private readonly service: CobrancaService,
    @Inject(CobrancaRepository) private readonly repo: CobrancaRepository,
  ) {}

  @Post('abacate')
  @HttpCode(200)
  async handleRaw(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-webhook-signature') signature: string,
  ) {
    const raw =
      req.rawBody ??
      (Buffer.isBuffer(req.body) ? (req.body as Buffer) : Buffer.from(JSON.stringify(req.body)));
    return this.handle(raw, signature);
  }

  async handle(rawBody: Buffer, signature: string): Promise<Record<string, unknown>> {
    if (!this.abacate.verifyWebhookSignature(rawBody, signature)) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Payload JSON inválido');
    }

    const eventId: string | undefined = payload?.id;
    const eventType: string | undefined = payload?.event;

    if (!eventId || !eventType) {
      throw new BadRequestException('Campos id/event obrigatórios ausentes');
    }

    const existente = await this.repo.findWebhookEvent(eventId);
    if (existente) {
      this.logger.log(`Evento ${eventId} já processado — idempotente`);
      return { received: true, idempotent: true };
    }

    if (eventType === 'billing.paid') {
      const evt = payload as BillingPaidEvent;
      const billing = evt.data?.billing;
      if (!billing?.id) {
        throw new BadRequestException('billing.id ausente');
      }

      await this.service.confirmarPagamentoPorAbacateId({
        abacateId: billing.id,
        paidAmount: billing.amount,
        paidAt: billing.paidAt,
      });

      await this.repo.markWebhookProcessed(eventId, eventType, payload);
      return { received: true };
    }

    this.logger.log(`Evento ignorado: ${eventType} (${eventId})`);
    return { received: true, ignored: true };
  }
}
