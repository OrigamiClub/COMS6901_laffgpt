import Link from "next/link";
import ThemeToggle from "@/components/theme-toggle";
import { fullName, requireAdmin } from "@/lib/admin";

const ADMIN_APP_URL = process.env.NEXT_PUBLIC_ADMIN_APP_URL;

// Shell for every page of the tool: a top bar with the signed-in
// superadmin, the theme switch and log out. Checks access itself, so the
// pages don't depend on the proxy alone.
export default async function ToolLayout({ children }: LayoutProps<"/">) {
  const { user, profile } = await requireAdmin();

  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-black/10 bg-background/90 px-5 py-3 backdrop-blur lg:px-10 dark:border-white/15">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-xl leading-tight font-light tracking-tight text-title">laffgpt</span>
          <span className="text-xs opacity-75">prompt chains</span>
        </Link>
        {ADMIN_APP_URL && (
          <a href={ADMIN_APP_URL} target="_blank" rel="noreferrer" className="text-xs underline opacity-75 hover:opacity-100">
            Admin area ↗
          </a>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <ThemeToggle />
          <div className="flex items-center gap-2 text-sm">
            {profile.profpic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.profpic} alt="" className="size-8 rounded-full object-cover" />
            ) : (
              <span className="flex size-8 items-center justify-center rounded-full bg-foreground text-white">
                🐹
              </span>
            )}
            <div className="hidden min-w-0 sm:block">
              <p className="truncate font-medium leading-tight">{fullName(profile)}</p>
              <p className="truncate text-xs opacity-75">{user.email}</p>
            </div>
          </div>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="btn-outline h-8">
              Log out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-8 p-5 lg:p-10">
        {children}
      </main>
    </div>
  );
}
