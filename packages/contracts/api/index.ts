import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  timestamp: z.iso.datetime()
}).strict();

export type HealthResponse = z.infer<typeof healthResponseSchema>;
