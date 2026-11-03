import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Paths anyone can open: the Google login, its callback, logging out, and
// the page that tells a logged-in non-admin they don't have access.
const OPEN_PATHS = ["/login", "/auth/callback", "/api/auth/logout", "/not-authorized"];

function redirectTo(request: NextRequest, pathname: string, from: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = "";
  const response = NextResponse.redirect(url);
  // Keep any refreshed session cookies.
  from.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

// Runs on every request: refreshes the Supabase session cookie, sends
// logged-out visitors to /login and logged-in non-admins to
// /not-authorized. The admin layout and every server action check again,
// and RLS checks a third time in the database.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (OPEN_PATHS.some((open) => path === open || path.startsWith(`${open}/`))) {
    return supabaseResponse;
  }

  if (!user) {
    return redirectTo(request, "/login", supabaseResponse);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_superadmin")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile?.is_superadmin) {
    return redirectTo(request, "/not-authorized", supabaseResponse);
  }

  return supabaseResponse;
}
