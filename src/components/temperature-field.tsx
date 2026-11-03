"use client";

import { useState } from "react";
import { INPUT, LABEL } from "@/components/field-styles";

// Temperature as a slider and a number box that stay in step (0–2).
export default function TemperatureField({ defaultValue = 1 }: { defaultValue?: number }) {
  const [value, setValue] = useState(String(defaultValue));

  return (
    <label className={LABEL}>
      Temperature
      <span className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={Number(value) || 0}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Temperature slider"
          className="min-w-0 flex-1 accent-[var(--title)]"
        />
        <input
          type="number"
          name="temperature"
          min={0}
          max={2}
          step={0.05}
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={`${INPUT} w-24`}
        />
      </span>
    </label>
  );
}
