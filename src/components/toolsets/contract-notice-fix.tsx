"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { allowMajorOf, readContractNotice } from "@/features/toolsets/contract-notices";
import { replaceToolsetEntries, type ToolsetEntryInput } from "@/services/toolsets.service";

import { runEntryFix } from "./refused-calls";
import { toolsetKeys } from "./use-toolsets";

/**
 * "Allow v2" on a deprecation or retirement notice that names the buyer's
 * tool set: widens that entry to the newer version in one click, with Undo
 * next to it. Renders nothing when the notice names no tool set, or when the
 * replacement is another tool.
 */
export function ContractNoticeFix({ payload }: { payload: unknown }) {
  const notice = readContractNotice(payload);
  const major = notice ? allowMajorOf(notice) : null;
  const queryClient = useQueryClient();
  const [before, setBefore] = React.useState<{ setId: string; entries: ToolsetEntryInput[] } | null>(null);
  const [done, setDone] = React.useState(false);
  const allow = useMutation({
    mutationFn: () =>
      runEntryFix({ kind: "allow-major", toolsetId: notice!.toolsetId!, toolId: notice!.toolId, majors: [major!], callMajor: notice!.major, label: `Allow v${major}` }),
    onSuccess: ({ set, before: prior }) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), set);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      setDone(true);
      setBefore(prior ? { setId: set.id, entries: prior } : null);
      toast.success(prior ? `${set.name} now also uses v${major} of ${notice!.toolName}` : `${set.name} already uses v${major}`, {
        description: prior ? `Calls can use v${notice!.major} or v${major}; v${major} is used once v${notice!.major} stops.` : undefined,
      });
    },
    onError: () => toast.error("The tool set could not be changed. Open it to change it."),
  });
  const undo = useMutation({
    mutationFn: () => replaceToolsetEntries(before!.setId, before!.entries),
    onSuccess: (set) => {
      queryClient.setQueryData(toolsetKeys.one(set.id), set);
      void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
      setDone(false);
      setBefore(null);
      toast.success("Undone");
    },
    onError: () => toast.error("The change could not be undone. Open the tool set to change it back."),
  });
  if (!notice || major === null) return null;
  if (done) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-label-13 text-success-700">Allowed v{major}</span>
        {before ? (
          <Button size="sm" variant="ghost" loading={undo.isPending} onClick={() => undo.mutate()}>
            Undo
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <Button size="sm" variant="secondary" loading={allow.isPending} onClick={() => allow.mutate()}>
      Allow v{major}
    </Button>
  );
}
