"use client";

import * as React from "react";

import { useEntityNames, type EntityKind } from "@/hooks/useEntityNames";
import { cn } from "@/utils";

import { CopyChip, shortId } from "./copy-chip";
import { Skeleton } from "./page-state";

/**
 * A tool, provider, agent or key, by name.
 *
 *   <EntityName kind="tool" id={call.toolId} />
 *   <EntityName kind="provider" id={call.providerId} withId />   // name + id chip
 *
 * - Name known: the name (and, with `withId`, the id as a CopyChip after it).
 * - Still loading: a short skeleton, so the id does not flash first.
 * - No name (deleted, failed fetch): the id as a CopyChip, never a bare uuid.
 *
 * Mount many of these freely: they share one cached query per kind.
 * Buyer and provider sessions only — the endpoints behind it are not on the
 * operator token; operator screens name things from their own responses.
 */
export interface EntityNameProps {
  kind: EntityKind;
  id: string | null | undefined;
  withId?: boolean;
  /**
   * Default true. Set false inside a link or button (a row that opens a
   * receipt): the unresolved id then shows as plain short text, not a chip.
   */
  copyable?: boolean;
  /** Shown when `id` is empty. Default "—". */
  empty?: React.ReactNode;
  className?: string;
}

const KIND_LABEL: Record<EntityKind, string> = {
  tool: "tool id",
  provider: "provider id",
  agent: "agent id",
  credential: "key id",
};

export function EntityName({ kind, id, withId = false, copyable = true, empty = "—", className }: EntityNameProps) {
  const names = useEntityNames({ kinds: kind === "credential" ? ["agent", "credential"] : [kind] });
  if (!id) return <span className={cn("text-03", className)}>{empty}</span>;

  const name = names.lookup(kind, id);
  if (!name && names.isPending) return <Skeleton className={cn("inline-block h-3.5 w-20 align-middle", className)} />;
  if (!name) {
    return copyable ? (
      <CopyChip value={id} label={KIND_LABEL[kind]} className={className} />
    ) : (
      <span title={id} className={cn("font-mono text-mono-12 text-02", className)}>
        {shortId(id)}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <span className="truncate">{name}</span>
      {withId && copyable ? <CopyChip value={id} label={KIND_LABEL[kind]} /> : null}
    </span>
  );
}
