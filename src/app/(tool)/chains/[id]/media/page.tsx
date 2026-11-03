import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { replyAsText } from "@/lib/chains";
import { dateTime, seconds } from "@/lib/format";
import { OWN_CRACK_IMAGE_PREFIX } from "@/lib/images";
import Pager from "@/components/pager";
import StatusPill from "@/components/status-pill";

const PER_PAGE = 12;

type Run = {
  id: number;
  source: string;
  status: string;
  error: string | null;
  input_text: string | null;
  prompt: string | null;
  image_url: string | null;
  output: string | null;
  output_json: string[] | null;
  created_at: string;
  finished_at: string | null;
  cracks: { img_url: string | null; text: string | null } | null;
};

type Reply = {
  generation_request_id: number;
  step_id: number | null;
  api_model: string;
  response_text: string | null;
  prompt_chain_steps: { name: string; step_order: number; output_format: "text" | "list" } | null;
};

const SOURCES: Record<string, string> = {
  "prompt-chain-tool": "prompt chain tool",
  "meme-board": "meme board",
  admin: "admin area",
};

// Everything this chain has produced, newest first: the input image and
// text, the final output, and what each step said on the way.
export default async function MediaPage({ params, searchParams }: PageProps<"/chains/[id]/media">) {
  const { supabase } = await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const status = typeof query.status === "string" ? query.status : "";

  let runsQuery = supabase
    .from("generation_requests")
    .select(
      "id, source, status, error, input_text, prompt, image_url, output, output_json, created_at, finished_at, cracks (img_url, text)",
      { count: "exact" }
    )
    .eq("chain_id", id)
    .order("created_at", { ascending: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);
  if (status) runsQuery = runsQuery.eq("status", status);

  const { data, count, error } = await runsQuery;
  if (error) throw new Error(`Couldn't load runs: ${error.message}`);
  const runs = (data ?? []) as unknown as Run[];

  const { data: replyData } = runs.length
    ? await supabase
        .from("llm_responses")
        .select("generation_request_id, step_id, api_model, response_text, prompt_chain_steps (name, step_order, output_format)")
        .in("generation_request_id", runs.map((r) => r.id))
        .eq("ok", true)
        .order("id")
    : { data: [] };
  const replies = new Map<number, Reply[]>();
  for (const reply of (replyData ?? []) as unknown as Reply[]) {
    replies.set(reply.generation_request_id, [...(replies.get(reply.generation_request_id) ?? []), reply]);
  }

  const pages = Math.max(1, Math.ceil((count ?? 0) / PER_PAGE));
  const filters = [
    { value: "", label: "All" },
    { value: "succeeded", label: "Succeeded" },
    { value: "failed", label: "Failed" },
    { value: "running", label: "Running" },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          {count ?? 0} run{count === 1 ? "" : "s"}
          {status ? ` ${status}` : ""}
        </p>
        <nav aria-label="Filter by status" className="flex gap-1 text-xs">
          {filters.map((f) => (
            <Link
              key={f.value}
              href={`/chains/${id}/media${f.value ? `?status=${f.value}` : ""}`}
              className={`rounded-full px-3 py-1 ${status === f.value ? "bg-foreground text-white" : "border border-black/15 dark:border-white/20"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>

      {runs.length === 0 && (
        <p className="card text-sm opacity-75">
          Nothing yet. <Link href={`/chains/${id}/run`} className="underline">Run the chain</Link> to make some.
        </p>
      )}

      <ul className="grid gap-4 md:grid-cols-2">
        {runs.map((run, i) => {
          const image = run.image_url ?? run.cracks?.img_url ?? null;
          const steps = replies.get(run.id) ?? [];
          const last = steps.at(-1);
          const list = run.output_json ?? null;
          const output =
            run.output ?? (last ? replyAsText(last.response_text, last.prompt_chain_steps?.output_format ?? "text") : null);
          const ms = run.finished_at ? Date.parse(run.finished_at) - Date.parse(run.created_at) : null;
          const input = run.input_text ?? (run.source === "prompt-chain-tool" ? null : run.cracks?.text);

          return (
            <li key={run.id} style={{ "--i": i } as React.CSSProperties} className="card cascade-in flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs opacity-90">
                <StatusPill status={run.status} />
                <span>#{run.id}</span>
                <span>· {dateTime(run.created_at)}</span>
                <span>· {seconds(ms)}</span>
                {run.source !== "prompt-chain-tool" && <span>· {SOURCES[run.source] ?? run.source}</span>}
              </div>

              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" loading="lazy" className="max-h-64 w-full rounded-lg bg-foreground/5 object-contain" />
              )}
              {input && (
                <p className="line-clamp-3 rounded-lg bg-foreground/5 px-3 py-2 text-sm">
                  <span className="text-xs uppercase opacity-60">Input · </span>
                  {input}
                </p>
              )}

              {run.status === "failed" && run.error && <p className="text-sm text-red-700">{run.error}</p>}
              {list && list.length > 0 ? (
                <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm font-medium">
                  {list.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ol>
              ) : (
                output && <p className="line-clamp-6 text-sm font-medium whitespace-pre-wrap">{output}</p>
              )}

              {steps.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer opacity-75">
                    Step outputs ({steps.length})
                  </summary>
                  <ol className="mt-2 flex flex-col gap-2">
                    {steps.map((reply, j) => (
                      <li key={j} className="rounded-lg bg-foreground/5 p-3">
                        <p className="mb-1 font-semibold">
                          {reply.prompt_chain_steps
                            ? `${reply.prompt_chain_steps.step_order}. ${reply.prompt_chain_steps.name}`
                            : "Deleted step"}{" "}
                          <span className="font-normal opacity-75">· {reply.api_model}</span>
                        </p>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap">
                          {replyAsText(reply.response_text, reply.prompt_chain_steps?.output_format ?? "text")}
                        </p>
                      </li>
                    ))}
                  </ol>
                </details>
              )}

              {run.source === "prompt-chain-tool" && image?.startsWith(OWN_CRACK_IMAGE_PREFIX) && (
                <Link
                  href={`/chains/${id}/run?${new URLSearchParams({ image })}`}
                  className="mt-auto self-start text-xs underline opacity-75 hover:opacity-100"
                >
                  Run again with this image
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      <Pager path={`/chains/${id}/media`} params={status ? { status } : {}} page={page} pages={pages} />
    </>
  );
}
