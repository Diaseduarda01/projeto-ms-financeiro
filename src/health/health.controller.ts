import { Controller, Get, Inject } from '@nestjs/common';
import { MessagingService } from '../messaging/messaging.service';

@Controller('health')
export class HealthController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  @Get()
  check() {
    const ready = this.messaging.isReady();
    return {
      status: ready ? 'ok' : 'degraded',
      rabbitmq: ready ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    };
  }
}
