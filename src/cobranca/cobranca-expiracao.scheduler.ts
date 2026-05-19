import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CobrancaService } from './cobranca.service';

const INTERVAL_MS = 5 * 60 * 1000; // 5 min

@Injectable()
export class CobrancaExpiracaoScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CobrancaExpiracaoScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(CobrancaService) private readonly service: CobrancaService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    try {
      const total = await this.service.expirarCobrancasVencidas();
      if (total > 0) {
        this.logger.log(`${total} cobranças expiradas`);
      }
    } catch (err: any) {
      this.logger.error(`Falha ao expirar cobranças: ${err.message}`);
    }
  }
}
