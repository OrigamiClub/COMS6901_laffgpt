import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import {
  discoverImageModels,
  loadChain,
  loadModelOptions,
  MAX_PROMPT,
  type DiscoveredModel,
  type ModelOption,
  type Step,
} from "@/lib/chains";
import ConfirmButton from "@/components/confirm-button";
import Notice from "@/components/notice";
import TemperatureField from "@/components/temperature-field";
import { INPUT, LABEL, TEXTAREA } from "@/components/field-styles";
import {
  createStep,
  deleteChain,
  deleteStep,
  moveStep,
  updateChain,
  updateStep,
} from "../actions";

// A chain's details and its steps, in order: edit, reorder, add, delete.
// The meme board's built-in chains are shown read-only.
export default async function ChainPage({ params, searchParams }: PageProps<"/chains/[id]">) {
  const { supabase } = await requireAdmin();
  const id = Number((await params).id);
  const { notice } = await searchParams;

  const [loaded, models] = await Promise.all([loadChain(supabase, id), loadModelOptions(supabase)]);
  if (!loaded) notFound();
  const { chain, steps } = loaded;
  const discovered = chain.is_builtin ? [] : await discoverImageModels(models);

  if (chain.is_builtin) {
    return (
      <>
        <Notice value={notice?.toString()} />
        <p className="text-sm">{chain.description}</p>
        <p className="text-sm opacity-75">
          This chain is hard-coded in the meme board; these steps describe what the code does. To
          change it, edit the board&apos;s code. Its runs are under Media.
        </p>
        <ol className="flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.id} className="card flex gap-4">
              <StepNumber n={step.step_order} />
              <div className="flex flex-col gap-1">
                <h2 className="font-semibold">
                  {step.name}
                  {step.calls_model && (
                    <span className="ml-2 rounded-full bg-sage/15 px-2 py-0.5 text-xs font-normal text-sage">
                      calls Gemini
                    </span>
                  )}
                </h2>
                <p className="text-sm opacity-90">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </>
    );
  }

  return (
    <>
      <Notice value={notice?.toString()} />

      <details className="card group">
        <summary className="section-title cursor-pointer list-none">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          Chain details
          {chain.description && (
            <span className="ml-2 font-normal opacity-75">— {chain.description}</span>
          )}
        </summary>
        <form action={updateChain} className="mt-4 grid gap-4 sm:grid-cols-2">
          <input type="hidden" name="id" value={chain.id} />
          <label className={LABEL}>
            Name
            <input name="name" required maxLength={80} defaultValue={chain.name} className={INPUT} />
          </label>
          <label className={LABEL}>
            Slug
            <input
              name="slug"
              required
              maxLength={50}
              pattern="[a-z0-9\-]+"
              defaultValue={chain.slug}
              className={`${INPUT} font-mono`}
            />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            Description
            <textarea
              name="description"
              maxLength={500}
              rows={2}
              defaultValue={chain.description}
              className={TEXTAREA}
            />
          </label>
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary">
              Save chain
            </button>
            <ConfirmButton
              formAction={deleteChain}
              question={`Delete “${chain.name}” and all ${steps.length} of its steps? Past runs stay in the log.`}
            >
              Delete chain
            </ConfirmButton>
          </div>
        </form>
      </details>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="section-title">
            Steps <span className="font-normal opacity-75">· run top to bottom</span>
          </h2>
          <p className="text-xs opacity-75">
            <code>{"{{input}}"}</code> = previous step&apos;s output (the run&apos;s text for step 1) ·{" "}
            <code>{"{{original_text}}"}</code> = the run&apos;s text
          </p>
        </div>

        {steps.length === 0 && (
          <p className="card text-sm opacity-75">
            No steps yet. Add one below — for example, “Describe this image” with the image sent.
          </p>
        )}

        <ol className="flex flex-col gap-3">
          {steps.map((step) => (
            <li key={step.id} id={`step-${step.id}`} className="card flex scroll-mt-24 gap-4">
              <StepNumber n={step.step_order} />
              <form action={updateStep} className="flex min-w-0 flex-1 flex-col gap-4">
                <input type="hidden" name="id" value={step.id} />
                <input type="hidden" name="chain_id" value={chain.id} />
                <StepFields step={step} models={models} discovered={discovered} />
                <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-4 dark:border-white/15">
                  <button type="submit" className="btn-primary">
                    Save step
                  </button>
                  <button
                    type="submit"
                    formAction={moveStep}
                    formNoValidate
                    name="to"
                    value={step.step_order - 1}
                    disabled={step.step_order === 1}
                    aria-label={`Move step ${step.step_order} up`}
                    className="btn-outline w-10 px-0 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="submit"
                    formAction={moveStep}
                    formNoValidate
                    name="to"
                    value={step.step_order + 1}
                    disabled={step.step_order === steps.length}
                    aria-label={`Move step ${step.step_order} down`}
                    className="btn-outline w-10 px-0 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  {steps.length > 2 && (
                    <span className="flex items-center gap-2 text-sm">
                      <select
                        name="position"
                        defaultValue={step.step_order}
                        aria-label="New position"
                        className={`${INPUT} pr-8`}
                      >
                        {steps.map((s) => (
                          <option key={s.id} value={s.step_order}>
                            Position {s.step_order}
                          </option>
                        ))}
                      </select>
                      <button type="submit" formAction={moveStep} formNoValidate className="btn-outline">
                        Move
                      </button>
                    </span>
                  )}
                  <span className="ml-auto">
                    <ConfirmButton formAction={deleteStep} question={`Delete step ${step.step_order}, “${step.name}”?`}>
                      Delete
                    </ConfirmButton>
                  </span>
                </div>
              </form>
            </li>
          ))}
        </ol>
      </section>

      <section id="new-step" className="card flex scroll-mt-24 flex-col gap-4 border-dashed">
        <h2 className="section-title">Add step {steps.length + 1}</h2>
        <form action={createStep} className="flex flex-col gap-4">
          <input type="hidden" name="chain_id" value={chain.id} />
          <StepFields models={models} discovered={discovered} first={steps.length === 0} />
          <div>
            <button type="submit" className="btn-primary">
              + Add step
            </button>
          </div>
        </form>
      </section>
    </>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-title/15 text-sm font-semibold text-title">
      {n}
    </span>
  );
}

// The fields of one step, for the edit forms and the Add form.
function StepFields({
  step,
  models,
  discovered,
  first = false,
}: {
  step?: Step;
  models: ModelOption[];
  discovered: DiscoveredModel[];
  first?: boolean;
}) {
  const textModels = models.filter((m) => m.purpose !== "image");
  const imageModels = models.filter((m) => m.purpose === "image");
  return (
    <>
      <label className={LABEL}>
        Name
        <input
          name="name"
          required
          maxLength={80}
          defaultValue={step?.name}
          placeholder={first ? "Describe the image" : "Make it funny"}
          className={INPUT}
        />
      </label>
      <label className={LABEL}>
        Prompt
        <textarea
          name="prompt"
          required
          maxLength={MAX_PROMPT}
          rows={4}
          defaultValue={step?.prompt ?? ""}
          placeholder={
            first
              ? "Describe this image in detail: who or what is in it, what's happening, the mood."
              : "Here is a description of an image:\n{{input}}\n\nWrite five short, funny captions for it."
          }
          className={`${TEXTAREA} font-mono`}
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={LABEL}>
          Model
          <select name="model_id" defaultValue={step?.model_id ?? ""} className={INPUT}>
            <option value="">Default (first active model for the output)</option>
            <optgroup label="Text models (text and list output)">
              {textModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.api_model})
                </option>
              ))}
            </optgroup>
            {(imageModels.length > 0 || discovered.length > 0) && (
              <optgroup label="Image models (image output)">
                {imageModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.name === m.api_model ? "" : ` (${m.api_model})`}
                  </option>
                ))}
                {discovered.map((m) => (
                  <option key={m.api_model} value={`api:${m.api_model}`}>
                    {m.name} ({m.api_model})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <TemperatureField key={`${step?.id}-${step?.temperature}`} defaultValue={step?.temperature ?? 1} />
        <label className={LABEL}>
          Output
          <select name="output_format" defaultValue={step?.output_format ?? "text"} className={INPUT}>
            <option value="text">Text</option>
            <option value="list">List (one item per caption)</option>
            <option value="image">Image (generate a picture)</option>
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            name="include_image"
            defaultChecked={step?.include_image ?? first}
            className="size-4 accent-[var(--title)]"
          />
          Send the image with this step (the newest generated one, else the upload)
        </label>
      </div>
      <label className={LABEL}>
        Notes (optional)
        <input name="description" maxLength={300} defaultValue={step?.description} className={INPUT} />
      </label>
    </>
  );
}
