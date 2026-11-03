import { createBrowserClient } from "@supabase/ssr";

// Browser-side client, used by the login page to start Google sign-in.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
