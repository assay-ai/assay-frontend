"use client";

import * as React from "react";

import { MCP_CLIENTS, type McpClient } from "@/features/buyer-money/mcp-config";
import { cn } from "@/utils";

/** Step 1 of Connect (spec 9.2, R-UI-1): "Which app do you use?" and one tile per app. */
export function ClientPicker({ value, onChange }: { value: McpClient; onChange: (client: McpClient) => void }) {
  const legendId = React.useId();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p id={legendId} className="text-label-13 text-01">
        Which app do you use?
      </p>
      <div role="radiogroup" aria-labelledby={legendId} className="flex flex-wrap gap-2">
        {MCP_CLIENTS.map((c) => {
          const checked = c.id === value;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={checked}
              data-testid={`client-${c.id}`}
              onClick={() => onChange(c.id)}
              className={cn(
                "min-h-10 whitespace-nowrap rounded-lg border px-3 text-label-13 transition-colors",
                checked ? "border-primary-500 bg-primary-10 font-semibold text-01" : "border-02 bg-01 text-02 hover:border-primary-500",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
