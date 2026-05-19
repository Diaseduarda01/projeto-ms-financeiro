import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { CobrancaController } from './cobranca.controller';
import { CobrancaRepository } from './cobranca.repository';
import { CobrancaService } from './cobranca.service';

@Module({
  controllers: [CobrancaController],
  providers: [
    CobrancaRepository,
    {
      provide: 'COBRANCA_OPTIONS',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        defaultTtlSeconds: config.get('COBRANCA_TTL_SECONDS'),
      }),
    },
    CobrancaService,
  ],
  exports: [CobrancaService, CobrancaRepository],
})
export class CobrancaModule {}
