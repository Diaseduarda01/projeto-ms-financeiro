import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { AbacatePayClient } from './abacatepay.client';

export const ABACATEPAY_CLIENT = Symbol('ABACATEPAY_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: ABACATEPAY_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AbacatePayClient({
          apiKey: config.get('ABACATEPAY_API_KEY'),
          apiUrl: config.get('ABACATEPAY_API_URL'),
          webhookSecret: config.get('ABACATEPAY_WEBHOOK_SECRET'),
        }),
    },
  ],
  exports: [ABACATEPAY_CLIENT],
})
export class AbacatePayModule {}
