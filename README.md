# ms-financeiro — Cobranças Pix via AbacatePay

Microserviço dedicado a cobranças externas (Pix) da Plataforma Dias. Consome `agendamento.concluido` do RabbitMQ, cria cobrança Pix na **AbacatePay** e publica `pagamento.confirmado` / `pagamento.expirado` de volta no barramento. Exclusivo dos planos **Platinum** e **Gold**.

> Para detalhes de arquitetura, convenções de DI, máquina de estados da cobrança e estratégia de TDD, consulte `CLAUDE.md`.

## Stack

- **Runtime:** Node.js 20 + TypeScript 5.6
- **Framework:** NestJS 11
- **ORM:** Prisma 5.22 (MySQL)
- **Mensageria:** RabbitMQ (`amqplib`) — exchange `erp.events` (topic)
- **Validação:** Zod
- **Testes:** Vitest (TDD)
- **Gateway de pagamento:** AbacatePay v2 (`/transparents` — Pix QRCode)

## Estrutura (resumo)

```
src/
  main.ts                            # bootstrap — preserva rawBody pro webhook (HMAC)
  app.module.ts
  config/env.schema.ts               # Zod
  database/                          # Prisma global
  abacatepay/                        # HTTP client + HMAC SHA-256
  cobranca/                          # controller + service + repo + scheduler (expiração)
  webhook/                           # POST /webhook/abacatepay
  messaging/
    consumers/                       # cobranca-pendente.consumer (RabbitMQ)
    publishers/                      # pagamento.confirmado / pagamento.expirado
  health/
```

## Fluxo

```
ms-erp-api
  ↓ publica agendamento.concluido
  ↓ (fila financeiro.cobranca_pendente)
ms-financeiro.consumer
  ↓ cria Cobranca (PENDENTE) + chama AbacatePay.createPixCharge
  ↓ retorna QRCode pro cliente (via ms-erp-api → frontend)
AbacatePay
  ↓ webhook → POST /webhook/abacatepay (validação HMAC)
ms-financeiro
  ↓ publica pagamento.confirmado
ms-erp-api / ms-notificacao
```

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `POST` | `/cobrancas` | Cria cobrança Pix avulsa (uso interno via `X-Internal-Key`) |
| `GET` | `/cobrancas/:id/status` | Consulta status |
| `GET` | `/extrato?inicio=&fim=` | Extrato por período |
| `POST` | `/webhook/abacatepay` | Webhook AbacatePay (HMAC obrigatório) |
| `GET` | `/health/live` · `/health/ready` | Healthcheck |

Auth interna por `X-Internal-Key` (compartilhada via `INTERNAL_API_KEY`).

## Variáveis de ambiente

| Variável | Descrição |
|---|---|
| `PORT` | Porta HTTP (default `3360`) |
| `DATABASE_URL` | MySQL — Prisma |
| `RABBITMQ_URL` | Broker para consumir/publicar |
| `ABACATEPAY_API_KEY` | Chave da AbacatePay |
| `ABACATEPAY_API_URL` | Base URL da AbacatePay v2 |
| `ABACATEPAY_WEBHOOK_SECRET` | Segredo HMAC do webhook |
| `INTERNAL_API_KEY` | Chave usada entre MS |
| `COBRANCA_TTL_SECONDS` | TTL padrão da cobrança Pix (default `3600`) |

Veja `.env.example`.

## Comandos

```bash
npm run dev                  # nodemon
npm run build                # tsc
npm start                    # node dist/main.js
npm test                     # vitest run (TDD)
npx prisma migrate dev       # aplica migrations
npx prisma generate          # gera client
```

## Testes existentes (TDD)

- `abacatepay/abacatepay.client.test.ts` — fetch mockado + verificação HMAC real
- `cobranca/cobranca.service.test.ts` — máquina de estados (PENDENTE → PAGO/EXPIRADO/CANCELADO)
- `cobranca/cobranca.controller.test.ts`
- `webhook/webhook.controller.test.ts` — idempotência + assinatura
- `messaging/consumers/cobranca-pendente.consumer.test.ts`

Cobertura mínima planejada: 80% nos serviços de negócio.
