"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { CopyChip } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { PresetChips } from "@/components/patterns/preset-chips";
import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { approvalNeeds } from "@/features/operator/approvals";
import {
  DIRECTORY_NOTE_MIN,
  ROLE_OPTIONS,
  deriveSubject,
  directoryErrorMessage,
  limitInputFromChoice,
  mayEditRow,
  mayManageOperators,
  validateAddOperator,
  validateChangeOperator,
  validateRemoveOperator,
} from "@/features/operator/directory";
import { eligibleApprovers, operatorLabel } from "@/features/operator/inbox";
import { OPERATOR_ADD_REASONS, OPERATOR_CHANGE_REASONS, OPERATOR_REMOVE_REASONS } from "@/features/operator/reasons";
import { ResultCard } from "@/features/operator/result-card";
import { ROLE_PRESETS, presetOf, removalWarnings, roleTitle } from "@/features/operator/roles";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref, type TwoPersonAnswer } from "@/features/operator/two-person";
import type { OperatorDirectoryEntry, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { checkEvmAddress, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { addOperator, changeOperator, listOperators, removeOperator } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney, parseAmountInput } from "@/utils/money";

/**
 * Team, route `/operator/operators`.
 *
 * Everyone reads it (it is how you find who can approve something). Admins
 * add people with a side sheet: name, wallet, a role in plain words
 * (fine-grained roles under "Customize"), a limit in dollars, and why.
 * Adding and raising need a second admin, named in the footer. Removing is
 * immediate and warns when it would leave a two-person action with nobody to
 * approve it [backend: refuse such a removal].
 */

const LIST_LIMIT = 100;
/** Reserves the hint line of a field so an error appearing does not move anything. */
const RESERVED = " ";

function limitLabel(row: Pick<OperatorDirectoryEntry, "authorityLimit">): string {
  if (row.authorityLimit === null) return "no limit";
  if (row.authorityLimit.amount === "0") return "$0 limit";
  return `${formatMoney(row.authorityLimit)} limit`;
}

type SheetState = { kind: "add" } | { kind: "change"; row: OperatorDirectoryEntry } | { kind: "remove"; row: OperatorDirectoryEntry } | null;

export default function TeamPage() {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const canManage = mayManageOperators(me.roles);
  const [status, setStatus] = React.useState<"ACTIVE" | "">("ACTIVE");
  const [sheet, setSheet] = React.useState<SheetState>(null);
  const [result, setResult] = React.useState<React.ReactNode>(null);

  const list = useInfiniteQuery({
    queryKey: ["operator", "operators", "list", status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listOperators({ status: status || undefined, cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });
  const rows = React.useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const decimals = me.authorityLimit?.decimals ?? rows.find((row) => row.authorityLimit)?.authorityLimit?.decimals ?? 6;
  const asset = me.authorityLimit?.asset ?? rows.find((row) => row.authorityLimit)?.authorityLimit?.asset ?? "";

  const done = (node: React.ReactNode) => {
    setResult(node);
    setSheet(null);
    void queryClient.invalidateQueries({ queryKey: ["operator", "operators"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
  };
  const queuedOrDone = (answer: TwoPersonAnswer<OperatorDirectoryEntry>, what: string) =>
    done(
      answer.kind === "queued" ? (
        <ResultCard
          tone="queued"
          title={`${what}: waiting for a second admin`}
          next="Nothing has changed yet. It applies when another admin approves it, within 24 h. Send them the link."
          link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }}
          onDismiss={() => setResult(null)}
        />
      ) : (
        <ResultCard title={`${what}: done`} next="It applies from their next request." activityHref="/operator/override-log?kind=operators" onDismiss={() => setResult(null)} />
      ),
    );

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Team</h1>
          <p className="text-body-13 text-03">
            Who can sign in to this console and what each person can do.{canManage ? "" : " Changing the team needs an admin."}
          </p>
        </div>
        {canManage ? (
          <Button icon={<Plus aria-hidden="true" />} onClick={() => setSheet({ kind: "add" })} className="w-full tablet:w-auto">
            Add someone
          </Button>
        ) : null}
      </header>

      {result ? <div className="w-full">{result}</div> : null}

      <Segmented value={status} onValueChange={(value) => setStatus(value as "ACTIVE" | "")} aria-label="Who to show" className="self-start">
        <SegmentedItem value="ACTIVE">Active</SegmentedItem>
        <SegmentedItem value="">Everyone</SegmentedItem>
      </Segmented>

      {list.isLoading ? (
        <PageState kind="loading" rows={4} label="Loading the team" />
      ) : list.isError ? (
        <PageState
          kind="error"
          description={directoryErrorMessage(list.error).replace(/\s*\([A-Z_]+\)$/, "")}
          onRetry={() => void list.refetch()}
          code={list.error instanceof ApiError ? list.error.code : null}
        />
      ) : rows.length === 0 ? (
        <PageState kind="empty" title="Nobody here" />
      ) : (
        <ul className="flex w-full flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-x-2 text-label-13 text-01">
                  {operatorLabel(row)}
                  {row.id === me.id ? <span className="text-body-xs text-03">(you)</span> : null}
                  {row.status !== "ACTIVE" ? <span className="text-body-xs text-danger-600">{row.status.toLowerCase()}</span> : null}
                </p>
                <p className="text-body-13 text-02">
                  {roleTitle(row.roles)} · {limitLabel(row)}
                </p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-xs text-03">
                  {row.subject}
                  {row.walletAddress ? <CopyChip value={toChecksumAddress(row.walletAddress)} label="wallet address" /> : null}
                  {row.lastSeenAt ? (
                    <span>
                      seen <LocalTime value={row.lastSeenAt} />
                    </span>
                  ) : (
                    <span>never signed in</span>
                  )}
                </p>
              </div>
              {mayEditRow(me, row) ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setSheet({ kind: "change", row })}>
                    Change access
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSheet({ kind: "remove", row })}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <>
          <AddSheet
            open={sheet?.kind === "add"}
            onClose={() => setSheet(null)}
            decimals={decimals}
            approvers={eligibleApprovers("A-12", rows, me.id)}
            onDone={(answer, name) => queuedOrDone(answer, `Adding ${name}`)}
          />
          <ChangeSheet
            row={sheet?.kind === "change" ? sheet.row : null}
            onClose={() => setSheet(null)}
            decimals={decimals}
            asset={asset}
            approvers={eligibleApprovers("A-13", rows, me.id)}
            onDone={(answer, name) => queuedOrDone(answer, `Changing ${name}`)}
          />
          <RemoveSheet
            row={sheet?.kind === "remove" ? sheet.row : null}
            warnings={sheet?.kind === "remove" ? removalWarnings(rows, sheet.row.id) : []}
            onClose={() => setSheet(null)}
            onDone={(row) =>
              done(
                <ResultCard
                  title={`${operatorLabel(row)} was removed`}
                  next="Every session they held has ended. Their past actions stay in Activity."
                  activityHref={`/operator/override-log?targetId=${encodeURIComponent(row.id)}`}
                  onDismiss={() => setResult(null)}
                />,
              )
            }
          />
        </>
      ) : null}
    </>
  );
}

// ── Shared fields ───────────────────────────────────────────────────────────

function RoleField({ roles, onChange, error }: { roles: OperatorRole[]; onChange: (roles: OperatorRole[]) => void; error?: string }) {
  const preset = presetOf(roles);
  const [customOpen, setCustom] = React.useState(false);
  // A mix that matches no preset is always shown as Customize, so nothing is hidden.
  const custom = customOpen || (roles.length > 0 && preset === null);
  const value = custom ? "custom" : (preset?.id ?? "");
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-label-13 text-01">What they do</span>
      <PresetChips
        label="Role"
        presets={[
          ...ROLE_PRESETS.map((p) => ({ value: p.id, label: p.label, description: p.description, onPick: () => onChange([...p.roles]) })),
          { value: "custom", label: "Customize", description: "Pick the roles one by one", onPick: () => undefined },
        ]}
        value={value}
        onChange={(next) => setCustom(next === "custom")}
        allowCustom={false}
      />
      {custom ? (
        <div className="grid w-full grid-cols-1 gap-2 rounded-lg border border-01 bg-02 p-3 min-[480px]:grid-cols-2">
          {ROLE_OPTIONS.map((option) => (
            <Checkbox
              key={option.role}
              label={`${option.label} (${option.role})`}
              checked={roles.includes(option.role)}
              onChange={(e) => onChange(e.target.checked ? [...roles, option.role] : roles.filter((r) => r !== option.role))}
            />
          ))}
        </div>
      ) : null}
      <p className={cn("min-h-[18px] text-body-xs", error ? "text-danger-600" : "text-03")}>{error ?? RESERVED}</p>
    </div>
  );
}

/** Limit in dollars → `{ choice, atomic, error }`. */
function useLimit(initial: string) {
  const [choice, setChoice] = React.useState(initial);
  return { choice, setChoice };
}

function parseLimit(choice: string, decimals: number): { atomic: string | null; error: string | null } {
  if (choice === "unlimited") return { atomic: null, error: null };
  if (choice === "") return { atomic: null, error: "Choose a limit." };
  if (choice === "0") return { atomic: "0", error: null };
  const parsed = parseAmountInput(choice, { decimals });
  return { atomic: parsed.atomic, error: parsed.error };
}

function LimitField({ choice, onChange, error }: { choice: string; onChange: (value: string) => void; error?: string | null }) {
  return (
    <div className="flex w-full flex-col gap-2">
      <span className="text-label-13 text-01">The most they can act on, per action</span>
      <PresetChips
        label="Authority limit"
        presets={["0", "100", { value: "1000", label: "$1,000" }, { value: "unlimited", label: "No limit" }]}
        value={choice}
        onChange={onChange}
        error={error ?? undefined}
        hint="Penalties and compensations above it need someone with a higher limit."
      />
    </div>
  );
}

function initialLimit(row: Pick<OperatorDirectoryEntry, "authorityLimit">): string {
  if (row.authorityLimit === null) return "unlimited";
  return formatMoney(row.authorityLimit, { symbol: "", grouped: false }).replace(/\.00$/, "");
}

function Footer({
  busy,
  error,
  summary,
  confirmLabel,
  tone = "primary",
  onConfirm,
}: {
  busy: boolean;
  error: unknown;
  summary: string | null;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
}) {
  return (
    <SheetFooter className="sticky bottom-0 bg-01">
      <div role="alert" className={cn("min-h-[18px] text-body-xs text-danger-600")}>
        {error ? directoryErrorMessage(error).replace(/\s*\([A-Z_]+\)$/, "") : (summary ?? "")}
        {error instanceof ApiError ? (
          <details className="mt-1 text-03">
            <summary className="cursor-pointer select-none text-label-xs">Details</summary>
            <span className="font-mono text-mono-xs">{error.code}</span>
          </details>
        ) : null}
      </div>
      <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
        <SheetClose asChild>
          <Button variant="secondary" disabled={busy}>
            Cancel
          </Button>
        </SheetClose>
        <Button variant={tone} loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </SheetFooter>
  );
}

function summaryOf(errors: Record<string, string | null | undefined>, names: Record<string, string>): string | null {
  const wrong = Object.entries(errors)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => names[key] ?? key);
  if (wrong.length === 0) return null;
  return `Fix ${wrong.length === 1 ? "one thing" : `${wrong.length} things`} above: ${wrong.join(", ")}.`;
}

// ── Add (A-12, always two-person) ───────────────────────────────────────────

function AddSheet({
  open,
  onClose,
  decimals,
  approvers,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  decimals: number;
  approvers: string[];
  onDone: (answer: TwoPersonAnswer<OperatorDirectoryEntry>, name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [handle, setHandle] = React.useState<string | null>(null);
  const [wallet, setWallet] = React.useState("");
  const [roles, setRoles] = React.useState<OperatorRole[]>([]);
  const limit = useLimit("0");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string | null | undefined>>({});

  const subject = handle ?? deriveSubject(name);
  const walletCheck = wallet.trim() ? checkEvmAddress(wallet) : null;

  const add = useMutation({
    mutationFn: addOperator,
    onSuccess: (answer) => {
      onDone(answer, name.trim() || subject);
      setName("");
      setHandle(null);
      setWallet("");
      setRoles([]);
      limit.setChoice("0");
      setReason("");
      setNote("");
      setErrors({});
    },
  });

  const submit = () => {
    const parsedLimit = parseLimit(limit.choice, decimals);
    const validated = validateAddOperator({
      walletAddress: wallet,
      subject,
      displayName: name,
      roles,
      limit: limitInputFromChoice(limit.choice, parsedLimit.atomic),
      reasonCode: reason || "",
      note,
    });
    const next = {
      name: name.trim() ? undefined : "Enter their name.",
      wallet: validated.ok ? undefined : validated.errors.walletAddress,
      roles: validated.ok ? undefined : validated.errors.roles,
      limit: parsedLimit.error,
      reason: reason ? undefined : "Pick a reason.",
      note: validated.ok ? undefined : validated.errors.note,
      subject: validated.ok ? undefined : validated.errors.subject,
    };
    setErrors(next);
    if (!validated.ok || Object.values(next).some(Boolean)) return;
    add.mutate(validated.body);
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (!next && !add.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!add.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Add someone to the team</SheetTitle>
          <SheetDescription>They sign in with the wallet you enter. A second admin approves it first.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-3 px-[18px] pt-4">
          <Field
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Noor Hassan"
            maxLength={128}
            error={errors.name ?? errors.subject ?? undefined}
            hint={
              subject ? (
                <>
                  Recorded as <span className="font-mono">{subject}</span>{" "}
                  {handle === null ? (
                    <button type="button" className="text-primary-600 hover:underline" onClick={() => setHandle(subject)}>
                      change
                    </button>
                  ) : null}
                </>
              ) : (
                RESERVED
              )
            }
          />
          {handle !== null ? (
            <Field label="Handle" value={handle} onChange={(e) => setHandle(e.target.value)} maxLength={256} hint="The short name Activity uses, e.g. noor@." />
          ) : null}
          <Field
            label="Their wallet"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            error={errors.wallet ?? undefined}
            hint={walletCheck && walletCheck.ok ? `Checks out: ${walletCheck.checksummed.slice(0, 6)}…${walletCheck.checksummed.slice(-4)}` : RESERVED}
          />
          <RoleField roles={roles} onChange={setRoles} error={errors.roles ?? undefined} />
          <LimitField choice={limit.choice} onChange={limit.setChoice} error={errors.limit} />
          <ReasonChips
            label="Why"
            options={OPERATOR_ADD_REASONS}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={DIRECTORY_NOTE_MIN}
            noteMax={2048}
            notePlaceholder="What they will work on."
            errors={{ reason: errors.reason, note: errors.note }}
          />
          <ApprovalFooter needs={approvalNeeds("A-12")} approvers={approvers} />
        </div>
        <Footer
          busy={add.isPending}
          error={add.error}
          summary={summaryOf(errors, { name: "name", wallet: "wallet", roles: "role", limit: "limit", reason: "reason", note: "note", subject: "handle" })}
          confirmLabel="Send for approval"
          onConfirm={submit}
        />
      </SheetContent>
    </Sheet>
  );
}

// ── Change (A-13: lowering applies at once, raising is two-person) ──────────

function ChangeSheet({
  row,
  onClose,
  decimals,
  asset,
  approvers,
  onDone,
}: {
  row: OperatorDirectoryEntry | null;
  onClose: () => void;
  decimals: number;
  asset: string;
  approvers: string[];
  onDone: (answer: TwoPersonAnswer<OperatorDirectoryEntry>, name: string) => void;
}) {
  const [roles, setRoles] = React.useState<OperatorRole[]>([]);
  const limit = useLimit("0");
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string | null | undefined>>({});
  const { setChoice } = limit;

  React.useEffect(() => {
    if (!row) return;
    setRoles([...row.roles]);
    setChoice(initialLimit(row));
    setReason("");
    setNote("");
    setErrors({});
  }, [row, setChoice]);

  const change = useMutation({
    mutationFn: (input: { id: string; body: Parameters<typeof changeOperator>[1] }) => changeOperator(input.id, input.body),
    onSuccess: (answer) => row && onDone(answer, operatorLabel(row)),
  });

  if (!row) return <Sheet open={false} />;

  const parsedLimit = parseLimit(limit.choice, decimals);
  const addsRole = roles.some((role) => !row.roles.includes(role));
  const raisesLimit =
    parsedLimit.error === null &&
    (row.authorityLimit === null
      ? false
      : parsedLimit.atomic === null || BigInt(parsedLimit.atomic) > BigInt(row.authorityLimit.amount));
  const raising = addsRole || raisesLimit;

  const submit = () => {
    const validated = validateChangeOperator(row, {
      roles,
      limit: limitInputFromChoice(limit.choice, parsedLimit.atomic),
      reasonCode: reason,
      note,
    });
    const next = {
      roles: validated.ok ? undefined : validated.errors.roles,
      limit: parsedLimit.error ?? (validated.ok ? undefined : validated.errors.change),
      reason: reason ? undefined : "Pick a reason.",
      note: validated.ok ? undefined : validated.errors.note,
    };
    setErrors(next);
    if (!validated.ok || Object.values(next).some(Boolean)) return;
    change.mutate({ id: row.id, body: validated.body });
  };

  const newLimit =
    limit.choice === "unlimited" ? "no limit" : parsedLimit.atomic !== null ? formatMoney({ amount: parsedLimit.atomic, asset, decimals }) : "—";

  return (
    <Sheet open onOpenChange={(next) => (!next && !change.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!change.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Change what {operatorLabel(row)} can do</SheetTitle>
          <SheetDescription>
            Now: {roleTitle(row.roles)}, {limitLabel(row)}. {raising ? "Adding a role or raising the limit needs a second admin." : "Lowering applies at once."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-3 px-[18px] pt-4">
          <RoleField roles={roles} onChange={setRoles} error={errors.roles ?? undefined} />
          <LimitField choice={limit.choice} onChange={limit.setChoice} error={errors.limit} />
          <p className="text-body-13 text-02">
            After: {roleTitle(roles)}, {newLimit === "no limit" ? "no limit" : `${newLimit} limit`}.
          </p>
          <ReasonChips
            label="Why"
            options={OPERATOR_CHANGE_REASONS}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={DIRECTORY_NOTE_MIN}
            noteMax={2048}
            errors={{ reason: errors.reason, note: errors.note }}
          />
          {raising ? <ApprovalFooter needs={approvalNeeds("A-13")} approvers={approvers.filter((name) => name !== operatorLabel(row))} /> : null}
        </div>
        <Footer
          busy={change.isPending}
          error={change.error}
          summary={summaryOf(errors, { roles: "role", limit: "limit", reason: "reason", note: "note" })}
          confirmLabel={raising ? "Send for approval" : "Apply now"}
          onConfirm={submit}
        />
      </SheetContent>
    </Sheet>
  );
}

// ── Remove (A-14, immediate) ────────────────────────────────────────────────

function RemoveSheet({
  row,
  warnings,
  onClose,
  onDone,
}: {
  row: OperatorDirectoryEntry | null;
  warnings: string[];
  onClose: () => void;
  onDone: (row: OperatorDirectoryEntry) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});
  React.useEffect(() => {
    setReason("");
    setNote("");
    setErrors({});
  }, [row]);

  const remove = useMutation({
    mutationFn: (input: { id: string; reasonCode: string; note: string }) => removeOperator(input.id, { reasonCode: input.reasonCode, note: input.note }),
    onSuccess: () => row && onDone(row),
  });

  if (!row) return <Sheet open={false} />;
  const options: readonly ReasonOption[] = OPERATOR_REMOVE_REASONS;

  const submit = () => {
    const validated = validateRemoveOperator({ reasonCode: reason, note });
    const next = { reason: reason ? undefined : "Pick a reason.", note: validated.ok ? undefined : validated.errors.note };
    setErrors(next);
    if (!validated.ok || next.reason) return;
    remove.mutate({ id: row.id, ...validated.body });
  };

  return (
    <Sheet open onOpenChange={(next) => (!next && !remove.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!remove.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Remove {operatorLabel(row)}?</SheetTitle>
          <SheetDescription>It applies at once: every session they hold ends and their wallet can no longer sign in.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-3 px-[18px] pt-4">
          {warnings.length > 0 ? (
            <div role="alert" className="flex w-full gap-2.5 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
              <div className="flex flex-col gap-1 text-body-13 text-warning-700">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
                <p className="text-02">Add someone with that role first, or those requests will stall.</p>
              </div>
            </div>
          ) : null}
          <ReasonChips
            label="Why"
            options={options}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={DIRECTORY_NOTE_MIN}
            noteMax={2048}
            errors={errors}
          />
        </div>
        <Footer busy={remove.isPending} error={remove.error} summary={null} confirmLabel={`Remove ${operatorLabel(row)}`} tone="danger" onConfirm={submit} />
      </SheetContent>
    </Sheet>
  );
}
