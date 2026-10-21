"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { CopyLine } from "@/components/toolsets/toolset-bits";
import { Button } from "@/components/ui/button";
import { routes } from "@/libs/routes";
import {
  shareProviderToolUnlisted,
  submitProviderToolReview,
  unpublishProviderTool,
  withdrawProviderToolReview,
  type ProviderTool,
  type ProviderToolGate,
  type ProviderToolVisibility,
} from "@/services/provider-tools.service";
import { cn } from "@/utils";
import { toast } from "@/utils/toast";

import { connectHref, providerToolErrorView, VISIBILITY_LABEL, type PublishStepId } from "./model";
import { providerToolKeys } from "./queries";
import { GateChecklist, NotReviewedChip } from "./ui";

/**
 * Step 3, "Connect & check": the listing that serves the tool (made with the
 * listing wizard, which comes back here) and the publish gate with what to
 * fix. Step 4, "Who can use it": Only my team, Anyone with the link ("Not
 * reviewed"), or Listed in the catalogue (review first).
 */

export function ConnectStep({
  tool,
  gate,
  gateLoading,
  gateError,
  onRecheck,
  onStep,
}: {
  tool: ProviderTool;
  gate: ProviderToolGate | null;
  gateLoading: boolean;
  gateError: boolean;
  onRecheck: () => void;
  onStep: (step: PublishStepId) => void;
}) {
  if (tool.currentVersion === null) {
    return (
      <section className="flex w-full flex-col gap-3 rounded-xl border border-01 bg-01 px-4 py-4">
        <h2 className="text-label-md text-01">Connect & check</h2>
        <PageState
          kind="empty"
          bare
          title="Publish your inputs and outputs first"
          description="Your endpoint is tested against the version you publish in step 2."
          action={{ label: "Go to step 2", onClick: () => onStep("contract") }}
        />
      </section>
    );
  }
  const binding = tool.binding;
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="connect-step">
      <header className="flex flex-col gap-1">
        <h2 className="text-label-md text-01">Connect & check</h2>
        <p className="text-body-13 text-02">
          Your endpoint is the only one that serves {tool.name}. Connect it, run a test and set a price in the listing; the checks below update when you come back.
        </p>
      </header>
      <div className="flex flex-col gap-2 rounded-lg bg-02 px-3.5 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <p className="text-body-13 text-01">
          {!binding
            ? "No endpoint connected yet."
            : binding.status === "ACTIVE"
              ? "Your endpoint is connected and live."
              : binding.status === "DRAFT"
                ? "Your listing is a draft: finish the test and publish it."
                : `Your listing is ${binding.status.toLowerCase()}.`}
        </p>
        <div className="flex flex-wrap gap-2">
          {!binding || binding.status === "DRAFT" ? (
            <Button asChild>
              <Link href={connectHref(tool, binding ? "live" : "connect")}>{binding ? "Finish the listing" : "Connect your endpoint"}</Link>
            </Button>
          ) : (
            <Button asChild variant="secondary">
              <Link href={routes.binding(binding.bindingId)}>Open the listing</Link>
            </Button>
          )}
        </div>
      </div>
      {gateLoading ? (
        <PageState kind="loading" rows={3} label="Checking" />
      ) : gateError || !gate ? (
        <PageState kind="error" description="The checks could not be loaded." onRetry={onRecheck} />
      ) : (
        <GateChecklist gate={gate} tool={tool} onStep={onStep} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<RefreshCw aria-hidden="true" />} onClick={onRecheck}>
          Check again
        </Button>
        {gate?.passed ? <Button onClick={() => onStep("share")}>Continue to who can use it</Button> : null}
      </div>
    </section>
  );
}

const REVIEW_CHECKS = [
  "It does not pretend to be another company or product.",
  "No text tells a model what to do (only what the tool does).",
  "It never asks for a secret: a key, a password or a token.",
  "The examples run and match the schemas.",
  "The price is clear.",
];

export function ShareStep({ tool, gate, onStep }: { tool: ProviderTool; gate: ProviderToolGate | null; onStep: (step: PublishStepId) => void }) {
  const queryClient = useQueryClient();
  const pending = tool.review.status === "PENDING";
  const listed = tool.visibility === "LISTED";
  const rejected = tool.review.state === "REJECTED" || tool.review.state === "CHANGES_REJECTED";
  // Where it stands, or where it was sent: a pending or rejected review was for the catalogue.
  const initialChoice: ProviderToolVisibility = listed || pending || rejected ? "LISTED" : (tool.visibility as ProviderToolVisibility);
  const [choice, setChoice] = React.useState<ProviderToolVisibility>(initialChoice);
  React.useEffect(() => setChoice(initialChoice), [initialChoice]);
  const passed = Boolean(gate?.passed);

  const store = (updated: ProviderTool) => {
    queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: providerToolKeys.list });
    void queryClient.invalidateQueries({ queryKey: providerToolKeys.gate(updated.id) });
  };
  const onError = (error: unknown) => {
    const view = providerToolErrorView(error);
    toast.error(view.text);
    if (view.gateFailed) onStep("connect");
  };
  const share = useMutation({
    mutationFn: () => shareProviderToolUnlisted(tool.id),
    onSuccess: (updated) => {
      store(updated);
      toast.success(`${updated.name} can now be used by anyone with the link`);
    },
    onError,
  });
  const submit = useMutation({
    mutationFn: () => submitProviderToolReview(tool.id),
    onSuccess: (updated) => {
      store(updated);
      toast.success("Sent for review. You get a notice when it is decided.");
    },
    onError,
  });
  const withdraw = useMutation({ mutationFn: () => withdrawProviderToolReview(tool.id), onSuccess: store, onError });
  const [confirmUnshare, setConfirmUnshare] = React.useState(false);
  const unshare = useMutation({
    mutationFn: () => unpublishProviderTool(tool.id),
    onSuccess: (updated) => {
      store(updated);
      toast.success(`${updated.name} is back to only your team. Link-only tool sets stop reaching it now.`);
    },
    onError,
  });

  const options: { id: ProviderToolVisibility; title: string; body: React.ReactNode; disabled: boolean }[] = [
    {
      id: "PRIVATE",
      title: VISIBILITY_LABEL.PRIVATE,
      body:
        tool.visibility === "LISTED"
          ? "A listed tool can't go back to only your team from here: ask support to remove it from the catalogue."
          : pending
            ? "Withdraw the review first, then you can stop sharing it."
            : "Your own agents call it through your private tool sets. Nothing outside your team sees it.",
      disabled: tool.visibility === "LISTED" || pending,
    },
    {
      id: "UNLISTED",
      title: VISIBILITY_LABEL.UNLISTED,
      body: (
        <>
          Anyone with the link to one of your link-only tool sets can call it. It is marked <NotReviewedChip /> and no other team can add it to their own tool sets.
        </>
      ),
      // Once listed it stays reachable by everyone; "Anyone with the link" is a step down only via support.
      disabled: listed,
    },
    {
      id: "LISTED",
      title: VISIBILITY_LABEL.LISTED,
      body: `Assay reviews it first. Then it is in the catalogue, in search and on your public page @${tool.handle}. One maker's API is at most "Verified", never "Guaranteed".`,
      disabled: false,
    },
  ];

  const busy = share.isPending || submit.isPending || withdraw.isPending || unshare.isPending;
  const sharedNote = tool.visibility !== "PRIVATE" ? "Your public name is locked now: it can only change through Assay support." : "Sharing locks your public name.";

  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="share-step">
      <header className="flex flex-col gap-1">
        <h2 className="text-label-md text-01">Who can use it</h2>
        <p className="text-body-13 text-02">Now: {VISIBILITY_LABEL[tool.visibility as ProviderToolVisibility] ?? tool.visibility}. {sharedNote}</p>
      </header>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Who can use it</legend>
        {options.map((option) => (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3",
              choice === option.id ? "border-primary-500 bg-primary-10" : "border-02 bg-01",
              option.disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              name="provider-tool-visibility"
              className="mt-1 accent-primary-500"
              checked={choice === option.id}
              disabled={option.disabled}
              onChange={() => setChoice(option.id)}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-label-sm text-01">
                {option.title}
                {tool.visibility === option.id ? <span className="ml-2 text-body-xs text-03">(now)</span> : null}
              </span>
              <span className="text-body-13 text-02">{option.body}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {choice === "LISTED" ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-02 px-3.5 py-3">
          <p className="text-label-13 text-01">What the reviewer checks</p>
          <ul className="list-disc pl-4 text-body-13 text-02">
            {REVIEW_CHECKS.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="text-body-xs text-03">Every version it serves is reviewed. While a change is in review, the approved version keeps serving.</p>
        </div>
      ) : null}

      {rejected && tool.review.note ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-3">
          <p className="text-label-13 text-01">Changes requested{tool.review.decidedAt ? <> · <UtcTime value={tool.review.decidedAt} /></> : null}</p>
          <p className="text-body-13 text-01 [overflow-wrap:anywhere]">{tool.review.note}</p>
          <Button variant="secondary" size="sm" className="touch-target self-start" onClick={() => onStep("contract")}>
            Fix it in step 2
          </Button>
        </div>
      ) : null}

      {!passed && choice !== "PRIVATE" && !pending && !listed ? (
        <p className="text-body-13 text-warning-700">
          Some checks are not met yet.{" "}
          <button type="button" className="touch-target inline-flex items-center text-primary-600 underline" onClick={() => onStep("connect")}>
            See what to fix
          </button>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {choice === "UNLISTED" && tool.visibility === "PRIVATE" ? (
          <Button disabled={!passed || busy} loading={share.isPending} onClick={() => share.mutate()}>
            Share with anyone with the link
          </Button>
        ) : null}
        {choice === "LISTED" && pending ? (
          <>
            <p className="text-body-13 text-02">
              Review requested: Listed in the catalogue{tool.review.reviewSemver ? ` (v${tool.review.reviewSemver})` : ""}, sent{" "}
              {tool.review.submittedAt ? <UtcTime value={tool.review.submittedAt} midSentence alwaysDay /> : null}.
            </p>
            <Button variant="secondary" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw the review
            </Button>
          </>
        ) : null}
        {choice === "LISTED" && !pending && (!listed || rejected) ? (
          <Button disabled={!passed || busy} loading={submit.isPending} onClick={() => submit.mutate()}>
            {rejected ? "Resubmit for review" : "Submit for review"}
          </Button>
        ) : null}
        {choice === "PRIVATE" && tool.visibility === "PRIVATE" ? <p className="text-body-13 text-02">It stays with your team. You can share it any time.</p> : null}
        {choice === "PRIVATE" && tool.visibility === "UNLISTED" && !pending ? (
          confirmUnshare ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Stop sharing?">
              <span className="text-body-13 text-02">Stop sharing? Your link-only tool sets stop reaching it at once; your own team keeps it.</span>
              <Button variant="danger" loading={unshare.isPending} disabled={busy} onClick={() => unshare.mutate()}>
                Stop sharing
              </Button>
              <Button variant="ghost" disabled={unshare.isPending} onClick={() => setConfirmUnshare(false)}>
                Keep sharing
              </Button>
            </span>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmUnshare(true)}>
              Stop sharing: only my team
            </Button>
          )
        ) : null}
      </div>

      {tool.visibility === "UNLISTED" ? (
        <p className="text-body-13 text-02">
          People reach it through a link-only tool set of yours.{" "}
          <Link href="/toolsets/mine" className="text-primary-600 hover:underline">
            Put it in a tool set
          </Link>
          .
        </p>
      ) : null}
      {listed && tool.mcpUrls.handle ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-label-13 text-01">Every listed tool of @{tool.handle}, as one server</p>
          <CopyLine value={tool.mcpUrls.handle} />
          <Link href={`/toolsets/handle?handle=${encodeURIComponent(tool.handle)}`} className="inline-flex min-h-10 items-center self-start text-body-13 text-primary-600 hover:underline">
            See your public page
          </Link>
        </div>
      ) : null}
    </section>
  );
}
