// import { env } from "cloudflare:workers";
// import { drizzle } from "drizzle-orm/d1";
// import * as schema from "./schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRawDb(): any {
  throw new Error("D1 is not supported on Vercel Node runtime. Ensure DATABASE_PROVIDER=supabase is set.");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDb(): any {
  throw new Error("D1 is not supported on Vercel Node runtime. Ensure DATABASE_PROVIDER=supabase is set.");
}
