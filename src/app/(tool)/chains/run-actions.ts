"use server";

import { requireAdmin } from "@/lib/admin";
import { fillPrompt, loadChain, MAX_INPUT_TEXT, replyAsText } from "@/lib/chains";
import { runGeminiStep, type Part } from "@/lib/gemini";
import { checkImage, fetchOwnCrackImage, OWN_CRACK_IMAGE_PREFIX } from "@/lib/images";

// Running a chain. The run form calls startRun once, then runStep for each
// step in order, so every request stays short and the page can show each
// step's output as it arrives. The steps are read from the database each
// time, and each step's input is the previous step's logged reply, so the
// browser can't feed a step anything else.

const BUCKET = "cracks";
const FOLDER = "prompt-chains";

export type StartResult =
  | { runId: number; steps: { id: number; name: string }[] }
  | { error: string };

export type StepRunResult =
  | {
      output: string;
      list: string[] | null;
      image: string | null;
      model: string;
      prompt: string;
      done: boolean;
    }
  | { error: string };

// Validates the input (an image, text, or both), stores the image in the
// crack bucket and logs the run as running.
export async function startRun(formData: FormData): Promise<StartResult> {
  const { supabase, user } = await requireAdmin();

  const chainId = Number(formData.get("chain_id"));
  if (!Number.isInteger(chainId) || chainId <= 0) return { error: "Unknown chain." };

  const loaded = await loadChain(supabase, chainId);
  if (!loaded) return { error: "That chain doesn't exist any more." };
  const steps = loaded.steps.filter((s) => s.prompt?.trim());
  if (loaded.chain.is_builtin) {
    return { error: "Built-in chains run inside the meme board, not here." };
  }
  if (steps.length === 0 || steps.length !== loaded.steps.length) {
    return { error: "Every step needs a prompt before the chain can run." };
  }

  const text = formData.get("input_text")?.toString().trim() ?? "";
  if (text.length > MAX_INPUT_TEXT) {
    return { error: `Keep the text under ${MAX_INPUT_TEXT} characters.` };
  }

  let imageUrl: string | null = null;
  const photo = formData.get("image") as File | null;
  const existing = formData.get("image_url")?.toString() ?? "";
  const givenImage = Boolean((photo && photo.size > 0) || existing);
  if (!text && !givenImage) return { error: "Give the chain an image, some text, or both." };
  if (givenImage && !steps.some((s) => s.include_image)) {
    return { error: "No step sends the image to Gemini. Tick “Send the image” on a step first." };
  }

  if (photo && photo.size > 0) {
    const checked = await checkImage(photo);
    if ("error" in checked) return checked;
    const path = `${FOLDER}/${crypto.randomUUID()}.${checked.extension}`;
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, photo, { contentType: checked.type });
    if (error) {
      console.error("Couldn't upload the run's image", error);
      return { error: "Couldn't upload the image. Try a different one." };
    }
    imageUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } else if (existing) {
    // Re-running on an image from an earlier run.
    if (!existing.startsWith(OWN_CRACK_IMAGE_PREFIX)) return { error: "Unknown image." };
    imageUrl = existing;
  }


  const { data, error } = await supabase
    .from("generation_requests")
    .insert({
      chain_id: chainId,
      source: "prompt-chain-tool",
      user_id: user.id,
      prompt: text || null,
      input_text: text || null,
      image_url: imageUrl,
      has_image: Boolean(imageUrl),
      created_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("Couldn't start the run", error);
    return { error: "Couldn't start the run. Is the prompt chain tool migration applied?" };
  }

  return { runId: data.id, steps: steps.map((s) => ({ id: s.id, name: s.name })) };
}

async function fail(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  runId: number,
  error: string
) {
  await supabase
    .from("generation_requests")
    .update({ status: "failed", error, finished_at: new Date().toISOString() })
    .eq("id", runId);
  return { error };
}

// Runs step `index` (0-based) of a run that's still going.
export async function runStep(runId: number, index: number): Promise<StepRunResult> {
  const { supabase } = await requireAdmin();
  if (!Number.isInteger(runId) || !Number.isInteger(index) || index < 0) {
    return { error: "Bad request." };
  }

  const { data: run } = await supabase
    .from("generation_requests")
    .select("id, chain_id, status, input_text, image_url")
    .eq("id", runId)
    .eq("source", "prompt-chain-tool")
    .maybeSingle();
  if (!run?.chain_id) return { error: "That run doesn't exist." };
  if (run.status !== "running") return { error: "That run has already finished." };

  const loaded = await loadChain(supabase, run.chain_id);
  const steps = loaded?.steps ?? [];
  const step = steps[index];
  if (!step?.prompt) return fail(supabase, runId, "The chain changed while it was running.");

  // What the earlier steps produced: {{input}} is the newest text (an image
  // step that only returns a picture passes the text before it along), and
  // the image sent is the newest generated one, else the run's upload.
  const originalText = run.input_text ?? "";
  let input = originalText;
  let imageUrl: string | null = run.image_url;
  if (index > 0) {
    const earlier = steps.slice(0, index);
    const { data: replies } = await supabase
      .from("llm_responses")
      .select("step_id, response_text, image_url")
      .eq("generation_request_id", runId)
      .in("step_id", earlier.map((s) => s.id))
      .eq("ok", true)
      .order("id");
    const byStep = new Map((replies ?? []).map((r) => [r.step_id as number, r]));
    if (!byStep.has(earlier[index - 1].id)) {
      return fail(supabase, runId, `Step ${index} hasn't produced anything yet.`);
    }
    for (const s of earlier) {
      const reply = byStep.get(s.id);
      if (!reply) continue;
      const text = replyAsText(reply.response_text, s.output_format);
      if (text.trim()) input = text;
      if (reply.image_url) imageUrl = reply.image_url;
    }
  }

  const prompt = fillPrompt(step.prompt, input, originalText);
  const parts: Part[] = [];
  if (step.include_image && imageUrl) {
    const image = await fetchOwnCrackImage(imageUrl);
    if ("error" in image) return fail(supabase, runId, image.error);
    parts.push({ inline_data: { mime_type: image.type, data: image.data } });
  }
  parts.push({ text: prompt });

  const { data: model } = step.model_id
    ? await supabase.from("llm_models").select("id, api_model").eq("id", step.model_id).maybeSingle()
    : { data: null };

  const result = await runGeminiStep({
    db: supabase,
    generationId: runId,
    stepId: step.id,
    model: model ? { id: model.id, name: model.api_model } : null,
    parts,
    temperature: step.temperature,
    outputFormat: step.output_format,
  });
  if ("error" in result) return fail(supabase, runId, `Step ${index + 1} (${step.name}): ${result.error}`);

  const done = index === steps.length - 1;
  if (done) {
    const { error } = await supabase
      .from("generation_requests")
      .update({
        status: "succeeded",
        output: result.text,
        output_json: result.list,
        // The newest image a step generated, if any did.
        output_image_url: result.image ?? (imageUrl !== run.image_url ? imageUrl : null),
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);
    if (error) console.error("Couldn't finish the run", error);
  }

  return {
    output: result.text,
    list: result.list,
    image: result.image,
    model: result.apiModel,
    prompt,
    done,
  };
}

// The run form calls this if the admin stops a run or leaves mid-way.
export async function abandonRun(runId: number) {
  const { supabase } = await requireAdmin();
  if (!Number.isInteger(runId)) return;
  await supabase
    .from("generation_requests")
    .update({ status: "failed", error: "Stopped before the last step.", finished_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "running");
}
