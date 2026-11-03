import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import ChainTabs from "@/components/chain-tabs";

// Title and tabs shared by a chain's Steps, Run and Media pages.
export default async function ChainLayout({ children, params }: LayoutProps<"/chains/[id]">) {
  const { supabase } = await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const { data: chain } = await supabase
    .from("prompt_chains")
    .select("id, name, slug, is_builtin")
    .eq("id", id)
    .maybeSingle();
  if (!chain) notFound();

  return (
    <>
      <header className="flex flex-col gap-1">
        <Link href="/" className="text-sm underline opacity-75 hover:opacity-100">
          ← All chains
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="page-title">{chain.name}</h1>
          {chain.is_builtin && (
            <span className="rounded-full bg-mustard/15 px-2 py-0.5 text-xs text-mustard">
              built-in · read-only
            </span>
          )}
        </div>
        <p className="font-mono text-xs opacity-75">{chain.slug}</p>
      </header>
      <ChainTabs chainId={chain.id} builtin={chain.is_builtin} />
      {children}
    </>
  );
}
