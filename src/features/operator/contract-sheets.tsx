"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUpCircle, Ban, Bell, CalendarClock, Eye, GitBranch, History, Lock, MessageSquare, Users } from "lucide-react";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { bumpEffect, changeText, earliestSunsetDay, publishLabel, sunsetDay, sunsetDayFrom, sunsetInstant, sunsetProblem } from "@/features/contracts/text";
import type { ContractChange, OperatorTool, OperatorToolSummary, VersionBump } from "@/interfaces/contracts";
import {
  answerOperatorToolRequest,
  createStandardTool,
  deprecateContractVersion,
  moveCurrentVersion,
  publishContractVersion,
  saveContractDraft,
  type OperatorToolRequestRow,
} from "@/services/operator-contracts.service";
import type { SaveContractDraftBody, ToolContractVersion } from "@/interfaces/contracts";
import type { TwoPersonAnswer } from "./two-person";
import { approverPhrase } from "./two-person";
import { categoryProblem, contractErrorMessage, suggestToolName, toolNameProblem, type MajorRow } from "./contract-editor";
import { CONTRACT_REASONS, DEPRECATE_REASONS } from "./reasons";
import { useOperatorSession } from "./session-context";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "./sheet-footer";
import { WhatHappens, type WhatHappensLine } from "./what-happens";

/**
 * The editor's confirm steps. Each names exactly what it does — the bump and
 * the version number on Publish, the version on "Make current", the major and
 * the day on Deprecate — and what happens to whom, before anything is sent.
 * Publish and "Make current" go to a Policy approver (two-person); the answer
 * is a request waiting in the approvals inbox, never "done".
 */

export const NOTE_MIN = 20;
export const NOTE_MAX = 1000;

function useReasonForm(preset = "") {
  const [reason, setReason] = React.useState(preset);
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  const check = (): boolean => {
    const next = {
      reason: reason ? undefined : "Pick a reason.",
      note: note.trim().length < NOTE_MIN ? `Write at least ${NOTE_MIN} characters, so the approver knows why.` : note.length > NOTE_MAX ? `Keep it under ${NOTE_MAX} characters.` : undefined,
    };
    setErrors(next);
    return !next.reason && !next.note;
  };
  const reset = () => {
    setReason(preset);
    setNote("");
    setErrors({});
  };
  return { reason, setReason, note, setNote, errors, check, reset, body: () => ({ reasonCode: reason, note: note.trim() }) };
}

function ErrorLine({ error }: { error: unknown }) {
  const message = error ? contractErrorMessage(error) : null;
  return (
    <div role="alert" className={message ? "flex flex-col gap-1 text-body-xs text-danger-600" : "sr-only"}>
      {message ? <p>{message.text}</p> : null}
      {message && message.problems.length > 0 ? (
        <ul className="list-disc pl-4">
          {message.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ publish */

export interface PublishPlan {
  /** The draft's sequence number (what the route names). */
  version: number;
  nextSemver: string;
  bump: VersionBump | null;
  changes: readonly ContractChange[];
  firstVersion: boolean;
  /** Unsaved edits are saved first, with this body. */
  saveFirst: SaveContractDraftBody | null;
}

export function PublishSheet({
  tool,
  plan,
  approvers,
  onClose,
  onQueued,
}: {
  tool: Pick<OperatorTool, "id" | "name">;
  plan: PublishPlan | null;
  approvers: string[] | undefined;
  onClose: () => void;
  onQueued: (answer: TwoPersonAnswer<OperatorTool>, label: string) => void;
}) {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const form = useReasonForm("PLANNED_CHANGE");
  const needs = approverPhrase("P-10", me.roles);
  const [moved, setMoved] = React.useState<string | null>(null);

  const publish = useMutation({
    mutationFn: async (input: { plan: PublishPlan; body: { reasonCode: string; note: string } }) => {
      let version = input.plan.version;
      if (input.plan.saveFirst) {
        const saved = await saveContractDraft(tool.id, input.plan.saveFirst);
        queryClient.setQueryData(["operator", "tools", tool.id], saved);
        if (!saved.draft) throw new Error("The draft was not saved.");
        // The server's own numbers decide; stop if they differ from what this sheet showed.
        if (saved.draft.nextSemver !== input.plan.nextSemver) {
          return { kind: "renumbered" as const, semver: saved.draft.nextSemver };
        }
        version = saved.draft.version;
      }
      return { kind: "sent" as const, answer: await publishContractVersion(tool.id, version, input.body) };
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
      if (result.kind === "renumbered") {
        setMoved(result.semver);
        return;
      }
      onQueued(result.answer, plan ? `Publishing ${tool.name} v${plan.nextSemver}` : `Publishing ${tool.name}`);
      form.reset();
      onClose();
    },
  });
  const { reset } = publish;
  React.useEffect(() => {
    form.reset();
    setMoved(null);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.version, plan?.nextSemver, reset]);

  if (!plan) return null;
  const label = publishLabel(plan.bump, plan.nextSemver, { firstVersion: plan.firstVersion });
  const lines: WhatHappensLine[] = [
    { icon: GitBranch, text: bumpEffect(plan.bump, plan.nextSemver, { firstVersion: plan.firstVersion }), tone: plan.bump === "MAJOR" && !plan.firstVersion ? "warning" : "neutral" },
    { icon: Users, text: `Nothing changes until ${needs} approves it (an operator allowed to approve contract changes; they get a link)` },
    { icon: History, text: "A published version can't be unpublished. A mistake is fixed with a new version" },
  ];
  const shown = plan.changes.slice(0, 6);
  const more = plan.changes.length - shown.length;

  return (
    <Sheet open onOpenChange={(open) => (!open && !publish.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!publish.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{label}?</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens lines={lines} />
          {shown.length > 0 ? (
            <section aria-label="What changes" className="flex flex-col gap-1.5">
              <h3 className="text-label-13 text-01">What changes</h3>
              <ul className="flex flex-col gap-1 text-body-13 text-02">
                {shown.map((change, i) => (
                  <li key={i} className="[overflow-wrap:anywhere]">
                    {changeText(change)}
                  </li>
                ))}
                {more > 0 ? <li className="text-03">and {more} more</li> : null}
              </ul>
            </section>
          ) : null}
          {plan.saveFirst ? <p className="text-body-13 text-02">Your unsaved edits are saved as the draft first.</p> : null}
          {moved ? (
            <p role="alert" className="rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-02">
              The draft is saved, but the server numbers it v{moved}, not v{plan.nextSemver}: something was published in the meantime. Close this, check the changes and publish again.
            </p>
          ) : null}
          <ReasonChips
            label="Why"
            options={CONTRACT_REASONS}
            value={form.reason}
            onChange={form.setReason}
            note={form.note}
            onNoteChange={form.setNote}
            noteMin={NOTE_MIN}
            noteMax={NOTE_MAX}
            notePlaceholder="What changes for providers and agents, and why now."
            errors={form.errors}
          />
          <ApprovalFooter needs={needs} approvers={approvers} />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={publish.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={publish.isPending}>
                Not now
              </Button>
            </SheetClose>
            <Button loading={publish.isPending} disabled={moved !== null} onClick={() => form.check() && publish.mutate({ plan, body: form.body() })}>
              Send for approval
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------- make current */

export function MakeCurrentSheet({
  tool,
  target,
  current,
  eligible,
  approvers,
  onClose,
  onQueued,
}: {
  tool: Pick<OperatorTool, "id" | "name">;
  target: ToolContractVersion | null;
  current: ToolContractVersion | null;
  /** Providers that can serve the target's major now. */
  eligible: number;
  approvers: string[] | undefined;
  onClose: () => void;
  onQueued: (answer: TwoPersonAnswer<OperatorTool>, label: string) => void;
}) {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const form = useReasonForm("PLANNED_CHANGE");
  const needs = approverPhrase("P-11", me.roles);
  const move = useMutation({
    mutationFn: (input: { version: number; body: { reasonCode: string; note: string } }) => moveCurrentVersion(tool.id, { version: input.version, ...input.body }),
    onSuccess: (answer) => {
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
      onQueued(answer, target ? `Making ${tool.name} v${target.semver} the default` : "Changing the default version");
      form.reset();
      onClose();
    },
  });
  const { reset } = move;
  React.useEffect(() => {
    form.reset();
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.version, reset]);
  if (!target) return null;

  const lines: WhatHappensLine[] = [
    { icon: ArrowUpCircle, text: `Agents that don't lock a version get v${target.semver} instead of ${current ? `v${current.semver}` : "the old version"}, as soon as it is approved` },
    { icon: GitBranch, text: `Tool sets and URLs locked to ${current ? `v${current.major}` : "a version"} keep it` },
    eligible < 2
      ? { icon: Ban, text: eligible === 0 ? `No provider can serve v${target.major} yet: calls would be refused` : `Only one provider can serve v${target.major}: no backup if it fails`, tone: "warning" as const }
      : { icon: Users, text: `${eligible} providers can serve v${target.major} now` },
    { icon: Users, text: `Nothing changes until ${needs} approves it (an operator allowed to approve contract changes)` },
    { icon: History, text: "It can be moved back later with another request" },
  ];

  return (
    <Sheet open onOpenChange={(open) => (!open && !move.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!move.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Make v{target.semver} the default for agents?</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens lines={lines} />
          <ReasonChips
            label="Why"
            options={CONTRACT_REASONS}
            value={form.reason}
            onChange={form.setReason}
            note={form.note}
            onNoteChange={form.setNote}
            noteMin={NOTE_MIN}
            noteMax={NOTE_MAX}
            notePlaceholder="Why agents should move now, and how you checked the providers."
            errors={form.errors}
          />
          <ApprovalFooter needs={needs} approvers={approvers} />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={move.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={move.isPending}>
                Not now
              </Button>
            </SheetClose>
            <Button loading={move.isPending} onClick={() => form.check() && move.mutate({ version: target.version, body: form.body() })}>
              Send for approval
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------------------------------------------------------- deprecate */

export function DeprecateSheet({
  tool,
  row,
  tools,
  onClose,
  onDone,
}: {
  tool: Pick<OperatorTool, "id" | "name" | "replacementToolId" | "earliestSunsetAt">;
  row: MajorRow | null;
  /** Other tools that could replace this one. */
  tools: readonly Pick<OperatorToolSummary, "id" | "name" | "status">[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const queryClient = useQueryClient();
  const form = useReasonForm();
  // The API states the earliest sunset; an older backend does not, and then the 90-day rule is worked out here.
  const earliest = tool.earliestSunsetAt ? sunsetDayFrom(tool.earliestSunsetAt) : earliestSunsetDay();
  const [day, setDay] = React.useState(earliest);
  const [replacement, setReplacement] = React.useState(tool.replacementToolId ?? "");
  const [dayError, setDayError] = React.useState<string | null>(null);
  const deprecate = useMutation({
    mutationFn: (input: { version: number; sunsetAt: string; replacementToolId: string; body: { reasonCode: string; note: string } }) =>
      deprecateContractVersion(tool.id, input.version, {
        sunsetAt: input.sunsetAt,
        ...(input.replacementToolId ? { replacementToolId: input.replacementToolId } : {}),
        ...input.body,
      }),
    onSuccess: (updated, input) => {
      queryClient.setQueryData(["operator", "tools", tool.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
      onDone(`v${row?.major ?? "?"} is deprecated. It stops on ${sunsetDay(input.sunsetAt)} (UTC); everyone who uses it is told now.`);
      form.reset();
      onClose();
    },
  });
  const { reset } = deprecate;
  React.useEffect(() => {
    form.reset();
    setDay(earliestSunsetDay());
    setDayError(null);
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.major, reset]);
  if (!row || !row.deprecateVersion) return null;

  const others = tools.filter((t) => t.id !== tool.id && t.status !== "DRAFT" && t.status !== "REMOVED");
  const replacementName = others.find((t) => t.id === replacement)?.name ?? null;
  const lines: WhatHappensLine[] = [
    { icon: CalendarClock, text: `v${row.major} keeps working until ${sunsetDay(sunsetInstant(day))} (UTC). After that, calls that can only use v${row.major} are refused` },
    { icon: Bell, text: `Providers that serve v${row.major} and agents that used ${tool.name} lately are told now${replacementName ? `, and pointed to ${replacementName}` : ""}` },
    { icon: History, text: "It can't be undone", tone: "warning" },
  ];
  const submit = () => {
    const problem = sunsetProblem(day, Date.now(), tool.earliestSunsetAt);
    setDayError(problem);
    const ok = form.check();
    if (problem || !ok) return;
    deprecate.mutate({ version: row.deprecateVersion!.version, sunsetAt: sunsetInstant(day), replacementToolId: replacement, body: form.body() });
  };

  return (
    <Sheet open onOpenChange={(open) => (!open && !deprecate.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!deprecate.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">
            Deprecate {tool.name} v{row.major}?
          </SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens lines={lines} />
          <Field
            label="Stops working on (UTC)"
            type="date"
            min={earliest}
            value={day}
            onChange={(e) => {
              setDay(e.target.value);
              setDayError(null);
            }}
            hint={`At least 90 days from today: ${sunsetDay(sunsetInstant(earliest))} or later. It stops at 00:00 UTC that day.`}
            error={dayError ?? undefined}
          />
          <Select label="Replaced by another tool (optional)" value={replacement} onChange={(e) => setReplacement(e.target.value)} hint="Named in the notices. Leave it empty when a newer version of this tool is the replacement.">
            <option value="">No other tool</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <ReasonChips
            label="Why"
            options={DEPRECATE_REASONS}
            value={form.reason}
            onChange={form.setReason}
            note={form.note}
            onNoteChange={form.setNote}
            noteMin={NOTE_MIN}
            noteMax={NOTE_MAX}
            notePlaceholder="Why v1 should go, and what users should move to."
            errors={form.errors}
          />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={deprecate.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={deprecate.isPending}>
                Keep it
              </Button>
            </SheetClose>
            <Button variant="danger" loading={deprecate.isPending} onClick={submit}>
              Deprecate v{row.major}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------- create tools */

/** A new DRAFT standard tool: a name and a topic. Opens the editor on success. */
export function NewToolSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (tool: OperatorTool) => void }) {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [errors, setErrors] = React.useState<{ name?: string; category?: string }>({});
  const create = useMutation({ mutationFn: () => createStandardTool({ name: name.trim(), category: category.trim() }), onSuccess: onCreated });
  const { reset } = create;
  React.useEffect(() => {
    if (!open) return;
    setName("");
    setCategory("");
    setErrors({});
    reset();
  }, [open, reset]);
  const submit = () => {
    const next = { name: toolNameProblem(name.trim()) ?? undefined, category: categoryProblem(category.trim()) ?? undefined };
    setErrors(next);
    if (!next.name && !next.category) create.mutate();
  };
  return (
    <Sheet open={open} onOpenChange={(o) => (!o && !create.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!create.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">New standard tool</SheetTitle>
        </SheetHeader>
        <form
          className="flex w-full flex-col gap-4 px-[18px] pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <p className="text-body-13 text-02">It starts as a draft that nobody sees. You write its first version next; it reaches providers and agents only when a second person approves it.</p>
          <Field label="Tool name" value={name} onChange={(e) => setName(e.target.value)} placeholder="get_tide_times" hint="What agents call it. Lower case and _, like get_weather. It can't be changed later." error={errors.name} autoComplete="off" spellCheck={false} />
          <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="weather" hint="Groups it in the catalogue, like weather or finance." error={errors.category} autoComplete="off" spellCheck={false} />
          <button type="submit" hidden />
        </form>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={create.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={create.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button loading={create.isPending} onClick={submit}>
              Create draft tool
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Accept a tool request: it closes the ticket and creates the DRAFT tool in one step. */
export function AcceptRequestSheet({
  request,
  canWriteVersions = true,
  onClose,
  onAccepted,
}: {
  request: OperatorToolRequestRow | null;
  /** Policy author or approver: they write the first version next. Anyone else hands the draft over. */
  canWriteVersions?: boolean;
  onClose: () => void;
  onAccepted: (toolId: string | null) => void;
}) {
  const [name, setName] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ name?: string; category?: string; note?: string }>({});
  const accept = useMutation({
    mutationFn: (id: string) =>
      answerOperatorToolRequest(id, { status: "ACCEPTED", resolutionNote: note.trim(), toolName: name.trim(), ...(category.trim() ? { toolCategory: category.trim() } : {}) }),
    onSuccess: (answer) => onAccepted(answer.toolId),
  });
  const { reset } = accept;
  React.useEffect(() => {
    if (!request) return;
    const suggested = suggestToolName(request.title);
    setName(suggested);
    setCategory("");
    setNote(`Accepted. We are drafting ${suggested} as a standard tool.`);
    setErrors({});
    reset();
  }, [request, reset]);
  if (!request) return null;
  const submit = () => {
    const next = {
      name: toolNameProblem(name.trim()) ?? undefined,
      category: category.trim() ? (categoryProblem(category.trim()) ?? undefined) : undefined,
      note: note.trim() ? undefined : "Say why, for the person who asked.",
    };
    setErrors(next);
    if (!next.name && !next.category && !next.note) accept.mutate(request.id);
  };
  return (
    <Sheet open onOpenChange={(o) => (!o && !accept.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!accept.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Create a tool from “{request.title}”</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <p className="text-body-13 text-02">
            This accepts the request (the person who asked is told) and creates a draft tool.{" "}
            {canWriteVersions ? "You write its first version next." : ACCEPT_HANDOVER}
          </p>
          <Field label="Tool name" value={name} onChange={(e) => setName(e.target.value)} hint="What agents call it. Lower case and _. It can't be changed later." error={errors.name} autoComplete="off" spellCheck={false} />
          <Field label="Topic (optional)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="weather" hint="Groups it in the catalogue. Empty puts it under Other." error={errors.category} autoComplete="off" spellCheck={false} />
          <label className="flex w-full flex-col gap-1.5">
            <span className="text-label-13 text-01">Answer to the person who asked</span>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} aria-invalid={errors.note ? true : undefined} />
            {errors.note ? (
              <span role="alert" className="text-body-xs text-danger-500">
                {errors.note}
              </span>
            ) : null}
          </label>
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={accept.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={accept.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button loading={accept.isPending} onClick={submit}>
              Accept and create
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** What accepting means for a role that answers requests but does not write tools. */
export const ACCEPT_HANDOVER = "Accepting creates a draft; writing its versions needs Policy author.";

export type ToolRequestAnswer = "decline" | "acknowledge";

/**
 * The two other answers to a tool request, through the same `PATCH` as
 * accepting (and the same server-side role check): decline, with a note the
 * person reads, or mark it looked at. Declining is final; nothing is created.
 */
export function AnswerRequestSheet({
  request,
  answer,
  onClose,
  onAnswered,
}: {
  request: OperatorToolRequestRow | null;
  answer: ToolRequestAnswer;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [note, setNote] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const send = useMutation({
    mutationFn: (id: string) =>
      answerOperatorToolRequest(id, answer === "decline" ? { status: "DECLINED", resolutionNote: note.trim() } : { status: "ACKNOWLEDGED" }),
    onSuccess: () => onAnswered(),
  });
  const { reset } = send;
  React.useEffect(() => {
    if (!request) return;
    setNote("");
    setError(null);
    reset();
  }, [request, answer, reset]);
  if (!request) return null;
  const declining = answer === "decline";
  const submit = () => {
    if (declining && !note.trim()) {
      setError("Say why, for the person who asked.");
      return;
    }
    send.mutate(request.id);
  };
  const lines: WhatHappensLine[] = declining
    ? [
        { icon: MessageSquare, text: "The person who asked is told it is declined, with your answer" },
        { icon: Ban, text: "No tool is created, and it leaves this list" },
        { icon: Lock, text: "It can't be reopened: they can send a new request" },
      ]
    : [
        { icon: Eye, text: "The person who asked sees “Being reviewed”" },
        { icon: Bell, text: "It stays here until someone accepts or declines it" },
        { icon: MessageSquare, text: "No message goes with it: to write to them, accept or decline" },
      ];
  return (
    <Sheet open onOpenChange={(o) => (!o && !send.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!send.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">{declining ? `Decline “${request.title}”` : `Answer “${request.title}”`}</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens lines={lines} />
          {declining ? (
            <label className="flex w-full flex-col gap-1.5">
              <span className="text-label-13 text-01">Answer to the person who asked</span>
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  if (e.target.value.trim()) setError(null);
                }}
                rows={3}
                maxLength={4000}
                placeholder="It overlaps get_weather, which already returns this."
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <span role="alert" className="text-body-xs text-danger-500">
                  {error}
                </span>
              ) : null}
            </label>
          ) : null}
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <ErrorLine error={send.error} />
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={send.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button variant={declining ? "danger" : "primary"} loading={send.isPending} onClick={submit}>
              {declining ? "Decline request" : "Mark as being reviewed"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
