"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, FileWarning, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { SamplingExplainer } from "@/components/ui/sampling-explainer";
import { StageList } from "@/components/ui/stage-list";
import { DASH, stampUtc } from "@/features/g34a/stats";
import { ruleOutcomeLabel, shortId, toStageChecks } from "@/features/provider-evidence/stage-format";
// Imported by path, not through the `@/interfaces` / `@/services` barrels.
import type { EvidenceRuleResult, ProviderVerdictEvidence } from "@/interfaces/provider-evidence";
import { ApiError } from "@/libs/ApiClient";
import { getProviderVerdictEvidence } from "@/services/provider-evidence.service";
import { cn } from "@/utils";

/**
 * Evidence pack browser — route
 * `/provider/bindings/[bindingId]/verdicts/[verdictId]/evidence`.
 *
 * ## The frame is the wrong scope, and the API wins
 *
 * The design ("Evidence · w_4471") and the product spec both describe a
 * WINDOW-level pack: tabs for all 612 verdicts in a
 * window, Passing/Failed/Excluded SAMPLES drawn across many calls, "Policy
 * as evaluated" for the window, "Prior windows". That composition is
 * not built yet. What exists today, and what this route and API name, is
 * the CALL-level pack:
 * `GET /providers/me/verdicts/:id/evidence`, one verdict, sealed once at
 * judgement.
 *
 * So this page does not draw the design's tab bar or its aggregate samples —
 * there is no "612 verdicts" or "60 of 520 passing" to show for one call.
 * It DOES keep the parts of the frame that translate directly to one
 * record: the Attestation panel's shape (a hash to check a local copy
 * against, when it was sealed, the retention state) and the amber
 * retention banner's wording pattern.
 *
 * ## What the frame promises that the wire does not carry
 *
 * - **`verifier key` / `signature`.** The frame's Attestation tab draws both.
 *   No verifier signs `contentHash` yet (the signing key exists but
 *   nothing calls it for evidence) — there is no signature on the wire to
 *   show, so neither field is rendered. Only `contentHash`, `sealedAt` and
 *   `bodyState` are real.
 * - **Per-binding "extended retention".** The frame's own note offers to
 *   "enable extended retention on this binding to keep failed-call bodies
 *   for 30 days." Retention is one platform-wide
 *   `EVIDENCE_BODY_RETENTION_HOURS`; there is no per-binding override to
 *   link to, so this page states the fixed policy rather than drawing a
 *   control that would do nothing.
 *
 * ## Fields rendered as absent
 *
 * `seq` and `prevHash` are not on the wire for this route BY DESIGN (the
 * chain position is the buying organization's, not the provider's to see —
 * `ProviderEvidenceIntegrityDto`) and are never rendered here even if a
 * future response were to add them back.
 */

function pretty(value: unknown): string {
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value, null, 2);
}

function downloadPack(evidence: ProviderVerdictEvidence): void {
  const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `evidence-${evidence.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** One deterministic rule's row — the arithmetic behind `DETERMINISTIC_RULES`'s score. */
function RuleRow({ rule }: { rule: EvidenceRuleResult }) {
  const tone =
    rule.outcome === "FAILED" ? "text-danger-600" : rule.outcome === "PASSED" ? "text-success-600" : "text-03";
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-3">
      <div className="flex w-full items-center gap-3">
        <span className="min-w-0 flex-1 truncate font-mono text-mono-13 font-semibold text-01">
          {rule.ruleId}
        </span>
        <span className="shrink-0 text-body-xs text-03">{rule.type}</span>
        <span className={cn("w-[110px] shrink-0 text-right text-body-sm", tone)}>
          {ruleOutcomeLabel(rule.outcome)}
        </span>
        <span className="w-[64px] shrink-0 text-right font-mono text-mono-12 text-03">
          w {rule.weight}
        </span>
      </div>
      {rule.detail ? <p className="pl-0 text-body-13 text-03">{rule.detail}</p> : null}
    </div>
  );
}

/** Request/response: shown, scrubbed (hash only), or never recorded — three real states, not two. */
function BodyPane({
  title,
  body,
  digest,
}: {
  title: string;
  body: unknown;
  digest: string | null;
}) {
  if (body !== null && body !== undefined) {
    return <CodeBlock title={title} code={pretty(body)} />;
  }
  if (digest) {
    return (
      <div className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 p-4">
        <p className="text-label-sm text-01">{title} — scrubbed</p>
        <p className="text-body-13 text-03">
          The retention window passed and the body was deleted. Its digest still recomputes as
          part of the content hash below, so a local copy can still be checked.
        </p>
        <p className="font-mono text-mono-12 text-02">{digest}</p>
      </div>
    );
  }
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-01 bg-02 p-4">
      <p className="text-label-sm text-01">{title}</p>
      <p className="text-body-13 text-03">No {title} body was recorded for this call.</p>
    </div>
  );
}

export default function EvidencePackBrowserPage() {
  const params = useParams<{ bindingId: string; verdictId: string }>();
  const { bindingId, verdictId } = params;

  const evidenceQuery = useQuery<ProviderVerdictEvidence, ApiError>({
    queryKey: ["provider", "verdict-evidence", verdictId],
    queryFn: () => getProviderVerdictEvidence(verdictId),
    enabled: Boolean(verdictId),
    retry: 0,
    networkMode: "always",
  });

  const backHref = `/provider/bindings/${bindingId}/verdicts/${verdictId}`;

  if (evidenceQuery.isPending) {
    return (
      <div className="flex w-full items-center justify-center py-16">
        <p className="text-body-13 text-03">Loading evidence pack…</p>
      </div>
    );
  }

  const error = evidenceQuery.error;
  if (error) {
    if (error.code === "VERIFICATION_EVIDENCE_PACK_TAMPERED") {
      return (
        <>
          <Link
            href={backHref}
            className="flex w-fit items-center gap-1.5 text-label-13 text-03 hover:text-01"
          >
            <ArrowLeft aria-hidden="true" className="size-[14px]" />
            Back to verdict
          </Link>
          <EmptyState
            icon={<FileWarning aria-hidden="true" width={22} height={22} />}
            title="This evidence pack failed its own integrity check"
            description="The pack no longer hashes to the digest stored beside it. That is not something a caller did or can fix — it means the stored record was changed after it was sealed. Nothing is shown, because a pack that fails its own hash is not evidence. This has been logged; contact support with this verdict id if you need it resolved."
            className="max-w-none"
          />
        </>
      );
    }

    return (
      <>
        <Link
          href={backHref}
          className="flex w-fit items-center gap-1.5 text-label-13 text-03 hover:text-01"
        >
          <ArrowLeft aria-hidden="true" className="size-[14px]" />
          Back to verdict
        </Link>
        <EmptyState
          icon={<ShieldOff aria-hidden="true" width={22} height={22} />}
          title="No evidence pack for this verdict"
          description="This verdict has no sealed evidence pack to show — either it is not one this account served, or it predates evidence packs. Nothing here has been altered or withheld; there is simply nothing sealed to read."
          className="max-w-none"
        />
      </>
    );
  }

  const evidence = evidenceQuery.data;
  if (!evidence) return null;

  const checks = toStageChecks(evidence);
  const rulesStage = evidence.stageResults.find(
    (s) => s.stage === "DETERMINISTIC_RULES" && s.rules && s.rules.length > 0
  );
  const bodyState = evidence.integrity.bodyState;

  return (
    <>
      <header className="flex w-full flex-col items-start gap-3 tablet:flex-row tablet:items-center tablet:justify-between">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-1">
          <Link
            href={backHref}
            className="flex w-fit items-center gap-1.5 text-label-13 text-03 hover:text-01"
          >
            <ArrowLeft aria-hidden="true" className="size-[14px]" />
            Back to verdict
          </Link>
          <h1 className="truncate text-heading-sm text-01 tablet:text-heading-md">
            Evidence · {shortId(evidence.id)}
          </h1>
          <p className="font-mono text-mono-12 text-03 tablet:truncate">
            intent {shortId(evidence.intentId)} · tool {shortId(evidence.toolId)} · sealed{" "}
            {stampUtc(evidence.integrity.sealedAt)} UTC
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2.5">
          <Button
            variant="secondary"
            icon={<Download aria-hidden="true" />}
            onClick={() => downloadPack(evidence)}
          >
            Download pack
          </Button>
        </div>
      </header>

      {bodyState === "RAW" ? (
        <Banner
          tone="primary"
          title="Bodies available"
          description="Request and response are shown below in full. Bodies are retained for 72 hours after sealing; after that only their hashes remain, and the content hash below still lets you check a local copy."
        />
      ) : (
        <Banner
          tone="warning"
          title="Bodies scrubbed — retention window passed"
          description="The 72-hour retention window has passed since this pack was sealed. The request and response are gone; that is the normal case for an older call, not an error. Their hashes below still let you confirm a local copy matches what we recorded."
        />
      )}

      <section className="flex w-full flex-col items-start gap-4 tablet:flex-row">
        <Panel className="w-full min-w-0 flex-1">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Request / response</PanelTitle>
              <PanelDescription>
                the agent&apos;s arguments and the response this provider returned
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3 p-4 tablet:p-5">
            <BodyPane title="request" body={evidence.request} digest={evidence.bodyDigests.request} />
            <BodyPane
              title="response"
              body={evidence.response}
              digest={evidence.bodyDigests.response}
            />
          </PanelBody>
        </Panel>

        <Panel className="w-full tablet:w-[420px] tablet:shrink-0">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Attestation</PanelTitle>
              <PanelDescription>check a local copy against this hash</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-3 p-4 tablet:p-5">
            <p className="text-body-13 text-02">
              This hash covers the whole sealed evidence document — every stage, the sampling
              draw, the pinned policy and the body digests. Recompute it over your own copy of
              this call to confirm nothing here has changed since it was sealed.
            </p>
            <CodeBlock title="content hash · sha256" code={evidence.integrity.contentHash} />
            <div className="flex w-full items-center justify-between gap-3 py-1">
              <span className="text-body-xs text-03">sealed</span>
              <span className="font-mono text-mono-12 text-01">
                {stampUtc(evidence.integrity.sealedAt)} UTC
              </span>
            </div>
            <div className="flex w-full items-center justify-between gap-3 py-1">
              <span className="text-body-xs text-03">bodies</span>
              <span className="font-mono text-mono-12 text-01">
                {bodyState === "RAW" ? "available" : "hashes only"}
              </span>
            </div>
          </PanelBody>
        </Panel>
      </section>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Pipeline stages</PanelTitle>
            <PanelDescription>
              all four, always, in pipeline order — a stage that did not run reads as &quot;not
              reached&quot;, never as passed
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="px-4 tablet:px-5">
          <StageList checks={checks} />
        </PanelBody>
      </Panel>

      {rulesStage?.rules ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Deterministic rules</PanelTitle>
              <PanelDescription>
                the arithmetic behind the result quality rules score ({rulesStage.score ?? DASH})
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="gap-2 p-4 tablet:p-5">
            {rulesStage.rules.map((rule) => (
              <RuleRow key={rule.ruleId} rule={rule} />
            ))}
          </PanelBody>
        </Panel>
      ) : null}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Sampling</PanelTitle>
            <PanelDescription>the reproducible draw for the relevance judgement</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <SamplingExplainer
            rate={evidence.sampling.sampleDisplay ?? DASH}
          />
        </PanelBody>
      </Panel>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Policy as evaluated</PanelTitle>
            <PanelDescription>
              pinned at the exact version this call was judged under, not at today&apos;s version
            </PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="gap-3 p-4 tablet:p-5">
          {evidence.pinnedPolicy ? (
            <>
              <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-1">
                <span className="text-body-13 text-03">
                  policy <span className="font-mono text-mono-12 text-01">{evidence.pinnedPolicy.policyId}</span>{" "}
                  v{evidence.pinnedPolicy.policyVersion}
                </span>
                <span className="text-body-13 text-03">
                  lifecycle{" "}
                  <span className="font-mono text-mono-12 text-01">
                    {evidence.pinnedPolicy.lifecycle ?? DASH}
                  </span>
                </span>
              </div>
              <CodeBlock
                title="decision policy"
                code={pretty(evidence.pinnedPolicy.decisionDocument)}
              />
              {evidence.pinnedPolicy.verificationDocument ? (
                <CodeBlock
                  title="verification policy"
                  code={pretty(evidence.pinnedPolicy.verificationDocument)}
                />
              ) : (
                <p className="text-body-13 text-03">
                  No local verification policy ran for this call — only the decision policy
                  above applied.
                </p>
              )}
            </>
          ) : (
            <p className="text-body-13 text-03">
              This call has not been judged yet, so no policy is pinned.
            </p>
          )}
        </PanelBody>
      </Panel>
    </>
  );
}
