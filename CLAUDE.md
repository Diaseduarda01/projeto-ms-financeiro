# ms-financeiro — Cobranças Pix via AbacatePay

Microserviço dedicado a cobranças externas (Pix) da Plataforma Dias. Consome `agendamento.concluido` do RabbitMQ, cria cobrança Pix na AbacatePay e publica `pagamento.confirmado` / `pagamento.expirado` de volta no barramento. Exclusivo dos planos **Platinum** e **Gold**.

## Stack

- **Runtime:** Node.js 20 + TypeScript 5.6
- **Framework:** NestJS 11
- **ORM:** Prisma 5.22 (MySQL)
- **Mensageria:** RabbitMQ (`amqplib`) — exchange `erp.events` (topic)
- **Validação:** Zod (env + DTOs)
- **Testes:** Vitest (TDD)
- **Gateway de pagamento:** AbacatePay v2 (`/transparents` — Pix QRCode)
- **Dev runner:** nodemon + ts-node
- **Docker:** Dockerfile multi-stage (porta 3360)

## Estrutura de pastas

```
src/
  main.ts                            # bootstrap NestJS — preserva rawBody pro webhook (HMAC)
  app.module.ts                      # módulo raiz: Prisma, AbacatePay, Messaging, Cobranca, Webhook, Consumers
  config/
    env.schema.ts                    # Zod — validado no ConfigModule.forRoot
  database/
    prisma.service.ts                # PrismaClient + lifecycle
    prisma.module.ts                 # @Global()
  abacatepay/
    abacatepay.client.ts             # HTTP client: createPixCharge, checkPixStatus, verifyWebhookSignature (HMAC-SHA256)
    abacatepay.client.test.ts        # TDD do client (fetch mockado + HMAC real)
    abacatepay.module.ts             # @Global() — provê ABACATEPAY_CLIENT via factory
  cobranca/
    cobranca.controller.ts           # POST /cobrancas, GET /cobrancas/:id/status, GET /extrato
    cobranca.controller.test.ts
    cobranca.service.ts              # domínio: criar, confirmar, expirar, idempotência
    cobranca.service.test.ts
    cobranca.repository.ts           # Prisma wrapper
    cobranca.module.ts
    cobranca-expiracao.scheduler.ts  # setInterval 5min → expirar vencidas
    dto/
      criar-cobranca.dto.ts          # Zod schema
      extrato-query.dto.ts
  messaging/
    messaging.service.ts             # connect/publish/consume com reconnect
    publisher.service.ts             # tipado: pagamentoConfirmado, pagamentoExpirado
    financeiro-events.ts             # contratos de payload (alinhado com ms-rabbitmq/topology.ts)
    messaging.module.ts              # @Global()
    consumers/
      cobranca-pendente.consumer.ts  # consome financeiro.cobranca_pendente → cria Pix 50%
      cobranca-pendente.consumer.test.ts
      consumers.module.ts
  webhook/
    webhook.controller.ts            # POST /webhook/abacate — HMAC + idempotência
    webhook.controller.test.ts
    webhook.module.ts
  health/
    health.controller.ts             # GET /health
prisma/
  schema.prisma                      # Cobranca, CobrancaEvent, WebhookEvent + enum CobrancaStatus
```

## Variáveis de ambiente

Arquivo `.env` (ver `.env.example`):

```
PORT=3360
DATABASE_URL=mysql://financeiro:financeiro@localhost:3306/ms_financeiro
RABBITMQ_URL=amqp://guest:guest@localhost:5672
ABACATEPAY_API_KEY=abc_dev_xxxxxxxxxxxxxxxxxxxxxxxxxx
ABACATEPAY_API_URL=https://api.abacatepay.com/v2
ABACATEPAY_WEBHOOK_SECRET=change-me-in-production-32-chars
INTERNAL_API_KEY=dias-internal-key-dev-32-chars!!
COBRANCA_TTL_SECONDS=3600
```

Validadas por `envSchema` (Zod) no `ConfigModule.forRoot`. A aplicação não sobe se faltarem.

## Comandos

```bash
npm run dev              # nodemon → ts-node src/main.ts (hot reload)
npm run build            # tsc → dist/
npm start                # node dist/main.js
npm test                 # vitest run (suite completa)
npm run test:watch       # vitest watch
npx prisma generate      # gera Prisma Client
npx prisma migrate dev   # aplica migrations no MySQL
```

## Padrão de DI obrigatório — @Inject(Type) explícito

Igual ao `ms-erp-api`: todo construtor declara `@Inject(Type)` em cada parâmetro. Garante compatibilidade com `tsx` (sem emitDecoratorMetadata) e mantém o código uniforme com o resto do monorepo.

```typescript
constructor(
  @Inject(CobrancaRepository) private readonly repo: CobrancaRepository,
  @Inject(ABACATEPAY_CLIENT) private readonly abacate: AbacatePayClient,
) {}
```

Para o `AbacatePayClient` (que não é uma classe NestJS pura, e sim um wrapper instanciado por factory), usar o token `ABACATEPAY_CLIENT` exportado por `abacatepay.module.ts`.

---

## Endpoints

Todos os endpoints HTTP (exceto webhook) exigem o header `X-Internal-Key` igual a `INTERNAL_API_KEY`. O webhook valida assinatura HMAC-SHA256 no header `x-webhook-signature`.

### POST `/cobrancas` — Cria cobrança Pix

**Headers:** `X-Internal-Key: <key>`

**Body:**
```json
{
  "empresaId": "uuid",
  "agendamentoId": "uuid",
  "clienteId": "uuid",
  "clienteNome": "João da Silva",
  "clienteTelefone": "11999999999",
  "clienteEmail": "joao@example.com",
  "clienteCpf": "12345678900",
  "amount": 10000
}
```

`amount` em centavos (10000 = R$ 100,00).

**Resposta 201:**
```json
{
  "id": "uuid",
  "status": "PENDING",
  "amount": 10000,
  "brCode": "00020126...",
  "brCodeBase64": "data:image/png;base64,...",
  "expiresAt": "2026-05-19T13:00:00.000Z"
}
```

**Idempotente** por `agendamentoId` — segundo POST com mesmo `agendamentoId` retorna a cobrança existente sem chamar a AbacatePay novamente.

### GET `/cobrancas/:id/status`

**Resposta 200:**
```json
{
  "id": "uuid",
  "status": "PENDING | PAID | EXPIRED | CANCELLED | FAILED",
  "amount": 10000,
  "paidAmount": null,
  "paidAt": null,
  "expiresAt": "..."
}
```

### POST `/webhook/abacate`

Endpoint **público** — sem `X-Internal-Key`, mas com verificação HMAC. Body é JSON do AbacatePay.

**Headers:** `x-webhook-signature: <base64-hmac>`

Eventos tratados:
- `billing.paid` → marca cobrança como `PAID` + publica `pagamento.confirmado`

Eventos com `id` já processado retornam `{ received: true, idempotent: true }` (idempotência via tabela `WebhookEvent`).

### GET `/extrato?empresaId=&inicio=&fim=`

**Headers:** `X-Internal-Key: <key>`

**Resposta 200:**
```json
{
  "total": 42,
  "totalRecebido": 380000,
  "items": [
    {
      "id": "uuid",
      "agendamentoId": "uuid",
      "clienteNome": "João",
      "amount": 10000,
      "paidAmount": 10000,
      "status": "PAID",
      "createdAt": "...",
      "paidAt": "..."
    }
  ]
}
```

### GET `/health`

Sem auth. Retorna `{ status, rabbitmq, timestamp }`.

---

## Contratos de mensageria

Alinhados com `ms-rabbitmq/src/messaging/topology.ts`. **Qualquer alteração aqui deve refletir em `infra/rabbitmq/definitions.json`**.

### Consome

| Fila | Routing key origem | Publisher | Payload |
|---|---|---|---|
| `financeiro.cobranca_pendente` | `agendamento.concluido` | `ms-erp-api` | `AgendamentoConcluidoEvent` |

Ao receber, o `CobrancaPendenteConsumer` cria cobrança Pix de **50% do `valorTotal`** (garantia antecipada). Fator definido em `cobranca-pendente.consumer.ts:FATOR_GARANTIA`.

### Publica

| Routing key | Fila destino | Consumer | Payload |
|---|---|---|---|
| `pagamento.confirmado` | `erp.pagamento_confirmado` | `ms-erp-api` | `PagamentoConfirmadoEvent` |
| `pagamento.expirado` | `notificacao.cobranca_expirada` | `ms-notificacao` | `PagamentoExpiradoEvent` |

`pagamento.confirmado` é emitido pelo webhook `billing.paid`. `pagamento.expirado` é emitido pelo `CobrancaExpiracaoScheduler` (tick a cada 5min).

---

## Modelo de dados

```
Cobranca         id, empresaId, agendamentoId (unique), clienteId, clienteNome, clienteTelefone,
                 abacateId (unique nullable), brCode, brCodeBase64, amount, paidAmount,
                 status (enum), externalId (unique nullable), expiresAt, paidAt, failureReason,
                 createdAt, updatedAt
CobrancaEvent    id, cobrancaId (FK cascade), type, payload (Json), createdAt
WebhookEvent     id, externalEventId (unique), type, payload (Json), processedAt
```

Enum `CobrancaStatus { PENDING, PAID, EXPIRED, CANCELLED, FAILED }`.

Indexes em `(empresaId, status)` e `(empresaId, createdAt)` para extrato eficiente.

---

## AbacatePay — integração

Cliente: `src/abacatepay/abacatepay.client.ts`. Envelopa `/transparents/create` e `/transparents/check` da API v2. Todos os valores monetários em **centavos**.

- **Autenticação:** `Authorization: Bearer <ABACATEPAY_API_KEY>`
- **Webhook:** HMAC-SHA256 do body bruto usando `ABACATEPAY_WEBHOOK_SECRET`, comparação em tempo constante (`crypto.timingSafeEqual`)
- **Dev mode:** keys que começam com `abc_dev_` simulam pagamentos — não há cobrança real
- **Simular pagamento:** `POST /v2/transparents/simulate-payment?id=<charge_id>` (apenas dev mode)

---

## TDD

Suite Vitest em `src/**/*.test.ts`. Rodar:

```bash
npm test
```

Cobre: `AbacatePayClient` (fetch mockado + HMAC real), `CobrancaService` (criação/idempotência/falha/expiração em lote), `CobrancaController` (auth + validação Zod + soma), `WebhookController` (assinatura válida/inválida/idempotência/eventos desconhecidos), `CobrancaPendenteConsumer` (registro + 50% + payload inválido).

**Convenção:** teste vive ao lado do arquivo (`x.ts` + `x.test.ts`). Pular esse pareamento só faz sentido quando o teste depende de fixtures grandes — nesse caso, mover para `__tests__/integration/`.

---

## Bootstrap rawBody (webhook HMAC)

`bodyParser: false` no `NestFactory.create` + middleware `express.json({ verify })` que copia o buffer cru pra `req.rawBody`. O `WebhookController` lê `req.rawBody` antes de qualquer parse do Nest — sem isso a assinatura quebra.

---

## Pontas de integração ainda pendentes

Ver `ROADMAP.md` (Fase 4). Bloqueios atuais:

- `ms-financeiro` ainda não está no `infra/docker-compose.dev.yml`
- Não há `ms-database/services/ms-financeiro/` com SQL de bootstrap do banco MySQL
- Migration Prisma inicial precisa ser gerada (`npx prisma migrate dev --name init`) apontando para um MySQL real e commitada
- Payload `AgendamentoConcluidoEvent` não carrega `clienteEmail`/`clienteCpf` — hoje o consumer usa fallback. Solução limpa: o consumer chama `GET /internal/clientes/:id` no `ms-erp-api` (via `INTERNAL_API_KEY`)
- `ms-notificacao` ainda não tem consumer pra `notificacao.cobranca_expirada` — o evento `pagamento.expirado` morre na fila até isso existir
- Webhook precisa ser cadastrado no dashboard AbacatePay apontando para `https://<host>/webhook/abacate` em produção
