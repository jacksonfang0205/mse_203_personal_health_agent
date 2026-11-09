/** Small form-coach schemas shared by the browser and the server (no server-only imports). */
import { z } from "zod";
import { IsoDate } from "../schemas";

export const FormSessionSummary = z.object({
  date: IsoDate,
  movementId: z.string(),
  exerciseId: z.string().optional(),
  loadKg: z.number().min(0).max(500).optional(),
  reps: z.number().int().min(0).max(100).optional(),
  rpe: z.number().min(1).max(10).optional(),
  faults: z.array(z.string()).max(10),
  summary: z.record(z.string(), z.number()).optional(),
});
export type FormSessionSummary = z.infer<typeof FormSessionSummary>;
