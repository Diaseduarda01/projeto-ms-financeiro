import { Module } from '@nestjs/common';
import { CobrancaModule } from '../../cobranca/cobranca.module';
import { CobrancaPendenteConsumer } from './cobranca-pendente.consumer';

@Module({
  imports: [CobrancaModule],
  providers: [CobrancaPendenteConsumer],
})
export class ConsumersModule {}
