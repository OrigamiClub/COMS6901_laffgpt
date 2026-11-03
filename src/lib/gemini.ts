import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Runs one step of a prompt chain on Gemini, with the step's own model and
// temperature. If that model is overloaded (429/503) it's tried once more,
// then the other active caption models from llm_models take over, so a
// busy spell doesn't fail the whole chain. Every attempt is logged to
// llm_responses against the step, which is where the media page reads
// each step's output from.

export type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type OutputFormat = "text" | "list";

export type StepResult =
  | { text: string; list: string[] | null; apiModel: string }
  | { error: string };

// Each attempt gets this long, and the step as a whole this long, so one
// step stays well inside a Vercel function's time limit.
const ATTEMPT_TIMEOUT_MS = 20 * 1000;
const STEP_DEADLINE_MS = 50 * 1000;
const RETRY_DELAY_MS = 1500;
const MAX_LOGGED_TEXT = 20_000;

const LIST_SCHEMA = { type: "ARRAY", items: { type: "STRING" } };

type Model = { name: string; id: number | null };

// The step's model first, tried twice, then the other active caption
// models in priority order.
async function modelsToTry(db: SupabaseClient, first: Model | null): Promise<Model[]> {
  const { data, error } = await db
    .from("llm_models")
    .select("id, api_model, llm_providers!inner (slug)")
    .eq("llm_providers.slug", "gemini")
    .eq("purpose", "caption")
    .eq("is_active", true)
    .order("priority")
    .order("id");
  if (error) console.error("Couldn't load fallback models", error);

  const fallbacks = (data ?? [])
    .map((m) => ({ name: m.api_model as string, id: m.id as number }))
    .filter((m) => m.name !== first?.name);
  const preferred = first ?? fallbacks.shift() ?? null;
  if (!preferred) return [];
  return [preferred, preferred, ...fallbacks];
}

// The human-readable part of a Gemini error reply, e.g. "API key not
// valid. Please pass a valid API key."
function geminiMessage(body: string) {
  try {
    const message = JSON.parse(body)?.error?.message;
    if (typeof message === "string" && message) return message.slice(0, 300);
  } catch {
    // Not JSON; fall through.
  }
  return body.slice(0, 300) || "no details";
}

export async function runGeminiStep({
  db,
  generationId,
  stepId,
  model,
  parts,
  temperature,
  outputFormat,
}: {
  db: SupabaseClient;
  generationId: number;
  stepId: number;
  model: Model | null;
  parts: Part[];
  temperature: number;
  outputFormat: OutputFormat;
}): Promise<StepResult> {
  // Trimmed, and stripped of quotes, in case they were pasted in with the
  // key on Vercel.
  const apiKey = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return { error: "Gemini isn't configured (GEMINI_API_KEY)." };

  const models = await modelsToTry(db, model);
  if (models.length === 0) return { error: "No Gemini models are switched on." };

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature,
      ...(outputFormat === "list"
        ? { responseMimeType: "application/json", responseSchema: LIST_SCHEMA }
        : {}),
    },
  });

  // Attempt numbers continue across steps of the same run, so the admin
  // area's Generations page lists them in order.
  const { count } = await db
    .from("llm_responses")
    .select("id", { count: "exact", head: true })
    .eq("generation_request_id", generationId);
  let attempt = count ?? 0;

  const deadline = Date.now() + STEP_DEADLINE_MS;
  const skip = new Set<string>();
  let lastStatus: number | null = null;

  for (const [i, m] of models.entries()) {
    if (skip.has(m.name)) continue;
    if (Date.now() > deadline) break;
    if (i === 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    attempt += 1;

    const started = Date.now();
    const log = (row: {
      http_status: number | null;
      ok: boolean;
      response_text?: string | null;
      error?: string | null;
    }) =>
      db
        .from("llm_responses")
        .insert({
          generation_request_id: generationId,
          step_id: stepId,
          model_id: m.id,
          api_model: m.name,
          attempt,
          latency_ms: Date.now() - started,
          ...row,
          response_text: row.response_text?.slice(0, MAX_LOGGED_TEXT) ?? null,
          error: row.error?.slice(0, 2000) ?? null,
        })
        .then(({ error }) => {
          if (error) console.error("Couldn't log LLM response", error);
        });

    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m.name}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body,
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        }
      );
    } catch (error) {
      console.error(`Gemini ${m.name} request failed`, error);
      await log({ http_status: null, ok: false, error: String(error) });
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      lastStatus = response.status;
      console.error(`Gemini ${m.name} error`, response.status, text);
      await log({ http_status: response.status, ok: false, error: text });
      const dailyQuota = text.includes("RESOURCE_EXHAUSTED") && text.includes("PerDay");
      if (response.status === 404 || dailyQuota) {
        skip.add(m.name);
      } else if (response.status !== 429 && response.status !== 503) {
        return { error: `Gemini refused the request (HTTP ${response.status}): ${geminiMessage(text)}` };
      }
      continue;
    }

    const result = await response.json();
    const reply: string =
      result.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? "")
        .join("")
        .trim() ?? "";

    let list: string[] | null = null;
    if (outputFormat === "list") {
      try {
        const parsed = JSON.parse(reply);
        if (!Array.isArray(parsed)) throw new Error("not a list");
        list = parsed.map((item) => String(item).trim()).filter(Boolean);
      } catch {
        await log({ http_status: response.status, ok: false, response_text: reply, error: "Reply wasn't a JSON list" });
        continue;
      }
    }
    if (!reply || (list && list.length === 0)) {
      await log({ http_status: response.status, ok: false, response_text: reply, error: "Empty reply" });
      continue;
    }

    await log({ http_status: response.status, ok: true, response_text: reply });
    return { text: list ? list.join("\n") : reply, list, apiModel: m.name };
  }

  if (lastStatus === 429 || lastStatus === 503) {
    return { error: "Gemini is swamped right now. Try again in a minute." };
  }
  return { error: "Gemini couldn't answer this step. Try again." };
}
