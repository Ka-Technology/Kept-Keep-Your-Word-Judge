// Just enough of Deno and @supabase/server for tsconfig.check.json to typecheck solana-pay's index.ts against
// its exact @solana packages on a machine without Deno (`npx tsc -p supabase/solana-pay-build/tsconfig.check.json`).
declare const Deno: { env: { get(name: string): string | undefined } };

declare module 'npm:@supabase/server@^1' {
  import type { SupabaseClient } from 'npm:@supabase/supabase-js@^2';
  export function withSupabase(opts: unknown, fn: (req: Request, ctx: { supabaseAdmin: SupabaseClient }) => Promise<Response>): (req: Request) => Promise<Response>;
}

declare module 'npm:@supabase/server@^1/core' {
  export function verifyAuth(req: Request, opts: unknown): Promise<{ data?: { userClaims?: { id: string } }; error?: unknown }>;
}
