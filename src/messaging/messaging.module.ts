import { Global, Module } from '@nestjs/common';
import { MessagingService } from './messaging.service';
import { PublisherService } from './publisher.service';

@Global()
@Module({
  providers: [MessagingService, PublisherService],
  exports: [MessagingService, PublisherService],
})
export class MessagingModule {}
