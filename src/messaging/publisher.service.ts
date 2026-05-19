import { Inject, Injectable } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import {
  FINANCEIRO_ROUTING_KEY,
  PagamentoConfirmadoEvent,
  PagamentoExpiradoEvent,
} from './financeiro-events';

@Injectable()
export class PublisherService {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  pagamentoConfirmado(payload: PagamentoConfirmadoEvent) {
    return this.messaging.publish(FINANCEIRO_ROUTING_KEY.PAGAMENTO_CONFIRMADO, payload);
  }

  pagamentoExpirado(payload: PagamentoExpiradoEvent) {
    return this.messaging.publish(FINANCEIRO_ROUTING_KEY.PAGAMENTO_EXPIRADO, payload);
  }
}
