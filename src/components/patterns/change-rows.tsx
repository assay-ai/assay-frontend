import { ArrowRight } from "lucide-react";
import * as React from "react";

/** One row of a before → after diff. */
export interface ConfirmChange {
  label: React.ReactNode;
  before: React.ReactNode;
  after: React.ReactNode;
}

/** Before → after rows. Shared by ConfirmSheet and WalletActionSheet. */
export function ChangeRows({ changes }: { changes: ConfirmChange[] }) {
  return (
    <dl className="flex w-full flex-col overflow-hidden rounded-lg border border-01">
      {changes.map((change, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-01 px-3.5 py-2.5 last:border-b-0 tablet:grid-cols-[140px_minmax(0,1fr)]"
        >
          <dt className="text-body-13 text-03">{change.label}</dt>
          <dd className="col-span-2 flex flex-wrap items-center gap-2 text-body-13 tablet:col-span-1">
            <span className="text-02 line-through decoration-03">{change.before}</span>
            <ArrowRight aria-label="becomes" className="size-3.5 shrink-0 text-03" />
            <span className="font-semibold text-01">{change.after}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
