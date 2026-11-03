"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { field, finish, idField } from "@/lib/finish";
import { MAX_PROMPT, slugify } from "@/lib/chains";

// Create / update / delete for chains and their steps. Each action checks
// for a superadmin itself, and RLS checks again (built-in chains can't be
// changed at all).

const chainPath = (id: number) => `/chains/${id}`;

function chainIdField(formData: FormData) {
  const id = Number(formData.get("chain_id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Refuses changes to the board's built-in chains before touching anything,
// so the admin gets a clear message instead of a silent RLS no-op.
async function requireEditableChain(
  supabase: Supabase,
  chainId: number
) {
  const { data } = await supabase
    .from("prompt_chains")
    .select("is_builtin")
    .eq("id", chainId)
    .maybeSingle();
  if (!data) redirect("/?notice=invalid");
  if (data.is_builtin) redirect(`${chainPath(chainId)}?notice=built-in`);
}

function chainFields(formData: FormData) {
  const name = field(formData, "name", 80);
  const slug = slugify(field(formData, "slug", 50));
  const description = field(formData, "description", 500);
  return { name, slug: field(formData, "slug") ? slug : "", description };
}

type Supabase = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

// The step's model as an llm_models id. "api:<name>" is an image model the
// Gemini key offers that isn't registered yet; it's added with purpose
// 'image' first. Image steps need an image model and text steps a text
// model; null when the choice doesn't fit (or "" = the default).
async function resolveModel(
  supabase: Supabase,
  raw: string,
  outputFormat: "text" | "list" | "image"
): Promise<{ id: number | null } | null> {
  const wantsImage = outputFormat === "image";
  if (!raw) return { id: null };

  if (raw.startsWith("api:")) {
    const apiModel = raw.slice(4);
    if (!wantsImage || !/^[\w.-]{1,100}$/.test(apiModel)) return null;
    const { data: provider } = await supabase
      .from("llm_providers")
      .select("id")
      .eq("slug", "gemini")
      .maybeSingle();
    if (!provider) return null;
    const { data: existing } = await supabase
      .from("llm_models")
      .select("id")
      .eq("provider_id", provider.id)
      .eq("api_model", apiModel)
      .eq("purpose", "image")
      .maybeSingle();
    if (existing) return { id: existing.id };
    const { data: added, error } = await supabase
      .from("llm_models")
      .insert({ provider_id: provider.id, name: apiModel, api_model: apiModel, purpose: "image", priority: 100 })
      .select("id")
      .single();
    if (error) console.error("Couldn't register image model", error);
    return added ? { id: added.id } : null;
  }

  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { data: model } = await supabase.from("llm_models").select("purpose").eq("id", id).maybeSingle();
  if (!model || (model.purpose === "image") !== wantsImage) return null;
  return { id };
}

async function stepFields(supabase: Supabase, formData: FormData) {
  const name = field(formData, "name", 80);
  const prompt = formData.get("prompt")?.toString().trim() ?? "";
  const temperature = Number(formData.get("temperature"));
  const format = formData.get("output_format");
  const outputFormat = format === "list" || format === "image" ? format : "text";

  if (
    !name ||
    !prompt ||
    prompt.length > MAX_PROMPT ||
    !Number.isFinite(temperature) ||
    temperature < 0 ||
    temperature > 2
  ) {
    return null;
  }
  const model = await resolveModel(supabase, formData.get("model_id")?.toString() ?? "", outputFormat);
  if (!model) return "bad-model" as const;
  return {
    name,
    prompt,
    description: field(formData, "description", 300),
    temperature: Math.round(temperature * 100) / 100,
    model_id: model.id,
    include_image: formData.get("include_image") === "on",
    output_format: outputFormat,
  };
}

// --- Chains

export async function createChain(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const { name, slug, description } = chainFields(formData);
  if (!name) redirect("/?notice=invalid");

  // A slug made from the name gets a short suffix if it's already taken.
  const base = slug || slugify(name);
  let result = await supabase
    .from("prompt_chains")
    .insert({ name, slug: base, description, created_by: user.id })
    .select("id")
    .single();
  if (result.error?.code === "23505" && !slug) {
    result = await supabase
      .from("prompt_chains")
      .insert({
        name,
        slug: `${base}-${crypto.randomUUID().slice(0, 6)}`,
        description,
        created_by: user.id,
      })
      .select("id")
      .single();
  }
  if (result.error || !result.data) finish("/", result.error, "chain-created");
  finish(chainPath(result.data.id), null, "chain-created");
}

export async function updateChain(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = idField(formData);
  const { name, slug, description } = chainFields(formData);
  if (!id || !name || !slug) redirect(id ? `${chainPath(id)}?notice=invalid` : "/");
  await requireEditableChain(supabase, id);

  const { error } = await supabase
    .from("prompt_chains")
    .update({ name, slug, description, updated_at: new Date().toISOString() })
    .eq("id", id);
  finish(chainPath(id), error, "chain-saved");
}

export async function deleteChain(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = idField(formData);
  if (!id) redirect("/?notice=invalid");
  await requireEditableChain(supabase, id);

  const { error } = await supabase.from("prompt_chains").delete().eq("id", id);
  finish("/", error, "chain-deleted");
}

// --- Steps

export async function createStep(formData: FormData) {
  const { supabase } = await requireAdmin();
  const chainId = chainIdField(formData);
  if (!chainId) redirect("/?notice=invalid");
  const step = await stepFields(supabase, formData);
  if (!step || step === "bad-model") {
    redirect(`${chainPath(chainId)}?notice=${step || "invalid"}#new-step`);
  }
  await requireEditableChain(supabase, chainId);

  const { data: last } = await supabase
    .from("prompt_chain_steps")
    .select("step_order")
    .eq("chain_id", chainId)
    .order("step_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("prompt_chain_steps").insert({
    ...step,
    chain_id: chainId,
    step_order: (last?.step_order ?? 0) + 1,
    calls_model: true,
  });
  finish(chainPath(chainId), error, "step-added");
}

export async function updateStep(formData: FormData) {
  const { supabase } = await requireAdmin();
  const chainId = chainIdField(formData);
  const id = idField(formData);
  if (!chainId || !id) redirect("/?notice=invalid");
  const step = await stepFields(supabase, formData);
  if (!step || step === "bad-model") {
    redirect(`${chainPath(chainId)}?notice=${step || "invalid"}#step-${id}`);
  }
  await requireEditableChain(supabase, chainId);

  const { error } = await supabase
    .from("prompt_chain_steps")
    .update(step)
    .eq("id", id)
    .eq("chain_id", chainId);
  finish(chainPath(chainId), error, "step-saved");
}

export async function deleteStep(formData: FormData) {
  const { supabase } = await requireAdmin();
  const chainId = chainIdField(formData);
  const id = idField(formData);
  if (!chainId || !id) redirect("/?notice=invalid");
  await requireEditableChain(supabase, chainId);

  const { error } = await supabase.rpc("delete_prompt_chain_step", { p_step_id: id });
  finish(chainPath(chainId), error, "step-deleted");
}

// Moves a step to a new 1-based position. The ↑/↓ buttons send `to`; the
// "Move to" picker sends `position`.
export async function moveStep(formData: FormData) {
  const { supabase } = await requireAdmin();
  const chainId = chainIdField(formData);
  const id = idField(formData);
  const to = Number(formData.get("to") ?? formData.get("position"));
  if (!chainId || !id || !Number.isInteger(to)) redirect("/?notice=invalid");
  await requireEditableChain(supabase, chainId);

  const { data: steps, error: loadError } = await supabase
    .from("prompt_chain_steps")
    .select("id")
    .eq("chain_id", chainId)
    .order("step_order");
  if (loadError || !steps) finish(chainPath(chainId), loadError, "step-moved");

  const ids = steps.map((s) => s.id as number);
  const from = ids.indexOf(id);
  if (from === -1) redirect(`${chainPath(chainId)}?notice=invalid`);
  const target = Math.min(Math.max(to, 1), ids.length) - 1;
  if (target === from) redirect(`${chainPath(chainId)}#step-${id}`);

  ids.splice(from, 1);
  ids.splice(target, 0, id);
  const { error } = await supabase.rpc("reorder_prompt_chain_steps", {
    p_chain_id: chainId,
    p_step_ids: ids,
  });
  finish(chainPath(chainId), error, "step-moved");
}
