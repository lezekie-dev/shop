import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_TEST: z.string().url().optional(),
  SESSION_SECRET: z.string().min(8),
  SESSION_COOKIE_NAME: z.string().default("admin_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  PAYMENT_PROVIDER: z.enum(["stripe", "mobile_money", "mock"]).default("mock"),
  STRIPE_SECRET_KEY: z.string().default("sk_test_dummy"),
  STRIPE_WEBHOOK_SECRET: z.string().default("whsec_dummy"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
  }
  cached = parsed.data;
  return cached;
}
