import { z } from "zod";

export const MVPConfigSchema = z.object({
  tim_sdk_app_id: z.number().int(),
  tim_user_id: z.string(),
  tim_user_sig: z.string(),
  debug: z.boolean().default(false),
});

export type MVPConfig = z.infer<typeof MVPConfigSchema>;
