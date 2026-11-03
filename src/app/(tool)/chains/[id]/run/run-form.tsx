"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { abandonRun, runStep, startRun } from "../../run-actions";
import { LABEL, TEXTAREA } from "@/components/field-styles";
import StatusPill from "@/components/status-pill";

type StepInfo = { id: number; name: string; includeImage: boolean; temperature: number; hasPrompt: boolean };

type StepState =
  | { status: "waiting" }
  | { status: "running" }
  | { status: "succeeded"; output: string; list: string[] | null; model: string; prompt: string }
  | { status: "failed"; error: string };

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Starts a run, then asks the server to run each step in turn, showing
// each output as it arrives.
export default function RunForm({
  chainId,
  steps,
  reuseImage,
}: {
  chainId: number;
  steps: StepInfo[];
  reuseImage?: string;
}) {
  const [preview, setPreview] = useState<string | null>(reuseImage ?? null);
  const [keepImage, setKeepImage] = useState(reuseImage ?? "");
  const [error, setError] = useState<string | null>(null);
  const [runId, setRunId] = useState<number | null>(null);
  const [states, setStates] = useState<StepState[]>([]);
  const [busy, setBusy] = useState(false);
  const stopped = useRef(false);
  const activeRun = useRef<number | null>(null);

  const missingPrompt = steps.some((s) => !s.hasPrompt);
  const usesImage = steps.some((s) => s.includeImage);

  // Mark an unfinished run as stopped if the admin leaves the page.
  useEffect(() => {
    const onLeave = () => {
      if (activeRun.current) void abandonRun(activeRun.current);
    };
    window.addEventListener("pagehide", onLeave);
    return () => {
      window.removeEventListener("pagehide", onLeave);
      onLeave();
    };
  }, []);

  function onImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setKeepImage("");
    if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    if (!file) return setPreview(null);
    if (file.size > MAX_IMAGE_BYTES) {
      e.target.value = "";
      setError("Images must be 4MB or smaller.");
      return setPreview(null);
    }
    setError(null);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    stopped.current = false;
    setStates(steps.map(() => ({ status: "waiting" })));
    setRunId(null);

    // Which part was running when a request failed, for the error message.
    let phase = "starting the run";
    const formData = new FormData(e.currentTarget);
    formData.set("chain_id", String(chainId));
    if (keepImage) formData.set("image_url", keepImage);

    try {
      const started = await startRun(formData);
      if ("error" in started) {
        setError(started.error);
        setStates([]);
        return;
      }
      setRunId(started.runId);
      activeRun.current = started.runId;

      for (let i = 0; i < started.steps.length; i++) {
        if (stopped.current) {
          await abandonRun(started.runId);
          setStates((prev) => prev.map((s) => (s.status === "waiting" ? { status: "failed", error: "Stopped." } : s)));
          break;
        }
        setStates((prev) => prev.map((s, j) => (j === i ? { status: "running" } : s)));
        phase = `step ${i + 1}`;
        const result = await runStep(started.runId, i);
        if ("error" in result) {
          setStates((prev) => prev.map((s, j) => (j === i ? { status: "failed", error: result.error } : s)));
          break;
        }
        setStates((prev) => prev.map((s, j) => (j === i ? { status: "succeeded", ...result } : s)));
      }
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 200)})` : "";
      setError(
        `The server didn't answer while ${phase}${detail}. It may have timed out — check the Vercel function logs, then try again.`
      );
      setStates((prev) =>
        prev.map((s) => (s.status === "running" ? { status: "failed", error: "No answer from the server." } : s))
      );
    } finally {
      activeRun.current = null;
      setBusy(false);
    }
  }

  const finalState = states[steps.length - 1];

  return (
    <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <form onSubmit={onSubmit} className="card flex flex-col gap-4 self-start">
        <h2 className="section-title">Input</h2>
        <label className={LABEL}>
          Image {usesImage ? "" : "(no step uses it)"}
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={onImage}
            disabled={busy || !usesImage}
            className="text-sm normal-case file:mr-3 file:rounded-full file:border file:border-foreground file:bg-transparent file:px-3 file:py-1.5 file:text-foreground"
          />
        </label>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="The image this run uses" className="max-h-64 w-full rounded-lg object-contain bg-foreground/5" />
        )}
        <label className={LABEL}>
          Text
          <textarea
            name="input_text"
            rows={4}
            maxLength={4000}
            disabled={busy}
            placeholder="Optional with an image. Becomes {{input}} for step 1."
            className={TEXTAREA}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {missingPrompt && (
          <p className="text-sm text-red-700">Every step needs a prompt before the chain can run.</p>
        )}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || missingPrompt} className="btn-primary flex-1 disabled:opacity-60">
            {busy ? "Running…" : "▶ Run chain"}
          </button>
          {busy && (
            <button type="button" onClick={() => (stopped.current = true)} className="btn-outline">
              Stop
            </button>
          )}
        </div>
      </form>

      <section className="flex min-w-0 flex-col gap-3" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title">Steps</h2>
          {runId && (
            <span className="text-xs opacity-75">
              Run #{runId} · <Link href={`/chains/${chainId}/media`} className="underline">all media</Link>
            </span>
          )}
        </div>
        <ol className="flex flex-col gap-3">
          {steps.map((step, i) => {
            const state = states[i];
            return (
              <li key={step.id} className="card flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-full bg-title/15 text-xs font-semibold text-title">
                    {i + 1}
                  </span>
                  <span className="font-medium">{step.name}</span>
                  <span className="text-xs opacity-75">
                    temp {step.temperature}
                    {step.includeImage ? " · with image" : ""}
                    {state?.status === "succeeded" ? ` · ${state.model}` : ""}
                  </span>
                  {state && state.status !== "waiting" && (
                    <span className="ml-auto">
                      <StatusPill status={state.status} />
                    </span>
                  )}
                </div>
                {state?.status === "running" && <p className="animate-pulse text-sm opacity-75">Asking Gemini…</p>}
                {state?.status === "failed" && <p className="text-sm text-red-700">{state.error}</p>}
                {state?.status === "succeeded" && (
                  <>
                    <Output text={state.output} list={state.list} />
                    <details className="text-xs">
                      <summary className="cursor-pointer opacity-75">Prompt sent</summary>
                      <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-foreground/5 p-3 whitespace-pre-wrap">{state.prompt}</pre>
                    </details>
                  </>
                )}
              </li>
            );
          })}
        </ol>
        {finalState?.status === "succeeded" && (
          <div className="card cascade-in flex flex-col gap-3 border-title">
            <h2 className="section-title text-title">Final output</h2>
            <div className="flex flex-col gap-4 sm:flex-row">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="max-h-48 rounded-lg object-contain sm:w-48" />
              )}
              <Output text={finalState.output} list={finalState.list} big />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Output({ text, list, big = false }: { text: string; list: string[] | null; big?: boolean }) {
  if (list) {
    return (
      <ol className={`flex list-decimal flex-col gap-1 pl-5 ${big ? "text-base" : "text-sm"}`}>
        {list.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    );
  }
  return <p className={`whitespace-pre-wrap ${big ? "text-base" : "text-sm"}`}>{text}</p>;
}
