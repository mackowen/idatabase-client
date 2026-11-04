import { z } from "zod";

export const operationIntentSchema = z.object({
  operationId: z.uuid(),
  destinationFingerprint: z.string().min(1),
  planHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  nonce: z.uuid(),
  expiresAt: z.iso.datetime()
}).strict();

export type OperationIntent = z.infer<typeof operationIntentSchema>;

export const commonErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.uuid().optional()
}).strict();

export type CommonError = z.infer<typeof commonErrorSchema>;
