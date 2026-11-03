import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { CHAIN_COLUMNS, type Chain } from "@/lib/chains";
import { dateTime } from "@/lib/format";
import Notice from "@/components/notice";
import { INPUT, LABEL, TEXTAREA } from "@/components/field-styles";
import { createChain } from "./chains/actions";

// Every prompt chain: the ones made here first, then the meme board's
// built-in ones, which are shown for reference.
export default async function ChainsPage({ searchParams }: PageProps<"/">) {
  const { supabase } = await requireAdmin();
  const { notice } = await searchParams;

  const [chains, stats] = await Promise.all([
    supabase
      .from("prompt_chains")
      .select(`${CHAIN_COLUMNS}, prompt_chain_steps (count)`)
      .order("is_builtin")
      .order("updated_at", { ascending: false }),
    supabase.from("generation_stats").select("chain_id, runs, last_run_at"),
  ]);
  if (chains.error) throw new Error(`Couldn't load chains: ${chains.error.message}`);

  const statsByChain = new Map(
    (stats.data ?? []).map((s) => [s.chain_id as number, s as { runs: number; last_run_at: string | null }])
  );
  const rows = chains.data as (Chain & { prompt_chain_steps: { count: number }[] })[];

  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="page-title">Prompt chains</h1>
        <p className="max-w-2xl text-sm">
          A chain is a list of prompts run in order. Each step can use its own Gemini model and
          temperature, and gets the previous step&apos;s output as{" "}
          <code className="rounded bg-foreground/10 px-1">{"{{input}}"}</code>.
        </p>
      </header>

      <Notice value={notice?.toString()} />

      <section className="grid gap-3 sm:grid-cols-2">
        {rows.map((chain, i) => {
          const s = statsByChain.get(chain.id);
          const stepCount = chain.prompt_chain_steps[0]?.count ?? 0;
          return (
            <Link
              key={chain.id}
              href={`/chains/${chain.id}`}
              style={{ "--i": i } as React.CSSProperties}
              className="card cascade-in btn-pop flex flex-col gap-2 hover:border-foreground"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-semibold">{chain.name}</h2>
                {chain.is_builtin && (
                  <span className="rounded-full bg-mustard/15 px-2 py-0.5 text-xs whitespace-nowrap text-mustard">
                    built-in · read-only
                  </span>
                )}
              </div>
              {chain.description && <p className="line-clamp-2 text-sm opacity-90">{chain.description}</p>}
              <p className="mt-auto text-xs opacity-75">
                {stepCount} step{stepCount === 1 ? "" : "s"} · {s?.runs ?? 0} run
                {s?.runs === 1 ? "" : "s"}
                {s?.last_run_at ? ` · last run ${dateTime(s.last_run_at)}` : ""}
              </p>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="text-sm opacity-75">No chains yet.</p>}
      </section>

      <section className="card flex flex-col gap-4" id="new-chain">
        <h2 className="section-title">New chain</h2>
        <form action={createChain} className="grid gap-4 sm:grid-cols-2">
          <label className={LABEL}>
            Name
            <input name="name" required maxLength={80} placeholder="Image → five captions" className={INPUT} />
          </label>
          <label className={LABEL}>
            Slug (optional)
            <input name="slug" maxLength={50} pattern="[a-z0-9\-]+" placeholder="made from the name" className={INPUT} />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            Description
            <textarea name="description" maxLength={500} rows={2} className={TEXTAREA} />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="btn-primary">
              + Create chain
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
