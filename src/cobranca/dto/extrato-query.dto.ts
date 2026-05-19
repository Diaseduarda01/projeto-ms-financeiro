import { z } from 'zod';

export const extratoQuerySchema = z.object({
  empresaId: z.string().uuid(),
  inicio: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'inicio inválido (ISO 8601)'),
  fim: z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(Date.parse(v)), 'fim inválido (ISO 8601)'),
});

export type ExtratoQueryDto = z.infer<typeof extratoQuerySchema>;
