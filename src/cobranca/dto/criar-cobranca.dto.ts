import { z } from 'zod';

export const criarCobrancaSchema = z.object({
  empresaId: z.string().uuid(),
  agendamentoId: z.string().uuid(),
  clienteId: z.string().uuid(),
  clienteNome: z.string().min(1).max(150),
  clienteTelefone: z.string().min(8).max(20),
  clienteEmail: z.string().email(),
  clienteCpf: z.string().min(11).max(14),
  amount: z.number().int().positive(),
});

export type CriarCobrancaDto = z.infer<typeof criarCobrancaSchema>;
