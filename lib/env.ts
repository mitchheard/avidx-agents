import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const EnvSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  SLACK_WEBHOOK_DIGEST: z.string().url(),
  SLACK_WEBHOOK_ALERTS: z.string().url(),
  SLACK_WEBHOOK_ERRORS: z.string().url(),
  SLACK_WEBHOOK_MAIL_ZERO: z.string().url(),
  SLACK_WEBHOOK_INBOX: z.string().url(),
  LINEAR_API_KEY: z.string().min(1),
  UMAMI_API_URL: z.string().url(),
  UMAMI_USERNAME: z.string().min(1),
  UMAMI_PASSWORD: z.string().min(1),
  NOTION_TOKEN: z.string().min(1),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  // Google — required only by the morning-brief agent; optional here so other agents don't fail without them
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GOOGLE_REFRESH_TOKEN: z.string().min(1).optional(),
  GOOGLE_WORK_CALENDAR_ID: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
