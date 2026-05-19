import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import type { Request } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error'],
    bodyParser: false,
  });

  // Preserva rawBody apenas para a rota de webhook — necessário para verificação HMAC
  app.use(
    json({
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = Buffer.from(buf);
      },
    }),
  );

  const port = process.env.PORT ?? 3360;
  await app.listen(port);

  console.log(`ms-financeiro rodando na porta ${port}`);
  console.log(`Health: http://localhost:${port}/health`);
}

bootstrap();
