import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// Returns the Supabase client and the signed-in admin, or redirects:
// logged out -> /login, not an admin -> /not-authorized. Every admin page
// (through the layout) and every server action calls this, so nothing
// depends on the proxy alone.
export async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, profpic, is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_superadmin) {
    redirect("/not-authorized");
  }

  return { supabase, user, profile };
}

export function fullName(profile: {
  first_name: string | null;
  last_name: string | null;
} | null | undefined) {
  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ");
  return name || "Unnamed user";
}
