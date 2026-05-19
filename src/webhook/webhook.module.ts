import { Module } from '@nestjs/common';
import { CobrancaModule } from '../cobranca/cobranca.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [CobrancaModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
