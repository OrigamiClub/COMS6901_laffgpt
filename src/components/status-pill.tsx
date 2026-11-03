const STYLES: Record<string, string> = {
  succeeded: "bg-sage/15 text-sage",
  failed: "bg-red-700/10 text-red-700",
  running: "bg-mustard/15 text-mustard",
};

// The outcome of a generation request or a single model attempt.
export default function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STYLES[status] ?? ""}`}>
      {status}
    </span>
  );
}
