import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqplib from 'amqplib';
import { Env } from '../config/env.schema';
import { FINANCEIRO_EXCHANGE } from './financeiro-events';

type MessageHandler = (payload: unknown) => Promise<void>;

interface ConsumerRegistration {
  queue: string;
  handler: MessageHandler;
}

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private connection: any = null;
  private publishChannel: amqplib.Channel | null = null;
  private readonly consumers: ConsumerRegistration[] = [];
  private reconnecting = false;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    try {
      await this.publishChannel?.close();
      await this.connection?.close();
    } catch {
      // ignore
    }
  }

  private async connect() {
    try {
      const url = this.config.get('RABBITMQ_URL');
      this.connection = await amqplib.connect(url);
      this.publishChannel = await this.connection.createChannel();
      await this.publishChannel!.assertExchange(FINANCEIRO_EXCHANGE, 'topic', { durable: true });

      this.connection.on('error', (err: Error) =>
        this.logger.error('Erro RabbitMQ', err.message),
      );

      this.connection.on('close', () => {
        if (!this.reconnecting) {
          this.reconnecting = true;
          this.logger.warn('Conexão RabbitMQ fechada — reconectando em 5s');
          setTimeout(() => this.reconnect(), 5000);
        }
      });

      for (const reg of this.consumers) {
        await this.setupConsumer(reg.queue, reg.handler);
      }

      this.logger.log('Conectado ao RabbitMQ');
    } catch (err: any) {
      this.logger.error(`Falha ao conectar ao RabbitMQ: ${err.message} — retry em 5s`);
      setTimeout(() => this.connect(), 5000);
    }
  }

  private async reconnect() {
    this.publishChannel = null;
    this.connection = null;
    this.reconnecting = false;
    await this.connect();
  }

  async publish<T extends object>(routingKey: string, payload: T): Promise<void> {
    if (!this.publishChannel) {
      this.logger.warn(`Não foi possível publicar [${routingKey}] — canal não pronto`);
      return;
    }

    const buf = Buffer.from(
      JSON.stringify({ ...payload, _publishedAt: new Date().toISOString() }),
    );

    const sent = this.publishChannel.publish(FINANCEIRO_EXCHANGE, routingKey, buf, {
      persistent: true,
      contentType: 'application/json',
    });

    if (!sent) {
      this.logger.warn(`Buffer cheio ao publicar: ${routingKey}`);
    }
  }

  async consume(queue: string, handler: MessageHandler): Promise<void> {
    if (!this.consumers.find((c) => c.queue === queue)) {
      this.consumers.push({ queue, handler });
    }
    await this.setupConsumer(queue, handler);
  }

  private async setupConsumer(queue: string, handler: MessageHandler): Promise<void> {
    if (!this.connection) return;
    try {
      const ch: amqplib.Channel = await this.connection.createChannel();
      await ch.assertQueue(queue, { durable: true });
      await ch.prefetch(1);

      await ch.consume(queue, async (msg: amqplib.ConsumeMessage | null) => {
        if (!msg) return;
        try {
          const payload = JSON.parse(msg.content.toString());
          await handler(payload);
          ch.ack(msg);
        } catch (err: any) {
          this.logger.error(`Erro processando ${queue}: ${err.message}`);
          ch.nack(msg, false, false);
        }
      });

      this.logger.log(`Consumer registrado: ${queue}`);
    } catch (err: any) {
      this.logger.error(`Falha ao iniciar consumer de ${queue}: ${err.message}`);
    }
  }

  isReady(): boolean {
    return this.connection !== null && this.publishChannel !== null;
  }
}
