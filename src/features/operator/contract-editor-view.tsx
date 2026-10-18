"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, Clock, Lightbulb } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { PageState } from "@/components/patterns/page-state";
import { UtcTime } from "@/components/patterns/utc-time";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { PreviewPanel, SchemaBlock, TextBlock } from "@/components/contracts/contract-fields";
import {
  OPTIONAL_INPUT_HINT,
  OPTIONAL_OUTPUT_HINT,
  STATUS_LABEL,
  VERSION_NUMBER_HINT,
  changeText,
  sunsetDay,
} from "@/features/contracts/text";
import type { OperatorTool } from "@/interfaces/contracts";
import { ApiError } from "@/libs/ApiClient";
import { discardContractDraft, getOperatorTool, getOperatorToolRequest, listOperatorTools, saveContractDraft } from "@/services/operator-contracts.service";
import { listApprovals } from "@/services/operator.service";
import { cn } from "@/utils";
import { routes } from "@/libs/routes";
import { toast } from "@/utils/toast";

import {
  contractErrorMessage,
  formFor,
  isDirty,
  livePreview,
  majorRows,
  mayEditContracts,
  newestVersion,
  parseForm,
  pendingCurrentVersion,
  pendingFor,
  suggestion,
  type ContractForm,
  type MajorRow,
} from "./contract-editor";
import { DeprecateSheet, MakeCurrentSheet, PublishSheet, type PublishPlan } from "./contract-sheets";
import { eligibleApprovers } from "./inbox";
import { mayTakeDownTools } from "./provider-tool-review";
import { TakeDownButton, takeDownable } from "./provider-tool-ui";
import { ResultCard } from "./result-card";
import { useOperatorSession } from "./session-context";
import { approvalHref, approverPhrase, sentForApproval, type TwoPersonAnswer } from "./two-person";
import { useOperatorDirectory } from "./use-operator-lookups";

/**
 * One standard tool in the operator console (design spec §7.5 "Editor"):
 *
 *  1. what is waiting for a second person, and the editor's suggestion to
 *     move the default version (§7.3);
 *  2. the versions agents can use, one row per major, with how many
 *     providers can serve each and its two actions (make it the default,
 *     deprecate it);
 *  3. the published versions with their changelog;
 *  4. the draft: summary, description, schemas, optional fields, examples
 *     and changelog, with the diff and the bump it implies shown live.
 *
 * Every action that reaches traffic has a confirm step that names it.
 */

const SUMMARY_MAX = 200;

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-label-xs", className)}>{children}</span>;
}

function statusChipClass(status: string): string {
  if (status === "DEPRECATED") return "bg-warning-10 text-warning-700";
  if (status === "RETIRED") return "bg-danger-10 text-danger-700";
  return "bg-03 text-02";
}

export function ContractEditorScreen({ toolId, fromRequest = "" }: { toolId: string; fromRequest?: string }) {
  const me = useOperatorSession();
  const canEdit = mayEditContracts(me.roles);
  const directory = useOperatorDirectory();
  const queryClient = useQueryClient();

  const toolQuery = useQuery({ queryKey: ["operator", "tools", toolId], queryFn: () => getOperatorTool(toolId), retry: 0, enabled: toolId !== "" });
  const listQuery = useQuery({ queryKey: ["operator", "tools", "list"], queryFn: listOperatorTools, retry: 0 });
  const pendingQuery = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
    refetchInterval: 30_000,
    retry: 0,
  });

  // A tool created from a tool request starts its first version with the request's words.
  const requestQuery = useQuery({
    queryKey: ["operator", "tool-requests", fromRequest],
    queryFn: () => getOperatorToolRequest(fromRequest),
    enabled: fromRequest !== "",
    retry: 0,
  });
  const seed = React.useMemo(
    () => (requestQuery.data ? { summary: requestQuery.data.title, description: requestQuery.data.description } : null),
    [requestQuery.data],
  );
  const [result, setResult] = React.useState<React.ReactNode>(null);
  const [publishPlan, setPublishPlan] = React.useState<PublishPlan | null>(null);
  const [makeCurrent, setMakeCurrent] = React.useState<MajorRow | null>(null);
  const [deprecating, setDeprecating] = React.useState<MajorRow | null>(null);

  // Whoever last saved the draft can't approve its publish (two-person rule), so they are not offered.
  const editedBy = toolQuery.data?.draft?.editedBy ?? null;
  const approvers = React.useMemo(
    () =>
      directory.isPending || directory.isError
        ? undefined
        : eligibleApprovers("P-10", directory.operators.filter((op) => op.id !== editedBy), me.id),
    [directory.isPending, directory.isError, directory.operators, me.id, editedBy],
  );

  if (toolQuery.isLoading) return <PageState kind="loading" rows={6} label="Loading the tool" />;
  if (toolQuery.isError || !toolQuery.data) {
    const notFound = toolQuery.error instanceof ApiError && toolQuery.error.status === 404;
    return notFound ? (
      <PageState kind="empty" title="No such tool" description="It may have been removed, or the link is wrong." action={{ label: "Back to tools", href: "/operator/tools" }} />
    ) : (
      <PageState kind="error" description="The tool could not be loaded." onRetry={() => void toolQuery.refetch()} code={toolQuery.error instanceof ApiError ? toolQuery.error.code : null} />
    );
  }
  const tool = toolQuery.data;
  const pending = pendingFor(tool.id, pendingQuery.data?.items ?? []);
  const current = tool.versions.find((v) => v.version === tool.currentVersion) ?? null;
  const rows = majorRows(tool);
  const suggested = suggestion(tool);
  const pendingTarget = pendingCurrentVersion(pending.current);

  const onQueued = (answer: TwoPersonAnswer<OperatorTool>, label: string, code: "P-10" | "P-11") => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
    if (answer.kind === "queued") {
      const needs = approverPhrase(code, me.roles);
      const names = directory.isPending ? undefined : eligibleApprovers(code, directory.operators, me.id);
      const sent = sentForApproval(label, names, needs, answer.approval.expiresAt);
      setResult(
        <div className="flex w-full flex-col gap-2">
          <ResultCard tone="queued" title={sent.title} next={sent.next} link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }} onDismiss={() => setResult(null)} />
          <ApprovalFooter needs={needs} approvers={names} link={approvalHref(answer.approval.approvalId)} expiresAt={answer.approval.expiresAt} />
        </div>,
      );
    } else {
      queryClient.setQueryData(["operator", "tools", tool.id], answer.result);
      setResult(<ResultCard title={`${label} is done`} next="Providers, agents and the catalogue see it now." onDismiss={() => setResult(null)} />);
    }
  };

  return (
    <>
      <div className="flex w-full flex-col gap-2">
        <Link href="/operator/tools" className="hit-area inline-flex items-center gap-1.5 self-start text-label-13 text-02 hover:text-01">
          <ArrowLeft aria-hidden="true" className="size-4" /> All tools
        </Link>
        <header className="flex w-full flex-col gap-1">
          <h1 className="font-mono text-heading-md text-01 [overflow-wrap:anywhere]">{tool.name}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-02">
            {current ? <span>Agents get v{current.semver} by default</span> : <span>No version published yet</span>}
            <span aria-hidden="true">·</span>
            <span>{tool.category}</span>
            {tool.kind === "PROVIDER" ? (
              <>
                <span aria-hidden="true">·</span>
                <span>One maker&apos;s API</span>
              </>
            ) : null}
          </p>
        </header>
      </div>

      {result}

      {takeDownable(tool) && mayTakeDownTools(me.roles) ? (
        <section aria-labelledby="abuse-title" className="flex w-full flex-col gap-2 rounded-xl border border-danger-20 bg-danger-10 px-4 py-3.5">
          <h2 id="abuse-title" className="text-label-md text-01">
            If it is abuse
          </h2>
          <div className="flex flex-col gap-2 tablet:flex-row tablet:items-center tablet:justify-between">
            <p className="text-body-13 text-02">
              A takedown removes this provider tool from every view at once; a second operator confirms within 72 hours.{" "}
              <Link href={routes.operatorReview(tool.id)} className="text-primary-600 hover:underline">
                Read what it serves first
              </Link>
            </p>
            <TakeDownButton
              tool={tool}
              onDone={() => {
                toast.success(`${tool.name} is down. A second operator confirms it under Takedowns.`);
                void queryClient.invalidateQueries({ queryKey: ["operator", "tools"] });
                void queryClient.invalidateQueries({ queryKey: ["operator", "cutoffs"] });
              }}
            />
          </div>
        </section>
      ) : null}

      {pending.publish ? (
        <WaitingLine
          text={`Publishing the draft waits for ${approverPhrase("P-10", me.roles)}. Until then the draft can't change.`}
          by={directory.nameOf(pending.publish.requestedBy)}
          at={pending.publish.createdAt}
          href={approvalHref(pending.publish.id)}
        />
      ) : null}
      {pending.current ? (
        <WaitingLine
          text={`Making v${tool.versions.find((v) => v.version === pendingTarget)?.semver ?? "?"} the default waits for ${approverPhrase("P-11", me.roles)}.`}
          by={directory.nameOf(pending.current.requestedBy)}
          at={pending.current.createdAt}
          href={approvalHref(pending.current.id)}
        />
      ) : null}

      {suggested && canEdit && !pending.current ? (
        <div role="status" className="flex w-full flex-col gap-2 rounded-xl border border-primary-20 bg-primary-10 px-4 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
          <p className="flex items-start gap-2 text-body-13 text-01">
            <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary-600" />
            {suggested.text}
          </p>
          <Button
            variant="secondary"
            className="self-start tablet:self-auto"
            onClick={() => setMakeCurrent(rows.find((r) => r.major === suggested.version.major) ?? null)}
          >
            Make v{suggested.version.semver} the default
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="majors-title" className="flex w-full flex-col gap-2">
        <h2 id="majors-title" className="text-label-md text-01">
          Versions agents can use
        </h2>
        <p className="text-body-xs text-03">{VERSION_NUMBER_HINT}</p>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-01 bg-01 px-4 py-3 text-body-13 text-02">Nothing is published yet. Write the first version below and send it for approval.</p>
        ) : (
          <ul className="flex w-full flex-col divide-y divide-01 rounded-xl border border-01 bg-01">
            {rows.map((row) => (
              <MajorLine
                key={row.major}
                row={row}
                canEdit={canEdit}
                currentPending={pending.current !== null}
                onMakeCurrent={() => setMakeCurrent(row)}
                onDeprecate={() => setDeprecating(row)}
                multipleMajors={rows.length > 1}
              />
            ))}
          </ul>
        )}
      </section>

      {tool.versions.length > 0 ? <PublishedVersions tool={tool} /> : null}

      <DraftEditor
        key={tool.id}
        tool={tool}
        canEdit={canEdit}
        frozen={pending.publish !== null}
        frozenHref={pending.publish ? approvalHref(pending.publish.id) : null}
        editorName={editedBy ? (editedBy === me.id ? "you" : directory.nameOf(editedBy)) : null}
        seed={tool.versions.length === 0 && !tool.draft ? seed : null}
        onPublish={setPublishPlan}
      />

      <PublishSheet
        tool={tool}
        plan={publishPlan}
        approvers={approvers}
        onClose={() => setPublishPlan(null)}
        onQueued={(answer, label) => onQueued(answer, label, "P-10")}
      />
      <MakeCurrentSheet
        tool={tool}
        target={makeCurrent?.makeCurrentVersion ?? null}
        current={current}
        eligible={makeCurrent?.eligible ?? 0}
        approvers={directory.isPending ? undefined : eligibleApprovers("P-11", directory.operators, me.id)}
        onClose={() => setMakeCurrent(null)}
        onQueued={(answer, label) => onQueued(answer, label, "P-11")}
      />
      <DeprecateSheet
        tool={tool}
        row={deprecating}
        tools={listQuery.data?.tools ?? []}
        onClose={() => setDeprecating(null)}
        onDone={(text) => setResult(<ResultCard title={text} onDismiss={() => setResult(null)} />)}
      />
    </>
  );
}

function WaitingLine({ text, by, at, href }: { text: string; by: string; at: string; href: string }) {
  return (
    <div role="status" className="flex w-full flex-col gap-1 rounded-xl border border-warning-20 bg-warning-10 px-4 py-3 text-body-13 text-02">
      <p className="flex items-start gap-2 text-label-13 text-01">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
        {text}
      </p>
      <p>
        {by} asked <UtcTime value={at} midSentence />.{" "}
        <Link href={href} className="touch-target inline-flex items-center text-primary-600 hover:underline">
          Open the request
        </Link>
      </p>
    </div>
  );
}

function MajorLine({
  row,
  canEdit,
  currentPending,
  onMakeCurrent,
  onDeprecate,
  multipleMajors,
}: {
  row: MajorRow;
  canEdit: boolean;
  currentPending: boolean;
  onMakeCurrent: () => void;
  onDeprecate: () => void;
  multipleMajors: boolean;
}) {
  return (
    <li className="flex w-full flex-col gap-2 px-4 py-3 tablet:flex-row tablet:items-center tablet:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="text-label-sm text-01">{row.label}</span>
          <span className="font-mono text-mono-12 text-03">newest {row.latestSemver}</span>
          {row.isCurrent ? <Chip className="bg-success-10 text-success-700">Default for agents</Chip> : null}
          {row.status !== "ACTIVE" ? <Chip className={statusChipClass(row.status)}>{row.statusText}</Chip> : null}
        </p>
        <p className="text-body-13 text-02">
          {row.readyText}
          {row.active !== row.eligible && row.status !== "RETIRED" ? ` · ${row.active} live provider${row.active === 1 ? "" : "s"} list it` : ""}
          {row.sunsetText ? ` · ${row.sunsetText}` : ""}
        </p>
        {row.deprecateBlocked && canEdit ? <p className="text-body-xs text-03">{row.deprecateBlocked}</p> : null}
      </div>
      {canEdit ? (
        <div className="flex flex-wrap gap-2">
          {row.makeCurrentVersion && row.status === "ACTIVE" ? (
            <Button variant="secondary" disabled={currentPending} onClick={onMakeCurrent} title={currentPending ? "A change of the default is already waiting for approval" : undefined}>
              Make v{row.makeCurrentVersion.semver} the default
            </Button>
          ) : null}
          {row.deprecateVersion && row.status === "ACTIVE" ? (
            <Button variant="ghost" onClick={onDeprecate}>
              Deprecate {row.label}…
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function PublishedVersions({ tool }: { tool: OperatorTool }) {
  return (
    <details className="w-full rounded-xl border border-01 bg-01 [&_summary::-webkit-details-marker]:hidden">
      <summary className="group flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-label-md text-01">
        <span>
          Published versions <span className="text-body-13 tabular-nums text-03">({tool.versions.length})</span>
        </span>
        <span className="inline-flex items-center gap-1 text-label-13 text-primary-600">
          <span className="group-open:hidden">Show</span>
          <span className="hidden group-open:inline">Hide</span>
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <ol className="flex flex-col divide-y divide-01 border-t border-01">
        {tool.versions.map((v) => (
          <li key={v.version} className="flex flex-col gap-1 px-4 py-3">
            <p className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-mono-13 text-01">v{v.semver}</span>
              {v.isCurrent ? <Chip className="bg-success-10 text-success-700">Default for agents</Chip> : null}
              {v.status !== "ACTIVE" ? <Chip className={statusChipClass(v.status)}>{STATUS_LABEL[v.status]}</Chip> : null}
              {v.publishedAt ? (
                <span className="text-body-xs text-03">
                  published <UtcTime value={v.publishedAt} dateOnly />
                </span>
              ) : null}
              {v.sunsetAt ? <span className="text-body-xs text-03">· stops {sunsetDay(v.sunsetAt)} (UTC)</span> : null}
            </p>
            {v.changelog ? <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{v.changelog}</p> : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/* ------------------------------------------------------------------- draft */

function draftKey(tool: OperatorTool): string {
  return `${tool.id}:${tool.draft ? `${tool.draft.version}@${tool.draft.updatedAt}` : "none"}:${tool.versions.map((v) => v.version).join(",")}`;
}

function DraftEditor({
  tool,
  canEdit,
  frozen,
  frozenHref,
  editorName,
  seed,
  onPublish,
}: {
  tool: OperatorTool;
  canEdit: boolean;
  frozen: boolean;
  frozenHref: string | null;
  /** Who last saved the draft ("you" for the signed-in operator); they can't approve its publish. */
  editorName: string | null;
  /** A first version's summary and description, from the tool request it came from. */
  seed: { summary: string; description: string } | null;
  onPublish: (plan: PublishPlan) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState<ContractForm>(() => formFor(tool, seed));
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  const key = draftKey(tool);
  // A saved, discarded or published draft resets the form to what the server holds.
  React.useEffect(() => {
    setForm(formFor(tool, seed));
    setConfirmDiscard(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, seed?.summary]);

  const dirty = isDirty(form, tool);
  const preview = React.useMemo(() => livePreview(form, tool.versions), [form, tool.versions]);
  const parsed = React.useMemo(() => parseForm(form), [form]);
  const locked = !canEdit || frozen;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => saveContractDraft(tool.id, parsed.body!),
    onSuccess: (updated) => queryClient.setQueryData(["operator", "tools", tool.id], updated),
  });
  const discard = useMutation({
    mutationFn: () => discardContractDraft(tool.id),
    onSuccess: (updated) => queryClient.setQueryData(["operator", "tools", tool.id], updated),
  });

  const set = <K extends keyof ContractForm>(field: K, value: ContractForm[K]) => setForm((f) => ({ ...f, [field]: value }));
  const toggle = (field: "optionalInputFields" | "optionalOutputFields", name: string, on: boolean) =>
    setForm((f) => ({ ...f, [field]: on ? [...new Set([...f[field], name])] : f[field].filter((n) => n !== name) }));

  const publishBlock = frozen
    ? "A publish is already waiting for approval."
    : preview.problems.length > 0
      ? `Fix first: ${preview.problems[0]}${preview.problems.length > 1 ? ` (and ${preview.problems.length - 1} more below)` : ""}`
      : !tool.draft && !dirty
        ? "Change something first."
        : null;
  const startPublish = () => {
    if (publishBlock) return;
    const draft = tool.draft;
    onPublish({
      version: draft?.version ?? 0,
      nextSemver: preview.nextSemver,
      bump: preview.bump,
      changes: preview.changes,
      firstVersion: preview.firstVersion,
      saveFirst: dirty || !draft ? parsed.body : null,
    });
  };

  const published = tool.versions.filter((v) => v.status !== "RETIRED");
  const summaryError = form.summary.length > SUMMARY_MAX ? `At most ${SUMMARY_MAX} characters.` : /[\r\n]/.test(form.summary) ? "Keep it on one line." : undefined;

  return (
    <section aria-labelledby="draft-title" className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4">
      <header className="flex w-full flex-col gap-1">
        <h2 id="draft-title" className="text-label-md text-01">
          {tool.draft ? `Draft of v${tool.draft.nextSemver}` : tool.versions.length > 0 ? "Change the contract" : "First version"}
        </h2>
        <p className="text-body-13 text-02">
          {tool.draft ? (
            <>
              Saved <UtcTime value={tool.draft.updatedAt} midSentence />
              {editorName ? ` by ${editorName}` : ""}. Nobody sees a draft until it is published
              {editorName ? `, and ${editorName === "you" ? "you" : editorName} can't be the one who approves it` : ""}.
            </>
          ) : tool.versions.length > 0 ? (
            "Edit below to start a draft. Nobody sees it until it is published."
          ) : (
            "Write what agents send and get back. Nobody sees it until it is published."
          )}
          {dirty ? <span className="text-warning-700"> Unsaved changes.</span> : null}
        </p>
        {preview.changes.length > 0 && preview.baseSemver ? (
          <p className="rounded-lg bg-02 px-3 py-2 text-body-13 text-01 [overflow-wrap:anywhere]">
            <span className="text-label-13">
              v{preview.baseSemver} → v{preview.nextSemver}:
            </span>{" "}
            {changeText(preview.changes[0]!)}
            {preview.changes.length > 1 ? ` and ${preview.changes.length - 1} more (see below)` : ""}
          </p>
        ) : null}
        {frozen ? <p className="text-body-13 text-warning-700">The draft is locked while its publish waits for approval. Reject that request in Approvals to edit it.</p> : null}
        {!canEdit ? <p className="text-body-13 text-03">Read only: editing needs the Policy author or Policy approver role.</p> : null}
      </header>

      {published.length > 1 ? (
        <Select
          label="Changes from"
          value={String(form.baseVersion ?? newestVersion(tool.versions)?.version ?? "")}
          onChange={(e) => set("baseVersion", Number(e.target.value))}
          disabled={locked || tool.draft !== null}
          hint={tool.draft ? "Discard the draft to start from another version." : "The version this draft changes. A breaking change always starts from the newest version."}
        >
          {published.map((v) => (
            <option key={v.version} value={v.version}>
              v{v.semver}
              {v.isCurrent ? " (default)" : ""}
              {v.status === "DEPRECATED" ? " (deprecated)" : ""}
            </option>
          ))}
        </Select>
      ) : null}

      <Field
        label="Summary"
        value={form.summary}
        onChange={(e) => set("summary", e.target.value)}
        disabled={locked}
        suffix={`${form.summary.length}/${SUMMARY_MAX}`}
        hint="One line. It is the only text agents see in their tool list, so say what it does and when to use it."
        error={summaryError}
        className="font-sans"
      />
      <TextBlock label="Description" value={form.description} onChange={(v) => set("description", v)} disabled={locked} rows={4} hint="The full documentation. Agents read it when they ask about the tool, and the catalogue shows it." />

      <SchemaBlock
        side="input"
        label="What agents send (input schema)"
        hint='A JSON Schema with "type": "object" and its fields under "properties". Fields in "required" must always be sent.'
        text={form.inputSchema}
        onText={(v) => set("inputSchema", v)}
        error={parsed.jsonErrors.inputSchema}
        optional={form.optionalInputFields}
        onToggle={(name, on) => toggle("optionalInputFields", name, on)}
        optionalHint={OPTIONAL_INPUT_HINT}
        disabled={locked}
      />
      <SchemaBlock
        side="output"
        label="What providers return (output schema)"
        hint='Every output field is either in "required" (every provider returns it) or ticked as optional below.'
        text={form.outputSchema}
        onText={(v) => set("outputSchema", v)}
        error={parsed.jsonErrors.outputSchema}
        optional={form.optionalOutputFields}
        onToggle={(name, on) => toggle("optionalOutputFields", name, on)}
        optionalHint={OPTIONAL_OUTPUT_HINT}
        disabled={locked}
      />
      <TextBlock
        label="Examples (optional)"
        value={form.examples}
        onChange={(v) => set("examples", v)}
        disabled={locked}
        rows={5}
        mono
        hint='A JSON list, up to 10: [{ "title": "Weather in Lisbon", "arguments": { … }, "result": { … } }].'
        error={parsed.jsonErrors.examples}
      />
      <TextBlock
        label="What changed (changelog)"
        value={form.changelog}
        onChange={(v) => set("changelog", v)}
        disabled={locked}
        rows={2}
        hint="One or two sentences. Providers and agents read it in the catalogue and in their notices."
      />

      {/* What publishing would do, and what to fix first: only for someone who can publish. */}
      {canEdit ? <PreviewPanel preview={preview} /> : null}

      <div className="flex w-full flex-col gap-2">
        {save.error || discard.error ? <SaveError error={save.error ?? discard.error} /> : null}
        {canEdit ? (
          <div className="flex w-full flex-col gap-2 tablet:flex-row tablet:items-center tablet:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={locked || !dirty || parsed.body === null} loading={save.isPending} onClick={() => save.mutate()}>
                Save draft
              </Button>
              {tool.draft && !confirmDiscard ? (
                <Button variant="ghost" disabled={locked} onClick={() => setConfirmDiscard(true)}>
                  Discard draft
                </Button>
              ) : null}
              {tool.draft && confirmDiscard ? (
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
              <Button disabled={publishBlock !== null || locked} onClick={startPublish} aria-describedby="publish-why">
                {preview.firstVersion ? "Publish first version…" : preview.bump ? `Publish v${preview.nextSemver}…` : "Publish…"}
              </Button>
              {frozen && canEdit ? (
                <span id="publish-why" className="max-w-[360px] text-body-xs text-warning-700 tablet:text-right">
                  Locked: a publish of this draft is waiting for a second person.{" "}
                  <Link href={frozenHref ?? "/operator/approvals"} className="touch-target inline-flex items-center text-primary-600 hover:underline">
                    Open it in Approvals
                  </Link>
                </span>
              ) : publishBlock && !locked ? (
                <span id="publish-why" className="max-w-[360px] text-body-xs text-03 tablet:text-right">{publishBlock}</span>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SaveError({ error }: { error: unknown }) {
  const message = contractErrorMessage(error);
  return (
    <div role="alert" className="flex flex-col gap-1 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
      <p>{message.text}</p>
      {message.problems.length > 0 ? (
        <ul className="list-disc pl-4">
          {message.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
