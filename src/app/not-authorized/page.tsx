import { createClient } from "@/utils/supabase/server";

// Where the proxy sends people who are logged in but aren't admins.
export default async function NotAuthorizedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
      <span className="text-5xl" aria-hidden>
        🔒
      </span>
      <h1 className="page-title">Superadmins only</h1>
      <p className="max-w-sm text-sm">
        {user?.email ? `${user.email} doesn't` : "This account doesn't"} have
        superadmin access, which the prompt chain tool needs. Ask an existing
        admin to grant it, or log in with a different account.
      </p>
      <form action="/api/auth/logout" method="post">
        <button type="submit" className="btn-secondary">
          Log out
        </button>
      </form>
    </main>
  );
}
