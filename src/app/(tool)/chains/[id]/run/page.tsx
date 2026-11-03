import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { loadChain } from "@/lib/chains";
import RunForm from "./run-form";

// Applies to the server actions this page calls. One step can take up to
// ~50s (see lib/gemini.ts), more than Vercel's default allows on some plans.
export const maxDuration = 60;

// Run the chain on an image, some text, or both, and watch each step's
// output come in.
export default async function RunPage({ params, searchParams }: PageProps<"/chains/[id]/run">) {
  const { supabase } = await requireAdmin();
  const id = Number((await params).id);
  const { image } = await searchParams;

  const loaded = await loadChain(supabase, id);
  if (!loaded) notFound();
  if (loaded.chain.is_builtin) redirect(`/chains/${id}`);
  const { chain, steps } = loaded;

  if (steps.length === 0) {
    return (
      <p className="card text-sm">
        This chain has no steps yet. <Link href={`/chains/${id}#new-step`} className="underline">Add one</Link> first.
      </p>
    );
  }

  return (
    <RunForm
      chainId={chain.id}
      steps={steps.map((s) => ({
        id: s.id,
        name: s.name,
        includeImage: s.include_image,
        makesImage: s.output_format === "image",
        temperature: s.temperature,
        hasPrompt: Boolean(s.prompt?.trim()),
      }))}
      reuseImage={typeof image === "string" ? image : undefined}
    />
  );
}
