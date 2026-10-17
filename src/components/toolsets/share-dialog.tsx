"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Info, RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ConfirmSheet } from "@/components/patterns/confirm-sheet";
import { Skeleton } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { DRAFT_NOTICE, PUBLIC_NAME_LABEL, STOP_SHARING_LABEL, VISIBILITY_DETAILS, VISIBILITY_LABELS } from "@/features/toolsets/labels";
import {
  changelogFrom,
  diffSnapshots,
  handleErrorView,
  handleProblem,
  normaliseHandle,
  shareDialogModel,
  sharedLink,
  sharedPage,
  snapshotOfDraft,
  snapshotOfVersion,
  visibilityOf,
  type HandleErrorView,
} from "@/features/toolsets/sharing";
import { ApiError } from "@/libs/ApiClient";
import { formatDate } from "@/libs/utc-time";
import {
  claimOrgHandle,
  publishToolset,
  rotateUnlistedToken,
  unpublishToolset,
  type OrgHandle,
  type Toolset,
  type ToolsetVisibility,
} from "@/services/toolsets.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { CopyLine, DiffView } from "./toolset-bits";
import { errorText, toolsetKeys, useOrgHandle, useToolsetVersion } from "./use-toolsets";

/**
 * The Share dialog (design spec §7.7, §7.10): one dialog, four decisions —
 * who can use it, the public name (claimed inline the first time), the next
 * version (published on Share; v1 the first time) and its changelog (filled
 * in from the diff, editable). Once shared, the result comes first: the link
 * with Copy. "New link" (with a confirm: the old link stops at once) and
 * "Stop sharing" sit under it.
 */
export function ShareDialog({ set, open, onOpenChange }: { set: Toolset; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[600px]">{open ? <ShareBody set={set} onDone={() => onOpenChange(false)} /> : null}</SheetContent>
    </Sheet>
  );
}

const VISIBILITIES: ToolsetVisibility[] = ["PRIVATE", "UNLISTED", "PUBLIC"];

export function ShareBody({ set, onDone }: { set: Toolset; onDone: () => void }) {
  const queryClient = useQueryClient();
  const handle = useOrgHandle();
  const latest = useToolsetVersion(set.id, set.latestVersion ?? null);
  const current = visibilityOf(set);
  const [visibility, setVisibility] = React.useState<ToolsetVisibility>(current === "PRIVATE" ? "UNLISTED" : current);
  const [name, setName] = React.useState("");
  const [handleError, setHandleError] = React.useState<HandleErrorView | null>(null);
  const [changelog, setChangelog] = React.useState<string | null>(null);
  const [rotating, setRotating] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  // When old links stop: 90 days from the moment "Stop sharing" is pressed.
  const [stopUntil, setStopUntil] = React.useState<string | null>(null);
  const [justShared, setJustShared] = React.useState<number | null>(null);

  const diff = set.latestVersion ? (latest.data ? diffSnapshots(snapshotOfVersion(latest.data), snapshotOfDraft(set)) : null) : diffSnapshots(null, snapshotOfDraft(set));
  const model = shareDialogModel({ set, handle: handle.data ?? null, visibility, diff });
  const suggested = diff ? changelogFrom(diff, !set.latestVersion, set.entries.length) : "";
  const text = changelog ?? suggested;
  const loadingDiff = Boolean(set.latestVersion) && latest.isPending;

  const refresh = (next: Toolset) => {
    queryClient.setQueryData(toolsetKeys.one(set.id), next);
    void queryClient.invalidateQueries({ queryKey: toolsetKeys.all });
    void queryClient.invalidateQueries({ queryKey: toolsetKeys.versions(set.id) });
    void queryClient.invalidateQueries({ queryKey: toolsetKeys.handle });
  };

  const share = useMutation({
    mutationFn: async () => {
      if (model.needsHandle) {
        const problem = handleProblem(name);
        if (problem) throw new HandleProblem(problem);
        try {
          const claimed: OrgHandle = await claimOrgHandle(normaliseHandle(name));
          queryClient.setQueryData(toolsetKeys.handle, claimed);
        } catch (error) {
          if (error instanceof ApiError) throw new HandleRefused(handleErrorView(error.code, error.context, name));
          throw error;
        }
      }
      return publishToolset(set.id, { visibility, ...(text.trim() && text.trim() !== suggested ? { changelog: text.trim().slice(0, 500) } : {}) });
    },
    onSuccess: (result) => {
      setHandleError(null);
      refresh(result.toolset);
      setChangelog(null);
      setJustShared(result.version?.version ?? null);
      toast.success(
        visibility === "PRIVATE" ? `Saved v${result.version?.version ?? ""}` : `Shared v${result.version?.version ?? ""} — ${VISIBILITY_LABELS[visibility].toLowerCase()}`,
      );
    },
    onError: (error) => {
      if (error instanceof HandleRefused) setHandleError(error.view);
      else if (error instanceof HandleProblem) setHandleError({ text: error.message, suggestions: [], action: null });
      else if (error instanceof ApiError && error.code === "TOOLSET_HANDLE_REQUIRED") setHandleError(handleErrorView(error.code, error.context, name));
      else toast.error(errorText(error, "It could not be shared. Try again."));
    },
  });
  const rotate = useMutation({ mutationFn: () => rotateUnlistedToken(set.id), onSuccess: (r) => refresh(r.toolset) });
  const stop = useMutation({ mutationFn: () => unpublishToolset(set.id), onSuccess: (r) => refresh(r.toolset) });

  const link = sharedLink(set);
  const page = sharedPage(set);
  const shared = current !== "PRIVATE";

  return (
    <>
      <SheetHeader>
        <SheetTitle>Share {set.name}</SheetTitle>
        <SheetDescription>Choose who can use it. Sharing publishes a version; your team keeps working on the Draft.</SheetDescription>
      </SheetHeader>
      <div className="flex w-full min-w-0 flex-col gap-4 px-[18px] pb-4 pt-3" data-testid="share-dialog">
        {shared && link ? (
          <section className="flex flex-col gap-2 rounded-lg border border-primary-20 bg-primary-10 p-3" data-testid="share-result">
            <p className="text-label-13 text-01">
              {justShared ? `v${justShared} is shared. ` : ""}
              {current === "PUBLIC" ? "Listed in the catalogue. Anyone can connect it with this URL:" : "Anyone with this link can connect it:"}
            </p>
            <CopyLine value={link} label="Copy link" testId="share-link" />
            <p className="text-body-xs text-02">
              It is locked to v{set.latestVersion}, so people get no surprise changes.
              {page ? (
                <>
                  {" "}
                  <Link href={page} className="font-semibold text-primary-600 hover:underline">
                    See its page
                  </Link>
                </>
              ) : null}
            </p>
            <div className="flex flex-wrap gap-2">
              {model.canRotate ? (
                <Button size="sm" variant="secondary" icon={<RefreshCw />} onClick={() => setRotating(true)}>
                  New link
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                className="text-danger-700"
                onClick={() => {
                  setStopUntil(new Date(Date.now() + 90 * 86_400_000).toISOString());
                  setStopping(true);
                }}
              >
                {STOP_SHARING_LABEL}
              </Button>
            </div>
          </section>
        ) : null}

        <fieldset className="flex flex-col gap-2" data-testid="share-visibility">
          <legend className="pb-1 text-label-sm text-01">Who can use it?</legend>
          {VISIBILITIES.map((v) => (
            <label
              key={v}
              className={cn(
                "flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5",
                visibility === v ? "border-primary-500 bg-primary-10" : "border-02 bg-01",
              )}
            >
              <input type="radio" name="share-visibility" className="mt-1 accent-primary-500" checked={visibility === v} onChange={() => setVisibility(v)} />
              <span className="flex min-w-0 flex-col">
                <span className="text-label-13 text-01">
                  {VISIBILITY_LABELS[v]}
                  {v === current ? <span className="font-normal text-03"> · now</span> : null}
                </span>
                <span className="text-body-xs text-02">{VISIBILITY_DETAILS[v]}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {model.needsHandle ? (
          handle.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <section className="flex flex-col gap-1.5" data-testid="share-handle">
              <label htmlFor="share-handle-input" className="text-label-13 text-01">
                Your {PUBLIC_NAME_LABEL.toLowerCase()}
              </label>
              <p className="text-body-xs text-03">Shown as @name on everything you share. Choose it once; it can change until the first share.</p>
              <div className={cn("flex min-h-10 items-center gap-1 rounded-xl border bg-shades-L5 px-3", handleError ? "border-danger-500" : "border-transparent")}>
                <AtSign aria-hidden="true" className="size-4 shrink-0 text-03" />
                <input
                  id="share-handle-input"
                  className="min-w-0 flex-1 bg-transparent py-2 text-body-sm text-01 outline-none"
                  placeholder="your-team"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={name}
                  aria-invalid={Boolean(handleError)}
                  aria-describedby="share-handle-error"
                  onChange={(e) => {
                    setName(e.target.value);
                    setHandleError(null);
                  }}
                />
              </div>
              {handleError ? (
                <div id="share-handle-error" role="alert" className="flex flex-col gap-1.5 text-body-13 text-danger-700" data-testid="share-handle-error">
                  <span>{handleError.text}</span>
                  {handleError.suggestions.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {handleError.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          className="min-h-10 rounded-full border border-02 bg-01 px-3 font-mono text-mono-12 text-01 hover:border-primary-500 tablet:min-h-0 tablet:py-1"
                          onClick={() => {
                            setName(s);
                            setHandleError(null);
                          }}
                        >
                          @{s}
                        </button>
                      ))}
                    </span>
                  ) : null}
                  {handleError.action ? (
                    <Link href={handleError.action.href} className="min-h-10 content-center font-semibold text-primary-600 hover:underline tablet:min-h-0">
                      {handleError.action.label}
                    </Link>
                  ) : null}
                </div>
              ) : name && handleProblem(name) === null ? (
                <p className="text-body-xs text-03">
                  People will see <span className="font-mono text-01">@{normaliseHandle(name)}/{set.slug}</span>
                </p>
              ) : null}
            </section>
          )
        ) : visibility !== "PRIVATE" && handle.data?.handle ? (
          <p className="text-body-13 text-02">
            Shared as <span className="font-mono text-01">@{handle.data.handle}/{set.slug}</span>
          </p>
        ) : null}

        <section className="flex flex-col gap-1.5" data-testid="share-version">
          <span className="text-label-13 text-01">
            {set.latestVersion ? `What changed since v${set.latestVersion}` : "First version"} — published as v{model.nextVersion}
          </span>
          {loadingDiff ? (
            <Skeleton className="h-10 w-full" />
          ) : diff && set.latestVersion ? (
            <DiffView diff={diff} empty={`No changes since v${set.latestVersion}.`} />
          ) : null}
          <label htmlFor="share-changelog" className="text-body-xs text-03">
            Notes for people who use it (filled in from the changes; edit as you like)
          </label>
          <Textarea id="share-changelog" maxLength={500} value={text} onChange={(e) => setChangelog(e.target.value)} />
        </section>

        <p className="flex items-start gap-2 rounded-lg bg-02 px-3 py-2 text-body-xs text-02" data-testid="share-draft-notice">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="font-semibold text-01">Draft</strong> is what you edit, served live to your team at /my/{set.slug}. {DRAFT_NOTICE}{" "}
            <strong className="font-semibold text-01">Versions</strong> are frozen copies: people you share with use a version, and edits reach them only when you
            share the next one.
          </span>
        </p>

        <p className="text-body-13 text-02">{model.nothingToDo ? `Nothing changed since v${set.latestVersion}: no need to publish again.` : model.outcome}</p>
      </div>

      <div className="sticky bottom-0 z-10 flex w-full flex-wrap items-center gap-2 border-t border-01 bg-01 px-[18px] py-3">
        <Button
          loading={share.isPending}
          disabled={model.nothingToDo || set.removed || loadingDiff || (model.needsHandle && !name.trim())}
          onClick={() => share.mutate()}
          data-testid="share-primary"
        >
          {model.primaryLabel}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {justShared ? "Done" : "Cancel"}
        </Button>
      </div>

      <ConfirmSheet
        open={rotating}
        onOpenChange={setRotating}
        tone="danger"
        title="Make a new link?"
        description="The old link stops working at once. Agents connected through it lose these tools until you send them the new link."
        confirmLabel="Make a new link"
        onConfirm={async () => {
          await rotate.mutateAsync();
          toast.success("New link ready. Send it to the people who should keep using it.");
        }}
        describeError={(error) => errorText(error, "The link could not be changed")}
      />
      <ConfirmSheet
        open={stopping}
        onOpenChange={setStopping}
        tone="danger"
        title={`Stop sharing ${set.name}?`}
        description={`Only your team can use it from now on. Links you shared keep serving v${set.latestVersion ?? 1} for 90 days${stopUntil ? `, until ${formatDate(stopUntil)} UTC` : ""}, then stop. It leaves the catalogue at once.`}
        confirmLabel={STOP_SHARING_LABEL}
        onConfirm={async () => {
          await stop.mutateAsync();
          toast.success("Sharing stopped");
        }}
        describeError={(error) => errorText(error, "Sharing could not be stopped")}
      />
    </>
  );
}

class HandleProblem extends Error {}

class HandleRefused extends Error {
  constructor(readonly view: HandleErrorView) {
    super(view.text);
  }
}
