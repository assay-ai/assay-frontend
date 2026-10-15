import * as React from "react";

import { cn } from "@/utils";

/**
 * Copy taken verbatim from the design (Foundations > Check Bench).
 * Callers building a different screen may need different wording (the design
 * itself overrides this copy per instance),
 * so `body`/`tail` stay overridable, but they must still be verbatim strings
 * from the design, never paraphrased.
 */
const DEFAULT_BODY =
  "Relevance judgement is the only sampled stage. At $0.0010 a call, judging every one would cost more than the call itself. Instead we sample, and the provider’s stake covers the rest: if their measured quality falls below what they published, they are slashed and you are compensated for what you spent in that window.";
const DEFAULT_TAIL =
  "Tools priced $0.05 and above on the guaranteed tier are judged on every call.";

export interface SamplingExplainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The sampling rate this explanation is describing, e.g. "1 call in 125 at
   * this price" (the same verbatim note the design shows next to a
   * not-sampled check in `StageList`). Required: the design never shows this
   * explainer without a rate alongside it.
   */
  rate: string;
  body?: string;
  tail?: string;
}

/**
 * Explains why relevance judgement is sampled rather than run on every call.
 * Always render the SHOWN-AS sentence (never "skipped" — see Foundations >
 * Vocabulary) and always pass the rate that applies to this call.
 */
export const SamplingExplainer = React.forwardRef<HTMLDivElement, SamplingExplainerProps>(
  ({ rate, body = DEFAULT_BODY, tail = DEFAULT_TAIL, className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex w-full flex-col gap-2.5 rounded-lg border border-01 bg-02 p-[18px]",
        className
      )}
      {...props}
    >
      <p className="w-full text-body-13 text-02">{body}</p>
      {tail ? <p className="w-full text-body-13 text-03">{tail}</p> : null}
      {rate ? <p className="w-full text-body-13 text-03">{rate}</p> : null}
    </div>
  )
);
SamplingExplainer.displayName = "SamplingExplainer";
