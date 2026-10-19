import { cn } from "@/utils";

/** The URL kinds and when to use each (spec 9.5, R-UI-6). */
export const ADVANCED_URL_KINDS: readonly { kind: string; example: string; text: string }[] = [
  { kind: "Everything (default)", example: "/", text: "Search the whole catalogue. About 4 tool definitions." },
  { kind: "A topic", example: "/c/weather", text: "Fewer tools in context: one category." },
  { kind: "Only these tools", example: "/?tools=a,b", text: "The smallest context: exactly the tools you pick." },
  { kind: "A tool set", example: "/@acme/kit@3", text: "A curated set, pinned so it never changes under you." },
  { kind: "A maker", example: "/@acme", text: "Every tool one provider sells." },
  { kind: "Your tool set", example: "/my/research", text: "Your own set, live or locked to a version." },
  { kind: "Free only", example: "?free=1", text: "Add to any URL: free tools only, never charged." },
];

export function AdvancedUrlKinds({ className }: { className?: string }) {
  return (
    <details className={cn("rounded-lg border border-01 bg-02 px-3 py-2.5", className)} data-testid="connect-advanced">
      <summary className="min-h-10 cursor-pointer select-none content-center text-label-13 text-01">Advanced: limit what this agent sees</summary>
      <ul className="mt-3 flex flex-col gap-2">
        {ADVANCED_URL_KINDS.map((row) => (
          <li key={row.kind} className="grid min-w-0 gap-x-3 gap-y-0.5 text-body-xs tablet:grid-cols-[170px_130px_1fr]">
            <span className="text-label-13 text-01">{row.kind}</span>
            <code className="break-all font-mono text-mono-12 text-02">{row.example}</code>
            <span className="text-03">{row.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-body-xs text-03">One budget covers every Assay server on this computer.</p>
    </details>
  );
}
