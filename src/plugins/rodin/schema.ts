import { z } from 'zod';

// Pick model fields only; account details from the task response are discarded.
const rodinTaskSchema = z.object({
  task_uuid: z.string().uuid(),
  type: z.literal('Rodin'),
  prompt: z.string().optional(),
  time: z.string().optional(),
  generate_time: z.string().optional(),
  step: z.string().optional(),
  user_state: z.string().optional(),
  pending_jobs: z.array(z.unknown()).optional(),
  image_url: z.string().optional(),
  card_poster_info: z.object({ preview_image: z.string().optional() }).optional(),
  model_preview_info: z.object({ preview_sdf: z.string().optional() }).optional(),
});

export function parseRodinTask(payload: unknown) {
  const result = rodinTaskSchema.safeParse(payload);
  return result.success ? result.data : undefined;
}
