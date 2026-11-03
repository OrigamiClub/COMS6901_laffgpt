import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutputFormat } from "@/lib/gemini";

// Reading prompt chains and building each step's prompt.

export type Chain = {
  id: number;
  slug: string;
  name: string;
  description: string;
  is_builtin: boolean;
  created_at: string;
  updated_at: string | null;
};

export type Step = {
  id: number;
  chain_id: number;
  step_order: number;
  name: string;
  description: string;
  calls_model: boolean;
  prompt: string | null;
  model_id: number | null;
  temperature: number;
  include_image: boolean;
  output_format: OutputFormat;
};

export type ModelOption = { id: number; name: string; api_model: string; purpose: string };

// An image model the Gemini key can use that isn't in llm_models yet.
export type DiscoveredModel = { api_model: string; name: string };

export const CHAIN_COLUMNS = "id, slug, name, description, is_builtin, created_at, updated_at";
export const STEP_COLUMNS =
  "id, chain_id, step_order, name, description, calls_model, prompt, model_id, temperature, include_image, output_format";

export const MAX_PROMPT = 4000;
export const MAX_INPUT_TEXT = 4000;

export async function loadChain(db: SupabaseClient, id: number) {
  const [chain, steps] = await Promise.all([
    db.from("prompt_chains").select(CHAIN_COLUMNS).eq("id", id).maybeSingle(),
    db
      .from("prompt_chain_steps")
      .select(STEP_COLUMNS)
      .eq("chain_id", id)
      .order("step_order"),
  ]);
  const error = chain.error ?? steps.error;
  if (error) throw new Error(`Couldn't load the chain: ${error.message}`);
  if (!chain.data) return null;
  return {
    chain: chain.data as Chain,
    steps: ((steps.data ?? []) as Step[]).map((s) => ({ ...s, temperature: Number(s.temperature) })),
  };
}

// Active Gemini models a step can use: text models once per API model
// (llm_models lists some twice, once per purpose), then image models.
export async function loadModelOptions(db: SupabaseClient): Promise<ModelOption[]> {
  const { data, error } = await db
    .from("llm_models")
    .select("id, name, api_model, purpose, priority, llm_providers!inner (slug)")
    .eq("llm_providers.slug", "gemini")
    .eq("is_active", true)
    .order("priority")
    .order("id");
  if (error) {
    console.error("Couldn't load models", error);
    return [];
  }
  const seen = new Set<string>();
  const options = data
    .filter((m) => {
      const key = `${m.purpose === "image" ? "image" : "text"}:${m.api_model}`;
      return !seen.has(key) && seen.add(key);
    })
    .map((m) => ({ id: m.id, name: m.name, api_model: m.api_model, purpose: m.purpose }));
  return [...options.filter((m) => m.purpose !== "image"), ...options.filter((m) => m.purpose === "image")];
}

// Image-output models the Gemini key can call, from Google's model list
// (names with "image" that support generateContent; Imagen uses a
// different API). Cached for an hour. Empty if the list can't be read.
export async function discoverImageModels(known: ModelOption[]): Promise<DiscoveredModel[]> {
  const apiKey = process.env.GEMINI_API_KEY?.trim().replace(/^["']|["']$/g, "");
  if (!apiKey) return [];
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
      {
        headers: { "x-goog-api-key": apiKey },
        next: { revalidate: 3600 },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) {
      console.error("Couldn't list Gemini models", response.status, await response.text());
      return [];
    }
    const { models = [] } = (await response.json()) as {
      models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
    };
    const registered = new Set(known.filter((m) => m.purpose === "image").map((m) => m.api_model));
    return models
      .map((m) => ({
        api_model: m.name.replace(/^models\//, ""),
        name: m.displayName ?? m.name,
        methods: m.supportedGenerationMethods ?? [],
      }))
      .filter(
        (m) =>
          m.api_model.includes("image") &&
          !m.api_model.startsWith("imagen") &&
          m.methods.includes("generateContent") &&
          !registered.has(m.api_model)
      )
      .map(({ api_model, name }) => ({ api_model, name }));
  } catch (error) {
    console.error("Couldn't list Gemini models", error);
    return [];
  }
}

// A step's prompt with its placeholders filled in. {{input}} is what the
// previous step said (or the run's text, for step 1); when the prompt
// doesn't use it, the input is added at the end so it isn't lost.
export function fillPrompt(template: string, input: string, originalText: string) {
  const usesInput = template.includes("{{input}}");
  let prompt = template
    .replaceAll("{{input}}", input)
    .replaceAll("{{original_text}}", originalText);
  if (!usesInput && input.trim()) {
    prompt += `\n\nInput:\n${input}`;
  }
  return prompt;
}

// How a logged reply reads as the next step's input: lists become one
// bullet per line.
export function replyAsText(responseText: string | null, format: OutputFormat) {
  if (!responseText) return "";
  if (format === "list") {
    try {
      const list = JSON.parse(responseText);
      if (Array.isArray(list)) return list.map((item) => `- ${item}`).join("\n");
    } catch {
      // Fall through to the raw text.
    }
  }
  return responseText;
}

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "chain"
  );
}
