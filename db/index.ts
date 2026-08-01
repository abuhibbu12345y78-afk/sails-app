// import { env } from "cloudflare:workers";
// import { drizzle } from "drizzle-orm/d1";
// import * as schema from "./schema";

export function getRawDb(): any {
  throw new Error("D1 is not supported on Vercel Node runtime. Ensure DATABASE_PROVIDER=supabase is set.");
}

export function getDb(): any {
  throw new Error("D1 is not supported on Vercel Node runtime. Ensure DATABASE_PROVIDER=supabase is set.");
}
