import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storeGeneratedImage } from "@/lib/images";

// Runs one step of a prompt chain on Gemini, with the step's own model and
// temperature. If that model is overloaded (429/503) it's tried once more,
// then the other active models of the same kind from llm_models take over
// (caption models for text and lists, image models for images), so a busy
// spell doesn't fail the whole chain. Image steps ask for an image back,
// which is saved to storage. Every attempt is logged to
// llm_responses against the step, which is where the media page reads
// each step's output from.

export type Part =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

export type OutputFormat = "text" | "list" | "image";

export type StepResult =
  | { text: string; list: string[] | null; image: string | null; apiModel: string }
  | { error: string };

// Each attempt gets this long, and the step as a whole this long, so one
// step stays well inside a Vercel function's time limit.
// Image models are slower, so they get longer per attempt.
const ATTEMPT_TIMEOUT_MS = 20 * 1000;
const IMAGE_ATTEMPT_TIMEOUT_MS = 40 * 1000;
const STEP_DEADLINE_MS = 50 * 1000;
const RETRY_DELAY_MS = 1500;
const MAX_LOGGED_TEXT = 20_000;

const LIST_SCHEMA = { type: "ARRAY", items: { type: "STRING" } };

type Model = { name: string; id: number | null };

type InlineData = { data: string; mimeType?: string; mime_type?: string };
type ReplyPart = {
  text?: string;
  thought?: boolean;
  inlineData?: InlineData;
  inline_data?: InlineData;
};

// The step's model first, tried twice, then the other active models for
// the same purpose in priority order.
async function modelsToTry(
  db: SupabaseClient,
  first: Model | null,
  purpose: "caption" | "image"
): Promise<Model[]> {
  const { data, error } = await db
    .from("llm_models")
    .select("id, api_model, llm_providers!inner (slug)")
    .eq("llm_providers.slug", "gemini")
    .eq("purpose", purpose)
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
// valid. Please pass a valid API key." Quota errors are summarised from
// their details (which quota, its limit, when to retry), since Google's
// message buries them after a long preamble.
function geminiMessage(body: string) {
  try {
    const error = JSON.parse(body)?.error;
    const details: { "@type"?: string; violations?: QuotaViolation[]; retryDelay?: string }[] =
      error?.details ?? [];
    const violations = details.flatMap((d) => d.violations ?? []);
    if (violations.length > 0) {
      const retry = details.find((d) => d.retryDelay)?.retryDelay;
      const zero = violations.some((v) => v.quotaValue === "0");
      const which = violations
        .map((v) => `${v.quotaId ?? v.quotaMetric ?? "unknown quota"} (limit ${v.quotaValue ?? "?"})`)
        .join("; ");
      return (
        (zero
          ? "This key's plan has no allowance for this model (limit 0), so it needs billing on the key's Google Cloud project. "
          : "Quota exceeded. ") +
        `Quota: ${which}${retry ? `. Retry in ${retry}` : ""}.`
      ).slice(0, 500);
    }
    const message = error?.message;
    if (typeof message === "string" && message) return message.slice(0, 300);
  } catch {
    // Not JSON; fall through.
  }
  return body.slice(0, 300) || "no details";
}

type QuotaViolation = { quotaMetric?: string; quotaId?: string; quotaValue?: string };

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

  const wantsImage = outputFormat === "image";
  const models = await modelsToTry(db, model, wantsImage ? "image" : "caption");
  if (models.length === 0) {
    return {
      error: wantsImage
        ? "Pick an image model for this step first."
        : "No Gemini models are switched on.",
    };
  }

  const body = JSON.stringify({
    contents: [{ parts }],
    generationConfig: {
      temperature,
      ...(outputFormat === "list"
        ? { responseMimeType: "application/json", responseSchema: LIST_SCHEMA }
        : {}),
      ...(wantsImage ? { responseModalities: ["TEXT", "IMAGE"] } : {}),
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
  let lastMessage = "";

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
      image_url?: string | null;
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
          signal: AbortSignal.timeout(wantsImage ? IMAGE_ATTEMPT_TIMEOUT_MS : ATTEMPT_TIMEOUT_MS),
        }
      );
    } catch (error) {
      console.error(`Gemini ${m.name} request failed`, error);
      lastMessage = `${m.name}: no answer in time (${String(error).slice(0, 100)})`;
      await log({ http_status: null, ok: false, error: String(error) });
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      lastStatus = response.status;
      lastMessage = `${m.name}: ${geminiMessage(text)}`;
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
    const candidate = result.candidates?.[0];
    const replyParts: ReplyPart[] = candidate?.content?.parts ?? [];
    const reply = replyParts
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (wantsImage) {
      const imagePart = replyParts
        .map((part) => part.inlineData ?? part.inline_data)
        .find((data) => data?.data);
      if (!imagePart) {
        const why = candidate?.finishReason ?? result.promptFeedback?.blockReason ?? "no image in the reply";
        lastMessage = `${m.name}: ${why}${reply ? ` — "${reply.slice(0, 150)}"` : ""}`;
        await log({ http_status: response.status, ok: false, response_text: reply, error: `No image (${why})` });
        continue;
      }
      const stored = await storeGeneratedImage(
        db,
        imagePart.data,
        imagePart.mimeType ?? imagePart.mime_type ?? "image/png"
      );
      if ("error" in stored) {
        await log({ http_status: response.status, ok: false, response_text: reply, error: stored.error });
        return { error: stored.error };
      }
      await log({ http_status: response.status, ok: true, response_text: reply || null, image_url: stored.url });
      return { text: reply, list: null, image: stored.url, apiModel: m.name };
    }

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
    return { text: list ? list.join("\n") : reply, list, image: null, apiModel: m.name };
  }

  if (lastStatus === 429 || lastStatus === 503) {
    const kind = lastStatus === 429 ? "rate or quota limit" : "overloaded";
    return { error: `Every model hit a limit (${kind}). Last reply — ${lastMessage}` };
  }
  return {
    error: `Gemini couldn't answer this step${lastMessage ? ` (${lastMessage})` : ""}. Try again.`,
  };
}
