"use client";

import { useEffect } from "react";
import Link from "next/link";

// Shown instead of Next's bare "Application error" page when a page or a
// form submission throws. In production the real message is hidden, so
// this stays generic.
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <span className="text-6xl" aria-hidden>
        🐹
      </span>
      <h1 className="page-title text-4xl">The hamsters tripped over something</h1>
      <p className="max-w-md">
        That didn&apos;t work. If you were uploading a picture, make sure
        it&apos;s a JPG, PNG, GIF, or WebP under 4MB, then try again.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button type="button" onClick={() => retry()} className="btn-primary">
          Try again
        </button>
        <Link href="/" className="btn-secondary">
          Back to the chains
        </Link>
      </div>
    </main>
  );
}
