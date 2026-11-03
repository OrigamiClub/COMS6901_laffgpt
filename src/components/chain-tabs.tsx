"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Steps / Run / Media tabs under a chain's title.
export default function ChainTabs({ chainId, builtin }: { chainId: number; builtin: boolean }) {
  const pathname = usePathname();
  const base = `/chains/${chainId}`;
  const tabs = [
    { href: base, label: "Steps" },
    ...(builtin ? [] : [{ href: `${base}/run`, label: "Run" }]),
    { href: `${base}/media`, label: "Media" },
  ];

  return (
    <nav aria-label="Chain sections" className="flex gap-1 border-b border-black/10 dark:border-white/15">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              active ? "border-title text-title" : "border-transparent opacity-75 hover:opacity-100"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
