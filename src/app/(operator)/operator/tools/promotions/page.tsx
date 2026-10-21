"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Chip } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { standardToolNameProblem } from "@/features/operator/contract-editor";
import { mayPromote, toolReviewErrorText } from "@/features/operator/provider-tool-review";
import { OperatorToolsTabs } from "@/features/operator/provider-tool-ui";
import { useOperatorSession } from "@/features/operator/session-context";
import { ApiError } from "@/libs/ApiClient";
import { routes } from "@/libs/routes";
import { draftPromotion, listPromotionGroups, type PromotionCandidate, type PromotionGroup } from "@/services/operator-provider-tools.service";
import { toast } from "@/utils/toast";

/**
 * Promotion candidates — `/operator/tools/promotions` (design spec §7.5):
 * groups of provider tools doing the same job (same topic, similar names and
 * fields). Drafting a standard tool from one invites its provider and the
 * others; each sees the invitation in their console with a listing prefilled
 * from their own endpoint. The standard tool reaches traffic only through the
 * two-person publish in the contract editor.
 */

function localOf(name: string): string {
  return name.includes("__") ? name.split("__").slice(1).join("__") : name;
}

function PromoteSheet({ group, source, onClose }: { group: PromotionGroup | null; source: PromotionCandidate | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [invite, setInvite] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (!source || !group) return;
    setName(localOf(source.name));
    setCategory(source.category);
    setInvite(group.tools.filter((t) => t.toolId !== source.toolId).map((t) => t.toolId));
  }, [source, group]);
  const run = useMutation({
    mutationFn: () => draftPromotion({ sourceToolId: source!.toolId, name: name.trim(), ...(category.trim() && category.trim() !== source!.category ? { category: category.trim() } : {}), inviteToolIds: invite }),
    onSuccess: (result) => {
      toast.success(`Draft ${result.tool.name} created; ${result.invites.length} provider${result.invites.length === 1 ? "" : "s"} invited`);
      onClose();
      router.push(routes.operatorTool(result.tool.id));
    },
  });
  const nameProblem = standardToolNameProblem(name);
  return (
    <Sheet open={source !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <SheetContent className="tablet:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>Make a standard tool from {source?.name}</SheetTitle>
          <SheetDescription>It starts as a draft with this tool&apos;s contract. Nothing serves it until it is published in the editor, which needs a second Policy person.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-[18px] pb-5 pt-3">
          <Field label="Standard tool name" value={name} onChange={(e) => setName(e.target.value)} error={nameProblem ?? undefined} hint="No public name in front: it is backed by several providers." autoComplete="off" spellCheck={false} />
          <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} hint="Defaults to this tool's topic." />
          {group && group.tools.length > 1 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="pb-1 text-label-13 text-01">Also invite the providers of</legend>
              {group.tools
                .filter((t) => t.toolId !== source?.toolId)
                .map((t) => (
                  <Checkbox
                    key={t.toolId}
                    label={<span className="font-mono text-mono-12">{t.name}</span>}
                    checked={invite.includes(t.toolId)}
                    onChange={(e) => setInvite((list) => (e.target.checked ? [...list, t.toolId] : list.filter((id) => id !== t.toolId)))}
                  />
                ))}
            </fieldset>
          ) : null}
          {run.isError ? (
            <p role="alert" className="text-body-13 text-danger-700">
              {toolReviewErrorText(run.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button loading={run.isPending} disabled={!name.trim() || nameProblem !== null} onClick={() => run.mutate()}>
              Create the draft and invite
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PromotionsScreen() {
  const me = useOperatorSession();
  const canPromote = mayPromote(me.roles);
  const groups = useQuery({ queryKey: ["operator", "promotions"], queryFn: listPromotionGroups, retry: 0 });
  const [picked, setPicked] = React.useState<{ group: PromotionGroup; source: PromotionCandidate } | null>(null);
  const list = groups.data?.groups ?? [];
  return (
    <>
      <OperatorToolsTabs />
      <header className="flex flex-col gap-1">
        <h1 className="text-heading-md text-01">Promotion candidates</h1>
        <p className="text-body-13 text-02">One maker&apos;s APIs that do the same job. A standard tool made from them gives agents backup providers.</p>
        <p className="text-body-xs text-03">
          Why “Anyone with the link” tools are here too: they do the same job as listed ones, and a standard tool made from them gives their agents backup providers. They are not reviewed yet, but nothing of theirs is published: the standard tool goes through the contract editor and a second Policy person before it serves. Listed tools come first.
        </p>
      </header>
      {groups.isPending ? (
        <PageState kind="loading" rows={4} label="Loading candidates" />
      ) : groups.isError ? (
        <PageState kind="error" description="The candidates could not be loaded." onRetry={() => void groups.refetch()} code={groups.error instanceof ApiError ? groups.error.code : null} />
      ) : list.length === 0 ? (
        <PageState kind="empty" title="No candidates" description="When two or more provider tools in a topic have similar names and fields, they show here." />
      ) : (
        <div className="flex w-full flex-col gap-4" data-testid="promotion-groups">
          {list.map((group) => (
            <section key={`${group.category}:${group.tools.map((t) => t.toolId).join(",")}`} className="flex flex-col gap-2">
              <h2 className="text-label-md text-01">
                {group.category} <span className="text-body-13 text-03">· {group.tools.length} tools</span>
              </h2>
              <ul className="flex flex-col divide-y divide-01 rounded-xl border border-01 bg-01">
                {[...group.tools].sort((a, b) => Number(b.visibility === "LISTED") - Number(a.visibility === "LISTED")).map((tool) => (
                  <li key={tool.toolId} className="flex flex-col gap-2 px-4 py-3 tablet:flex-row tablet:items-start tablet:justify-between">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link href={routes.operatorReview(tool.toolId)} className="inline-flex min-h-10 items-center font-mono text-mono-13 text-01 hover:underline [overflow-wrap:anywhere]">
                          {tool.name}
                        </Link>
                        <Chip>{tool.visibility === "LISTED" ? "Listed" : "Anyone with the link · not reviewed yet"}</Chip>
                        <span className="text-body-xs text-03">v{tool.semver}</span>
                        {tool.replacementToolId ? <Chip tone="success">Points to a standard tool</Chip> : null}
                      </span>
                      <span className="text-body-13 text-02 [overflow-wrap:anywhere]">{tool.summary}</span>
                      <span className="text-body-xs text-03 [overflow-wrap:anywhere]">
                        In: {tool.inputFields.join(", ") || "—"} · out: {tool.outputFields.join(", ") || "—"}
                      </span>
                    </div>
                    {canPromote ? (
                      <Button variant="secondary" size="sm" className="touch-target self-start" onClick={() => setPicked({ group, source: tool })}>
                        Make a standard tool
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {!canPromote ? <p className="text-body-13 text-03">Drafting a standard tool needs the Policy author or Policy approver role.</p> : null}
      <PromoteSheet group={picked?.group ?? null} source={picked?.source ?? null} onClose={() => setPicked(null)} />
    </>
  );
}

export default function OperatorPromotionsPage() {
  return (
    <React.Suspense fallback={null}>
      <PromotionsScreen />
    </React.Suspense>
  );
}
