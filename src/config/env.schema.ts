import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3360),
  DATABASE_URL: z.string().min(1),
  RABBITMQ_URL: z.string().url(),
  ABACATEPAY_API_KEY: z.string().min(1),
  ABACATEPAY_API_URL: z.string().url().default('https://api.abacatepay.com/v2'),
  ABACATEPAY_WEBHOOK_SECRET: z.string().min(8),
  INTERNAL_API_KEY: z.string().min(16),
  COBRANCA_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
});

export type Env = z.infer<typeof envSchema>;
