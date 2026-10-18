"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import { PreviewPanel, SchemaBlock, TextBlock } from "@/components/contracts/contract-fields";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { OPTIONAL_INPUT_HINT, OPTIONAL_OUTPUT_HINT, problemText } from "@/features/contracts/text";
import { livePreview, type ContractForm } from "@/features/operator/contract-editor";
import type { ToolContractVersion } from "@/interfaces/contracts";
import {
  discardProviderToolDraft,
  publishProviderToolVersion,
  saveProviderToolDraft,
  withdrawProviderToolReview,
  type ProviderTool,
} from "@/services/provider-tools.service";
import { toast } from "@/utils/toast";

import { contractBody, contractFormFor, providerToolErrorView, rulesTextOf, type PublishStepId } from "./model";
import { providerToolKeys } from "./queries";
import { ScreenFindings } from "./ui";

/**
 * Step 2, "Inputs & outputs": the summary, the description, what agents send
 * and get back (JSON Schema), optional fields, examples and the checks run on
 * every answer — the operator editor's blocks, with the bump shown live.
 * Publishing a private tool's draft is immediate; a shared tool's goes
 * through the publish checks; a listed tool's goes to review while the
 * approved version keeps serving.
 */

const SUMMARY_MAX = 200;

const RULES_HINT =
  'Optional. A JSON list of checks run on every answer, e.g. [{ "id": "has_posts", "type": "MIN_ARRAY_LENGTH", "path": "$.posts", "min": 1 }]. Types: MIN_ARRAY_LENGTH, REQUIRED_FIELDS, FRESHNESS, VALUE_RANGE, VALID_URL, NO_DUPLICATES. A failed check counts against quality; it does not refuse the call.';

function sameForm(a: ContractForm, b: ContractForm): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ContractStep({ tool, onStep }: { tool: ProviderTool; onStep: (step: PublishStepId) => void }) {
  const queryClient = useQueryClient();
  const initial = React.useMemo(() => contractFormFor(tool), [tool]);
  const initialRules = React.useMemo(() => rulesTextOf(tool.draft ?? tool.versions[0] ?? null), [tool]);
  const [form, setForm] = React.useState<ContractForm>(initial);
  const [rules, setRules] = React.useState(initialRules);
  const draftKey = `${tool.draft?.version ?? "none"}:${tool.draft?.publishedAt ?? ""}:${tool.updatedAt}`;
  React.useEffect(() => {
    setForm(initial);
    setRules(initialRules);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  const dirty = !sameForm(form, initial) || rules !== initialRules;
  const preview = React.useMemo(() => livePreview(form, tool.versions as unknown as ToolContractVersion[]), [form, tool.versions]);
  const built = React.useMemo(() => contractBody(form, rules), [form, rules]);
  const frozen = Boolean(tool.draft?.inReview) || tool.review.status === "PENDING";
  const listed = tool.visibility === "LISTED" || tool.review.approvedVersion !== null;
  const firstVersion = tool.currentVersion === null;

  const store = (updated: ProviderTool) => {
    queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: providerToolKeys.gate(updated.id) });
    void queryClient.invalidateQueries({ queryKey: providerToolKeys.list });
  };

  const save = useMutation({
    mutationFn: () => saveProviderToolDraft(tool.id, built.body!),
    onSuccess: (updated) => {
      store(updated);
      const findings = updated.draft?.screen.length ?? 0;
      if (findings > 0) toast.error(`Saved, but the safety screen found ${findings} thing${findings === 1 ? "" : "s"} to fix.`);
      else toast.success("Draft saved");
    },
  });
  const publish = useMutation({
    mutationFn: async () => {
      let current = tool;
      if (dirty || !current.draft) current = await saveProviderToolDraft(tool.id, built.body!);
      if (!current.draft) throw new Error("There is no draft to publish.");
      return publishProviderToolVersion(tool.id, current.draft.version);
    },
    onSuccess: (updated) => {
      store(updated);
      if (updated.review.status === "PENDING") toast.success("Sent for review. The approved version keeps serving until it is approved.");
      else toast.success(`v${updated.currentSemver ?? ""} is published`);
      if (firstVersion) onStep("connect");
    },
    onError: (error) => {
      const view = providerToolErrorView(error);
      if (view.gateFailed) {
        void queryClient.invalidateQueries({ queryKey: providerToolKeys.gate(tool.id) });
        toast.error("Not published: some checks are not met. Step 3 shows what to fix.");
        onStep("connect");
      }
    },
  });
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const discard = useMutation({
    mutationFn: () => discardProviderToolDraft(tool.id),
    onSuccess: (updated) => {
      setConfirmDiscard(false);
      store(updated);
    },
  });
  const withdraw = useMutation({ mutationFn: () => withdrawProviderToolReview(tool.id), onSuccess: store });

  const set = <K extends keyof ContractForm>(field: K, value: ContractForm[K]) => setForm((f) => ({ ...f, [field]: value }));
  const toggle = (field: "optionalInputFields" | "optionalOutputFields", name: string, on: boolean) =>
    setForm((f) => ({ ...f, [field]: on ? [...new Set([...f[field], name])] : f[field].filter((n) => n !== name) }));

  const summaryError = form.summary.length > SUMMARY_MAX ? `At most ${SUMMARY_MAX} characters.` : /[\r\n]/.test(form.summary) ? "Keep it on one line." : undefined;
  const problems = preview.problems;
  const nothingToPublish = !dirty && !tool.draft;
  const publishBlock = frozen
    ? "A review is pending."
    : built.body === null
      ? "Fix the JSON first."
      : problems.length > 0
        ? `Fix first: ${problems[0]}`
        : nothingToPublish
          ? "Change something first."
          : null;
  const publishLabel = listed ? `Submit v${preview.nextSemver} for review` : firstVersion ? "Publish v1.0.0" : `Publish v${preview.nextSemver}`;
  const error = save.error ?? publish.error ?? discard.error ?? withdraw.error;
  const errorView = error ? providerToolErrorView(error) : null;
  const serverFindings = tool.draft?.screen ?? [];
  const serverProblems = (tool.draft?.problems ?? []).map(problemText);

  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4" data-testid="contract-step">
      <header className="flex flex-col gap-1">
        <h2 className="text-label-md text-01">{tool.draft ? `Draft of v${preview.nextSemver}` : firstVersion ? "What agents send and get back" : "Change inputs & outputs"}</h2>
        <p className="text-body-13 text-02">
          {listed
            ? "A change is reviewed before it serves; the approved version keeps serving until then."
            : tool.visibility === "UNLISTED"
              ? "Publishing goes through the publish checks again."
              : "Only your team can see it until you share it in step 4."}
          {tool.draft?.publishedAt ? null : tool.draft ? (
            <>
              {" "}
              Draft saved <UtcTime value={tool.updatedAt} midSentence />.
            </>
          ) : null}
          {dirty ? <span className="text-warning-700"> Unsaved changes.</span> : null}
        </p>
        {frozen ? (
          <div className="flex flex-col gap-2 rounded-lg border border-primary-20 bg-primary-10 px-3 py-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
            <p className="text-body-13 text-01">
              {tool.review.reviewSemver ? `v${tool.review.reviewSemver} is in review` : "A review is pending"}
              {tool.review.submittedAt ? (
                <>
                  {" "}
                  since <UtcTime value={tool.review.submittedAt} midSentence />
                </>
              ) : null}
              . What it covers can&apos;t change until it is decided.
            </p>
            <Button variant="secondary" size="sm" className="touch-target" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
              Withdraw the review to edit
            </Button>
          </div>
        ) : null}
        {tool.review.note && (tool.review.state === "REJECTED" || tool.review.state === "CHANGES_REJECTED") ? (
          <p className="rounded-lg border border-warning-20 bg-warning-10 px-3 py-2.5 text-body-13 text-01 [overflow-wrap:anywhere]">
            <span className="text-label-13">The reviewer asked:</span> {tool.review.note}
          </p>
        ) : null}
      </header>

      <Field
        label="Summary"
        value={form.summary}
        onChange={(e) => set("summary", e.target.value)}
        disabled={frozen}
        suffix={`${form.summary.length}/${SUMMARY_MAX}`}
        hint="One line. It is the only text agents see in their tool list."
        error={summaryError}
        className="font-sans"
      />
      <TextBlock label="Description" value={form.description} onChange={(v) => set("description", v)} disabled={frozen} rows={4} hint="The full documentation. Agents read it when they ask about the tool, and your public page shows it." />
      <SchemaBlock
        side="input"
        label="What agents send (input schema)"
        hint='A JSON Schema with "type": "object" and its fields under "properties". Never ask for a key or password: keep those in your endpoint’s authentication.'
        text={form.inputSchema}
        onText={(v) => set("inputSchema", v)}
        error={built.errors.inputSchema}
        optional={form.optionalInputFields}
        onToggle={(name, on) => toggle("optionalInputFields", name, on)}
        optionalHint={OPTIONAL_INPUT_HINT}
        disabled={frozen}
      />
      <SchemaBlock
        side="output"
        label="What your API returns (output schema)"
        hint='Every output field is either in "required" or ticked as optional below. An answer that breaks it is refunded.'
        text={form.outputSchema}
        onText={(v) => set("outputSchema", v)}
        error={built.errors.outputSchema}
        optional={form.optionalOutputFields}
        onToggle={(name, on) => toggle("optionalOutputFields", name, on)}
        optionalHint={OPTIONAL_OUTPUT_HINT}
        disabled={frozen}
      />
      <TextBlock
        label="Examples (optional)"
        value={form.examples}
        onChange={(v) => set("examples", v)}
        disabled={frozen}
        rows={5}
        mono
        hint='A JSON list, up to 10: [{ "title": "Posts about rain", "arguments": { … }, "result": { … } }]. Reviewers run them.'
        error={built.errors.examples}
      />
      <TextBlock label="Checks on every answer (optional)" value={rules} onChange={setRules} disabled={frozen} rows={3} mono hint={RULES_HINT} error={built.errors.rules} />
      {!firstVersion ? (
        <TextBlock label="What changed (changelog)" value={form.changelog} onChange={(v) => set("changelog", v)} disabled={frozen} rows={2} hint="One or two sentences agents read in their update notices." />
      ) : null}

      <PreviewPanel preview={preview} />

      {serverFindings.length > 0 || serverProblems.length > 0 ? (
        <section aria-label="What the server found in the saved draft" className="flex flex-col gap-1.5">
          <p className="text-label-13 text-danger-700">The saved draft can&apos;t be published yet</p>
          {serverProblems.length > 0 ? (
            <ul className="list-disc pl-4 text-body-13 text-danger-700">
              {serverProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <ScreenFindings findings={serverFindings} />
        </section>
      ) : null}

      {errorView && !errorView.gateFailed ? (
        <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
          <p>{errorView.text}</p>
          {errorView.problems.length > 0 ? (
            <ul className="list-disc pl-4">
              {errorView.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-start tablet:justify-between">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={frozen || !dirty || built.body === null} loading={save.isPending} onClick={() => save.mutate()}>
            Save draft
          </Button>
          {tool.draft && !firstVersion && !confirmDiscard ? (
            <Button variant="ghost" disabled={frozen} onClick={() => setConfirmDiscard(true)}>
              Discard draft
            </Button>
          ) : null}
          {tool.draft && !firstVersion && confirmDiscard ? (
            <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Discard the draft?">
              <span className="text-body-13 text-02">Discard the draft? It can&apos;t be brought back.</span>
              <Button variant="danger" loading={discard.isPending} onClick={() => discard.mutate()}>
                Discard
              </Button>
              <Button variant="ghost" disabled={discard.isPending} onClick={() => setConfirmDiscard(false)}>
                Keep it
              </Button>
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1 tablet:items-end">
          <Button disabled={publishBlock !== null} loading={publish.isPending} onClick={() => publish.mutate()}>
            {publishLabel}
          </Button>
          {publishBlock ? <span className="max-w-[360px] text-body-xs text-03 tablet:text-right">{publishBlock}</span> : null}
          {!publishBlock && firstVersion ? <span className="text-body-xs text-03">Only your team can call it until step 4.</span> : null}
        </div>
      </div>
      {!firstVersion && !tool.draft && !dirty ? (
        <Button variant="ghost" className="self-start" onClick={() => onStep("connect")}>
          Nothing to change? Continue to step 3
        </Button>
      ) : null}
    </section>
  );
}
