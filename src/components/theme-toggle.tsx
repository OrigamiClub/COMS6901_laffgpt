"use client";

import { useEffect, useSyncExternalStore } from "react";

// Light / Dark / System switch. The choice is kept in localStorage; the
// script in layout.tsx (THEME_SCRIPT) applies it before the first paint,
// and this keeps <html data-theme> in step afterwards, including when the
// system setting changes while "System" is picked.

export type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const CHOICES: { value: ThemeChoice; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀︎" },
  { value: "dark", label: "Dark", icon: "☾" },
  { value: "system", label: "System", icon: "◐" },
];

// Inlined into <head>, so it runs before the page is painted.
export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("${STORAGE_KEY}");if(c!=="light"&&c!=="dark")c=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=c}catch(e){}})()`;

const listeners = new Set<() => void>();

function readChoice(): ThemeChoice {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

function apply(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setChoice(choice: ThemeChoice) {
  if (choice === "system") localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, choice);
  apply(choice);
  listeners.forEach((l) => l());
}

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const choice = useSyncExternalStore(subscribe, readChoice, () => "system" as ThemeChoice);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readChoice() === "system") apply("system");
    };
    // Another tab changed the choice.
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY || e.key === null) {
        apply(readChoice());
        listeners.forEach((l) => l());
      }
    };
    media.addEventListener("change", onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex rounded-full border border-black/15 p-0.5 text-xs dark:border-white/20 ${className}`}
    >
      {CHOICES.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={choice === c.value}
          onClick={() => setChoice(c.value)}
          title={c.label}
          className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
            choice === c.value ? "bg-foreground text-white" : "opacity-75 hover:opacity-100"
          }`}
        >
          <span aria-hidden>{c.icon}</span>
          {c.label}
        </button>
      ))}
    </div>
  );
}
