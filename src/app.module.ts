import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema';
import { PrismaModule } from './database/prisma.module';
import { AbacatePayModule } from './abacatepay/abacatepay.module';
import { MessagingModule } from './messaging/messaging.module';
import { CobrancaModule } from './cobranca/cobranca.module';
import { WebhookModule } from './webhook/webhook.module';
import { ConsumersModule } from './messaging/consumers/consumers.module';
import { HealthController } from './health/health.controller';
import { CobrancaExpiracaoScheduler } from './cobranca/cobranca-expiracao.scheduler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => envSchema.parse(config),
    }),
    PrismaModule,
    AbacatePayModule,
    MessagingModule,
    CobrancaModule,
    WebhookModule,
    ConsumersModule,
  ],
  controllers: [HealthController],
  providers: [CobrancaExpiracaoScheduler],
})
export class AppModule {}
