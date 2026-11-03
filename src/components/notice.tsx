// One-line confirmation after a change redirects back with ?notice=...
const MESSAGES: Record<string, { text: string; error?: boolean }> = {
  "chain-created": { text: "Chain created. Add its first step below." },
  "chain-saved": { text: "Chain saved." },
  "chain-deleted": { text: "Chain deleted. Its past runs stay in the generation log." },
  "step-added": { text: "Step added." },
  "step-saved": { text: "Step saved." },
  "step-deleted": { text: "Step deleted. The steps after it moved up." },
  "step-moved": { text: "Steps reordered." },
  "built-in": { text: "The meme board's built-in chains are read-only.", error: true },
  duplicate: { text: "Another chain already uses that slug.", error: true },
  "in-use": { text: "Something still uses that, so it wasn't deleted.", error: true },
  invalid: { text: "Something in the form was missing or not valid. Check it and try again.", error: true },
  "save-failed": {
    text: "Couldn't save that. Is the prompt chain tool migration (20261103000000) applied?",
    error: true,
  },
};

export default function Notice({ value }: { value: string | undefined }) {
  const message = value ? MESSAGES[value] : undefined;
  if (!message) return null;

  return (
    <p
      role="status"
      className={`cascade-in rounded-lg px-4 py-3 text-sm ${
        message.error ? "bg-red-700/10 text-red-700" : "bg-sage/15 text-sage"
      }`}
    >
      {message.text}
    </p>
  );
}
