"use client";

import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { useSearchParam } from "@/hooks/useSearchParam";

/**
 * The guard every `/…/view` record screen sits behind.
 *
 * A record screen reads its id from the query string (see `libs/routes.ts`)
 * and keeps its queries disabled until there is one — so with no id at all it
 * used to wait forever on "Loading…" without making a request (BUG-R16-B1-01).
 * This says plainly that no record was named and links back to where one can
 * be picked. It wraps each view folder from its `layout.tsx`.
 */
export interface RecordGateProps {
  /** The query-string key that carries the id, e.g. "id" or "binding". */
  param: string;
  /** What one record is called, lower case: "receipt", "binding". */
  record: string;
  /** Where records of this kind are listed. */
  backHref: string;
  backLabel: string;
  children: React.ReactNode;
}

export function MissingRecord({
  record,
  backHref,
  backLabel,
}: Omit<RecordGateProps, "param" | "children">) {
  return (
    <PageState
      kind="empty"
      title={`No ${record} selected`}
      description={`This page shows one ${record}, and the link that opened it does not say which one. Pick a ${record} from the list.`}
      action={{ label: backLabel, href: backHref }}
    />
  );
}

export function RecordGate({ param, children, ...missing }: RecordGateProps) {
  const id = useSearchParam(param);
  if (!id.trim()) return <MissingRecord {...missing} />;
  return <>{children}</>;
}
