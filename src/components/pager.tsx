import Link from "next/link";

// Newer/Older links that keep the page's other query parameters.
export default function Pager({
  path,
  params,
  page,
  pages,
}: {
  path: string;
  params: Record<string, string>;
  page: number;
  pages: number;
}) {
  if (pages <= 1) return null;
  const href = (to: number) => `${path}?${new URLSearchParams({ ...params, page: String(to) })}`;

  return (
    <nav aria-label="Pages" className="flex items-center justify-center gap-3 text-sm">
      {page > 1 && <Link href={href(page - 1)} className="btn-outline">← Newer</Link>}
      <span>Page {page} of {pages}</span>
      {page < pages && <Link href={href(page + 1)} className="btn-outline">Older →</Link>}
    </nav>
  );
}
