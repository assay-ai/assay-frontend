"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Clock, MoreHorizontal, Plus, ShieldCheck, Users, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { CopyChip } from "@/components/patterns/copy-chip";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { PresetChips } from "@/components/patterns/preset-chips";
import { ReasonChips, type ReasonOption } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { approvalNeeds, approvalTargetId } from "@/features/operator/approvals";
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
import { firstNames, inviteLimit, invitesOf, limitCell } from "@/features/operator/team";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref, sentForApproval, type TwoPersonAnswer } from "@/features/operator/two-person";
import { WhatHappens } from "@/features/operator/what-happens";
import { WhyNot } from "@/features/operator/why-not";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import type { OperatorApproval, OperatorDirectoryEntry, OperatorRole } from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { checkEvmAddress, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { addOperator, changeOperator, listApprovals, listOperators, removeOperator } from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney, parseAmountInput } from "@/utils/money";

/**
 * Team, route `/operator/operators`.
 *
 * Everyone reads it (it is how you find who can approve something). Admins
 * add people with a side sheet: name, wallet, a role in plain words
 * (fine-grained roles under "Customize"), a limit in dollars, and why.
 * Adding and raising need a second admin, named in the footer; with no other
 * admin, Send is held back and the sheet says what to do. Removing is
 * immediate — the backend runs it as a one-person action (A-14), so access
 * can be cut at once in an incident — and warns when it would leave a
 * two-person action with nobody to approve it [backend: refuse such a removal].
 *
 * The team is one table (name, role, limit, wallet, last seen; Change and
 * Remove in the row menu). Someone whose addition still waits for a second
 * admin is listed too, from the pending approvals: "Invited · waiting for Ava
 * Chen". `?new=1` opens "Add someone" (Home's quick action for admins).
 */

const LIST_LIMIT = 100;

function limitLabel(row: Pick<OperatorDirectoryEntry, "authorityLimit" | "roles">): string {
  const cell = limitCell(row);
  return cell === "—" ? "no actions on money" : cell === "No limit" ? "no limit" : `${cell} limit`;
}

/** The desktop columns: name, role, limit, wallet, last seen, menu. */
const TEAM_GRID = "tablet:grid tablet:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_80px_minmax(0,1fr)_minmax(0,0.9fr)_36px] tablet:items-center tablet:gap-4";

type SheetState = { kind: "add" } | { kind: "change"; row: OperatorDirectoryEntry } | { kind: "remove"; row: OperatorDirectoryEntry } | null;

function TeamScreen() {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const canManage = mayManageOperators(me.roles);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = React.useState<"ACTIVE" | "">("ACTIVE");
  const [sheet, setSheet] = React.useState<SheetState>(null);
  const [result, setResult] = React.useState<React.ReactNode>(null);

  // Home's "Add someone" links here with `?new=1`.
  React.useEffect(() => {
    if (searchParams.get("new") !== "1" || !canManage) return;
    setSheet({ kind: "add" });
    router.replace(pathname, { scroll: false });
  }, [searchParams, canManage, router, pathname]);

  const list = useInfiniteQuery({
    queryKey: ["operator", "operators", "list", status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listOperators({ status: status || undefined, cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });
  const other = useQuery({
    queryKey: ["operator", "operators", "list", status === "ACTIVE" ? "" : "ACTIVE", "count"],
    queryFn: () => listOperators({ status: status === "ACTIVE" ? undefined : "ACTIVE", limit: LIST_LIMIT }),
    retry: 0,
  });
  // Additions and raises waiting for a second admin — the same query as the badge.
  const pending = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
    refetchInterval: 30_000,
    retry: 0,
  });
  const rows = React.useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const invites = React.useMemo(() => invitesOf(pending.data?.items ?? [], rows), [pending.data, rows]);
  const changes = React.useMemo(() => {
    const map = new Map<string, OperatorApproval>();
    for (const approval of pending.data?.items ?? []) {
      if (approval.action === "operator.change" && approval.status === "PENDING") map.set(approvalTargetId(approval), approval);
    }
    return map;
  }, [pending.data]);
  const decimals = me.authorityLimit?.decimals ?? rows.find((row) => row.authorityLimit)?.authorityLimit?.decimals ?? 6;
  const asset = me.authorityLimit?.asset ?? rows.find((row) => row.authorityLimit)?.authorityLimit?.asset ?? "";
  const countOf = (tab: "ACTIVE" | ""): string | null => {
    if (tab === status) return list.data ? `${rows.length}${list.hasNextPage ? "+" : ""}` : null;
    return other.data ? `${other.data.items.length}${other.data.pageInfo.nextCursor ? "+" : ""}` : null;
  };

  const done = (node: React.ReactNode) => {
    setResult(node);
    setSheet(null);
    void queryClient.invalidateQueries({ queryKey: ["operator", "operators"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
  };
  const queuedOrDone = (answer: TwoPersonAnswer<OperatorDirectoryEntry>, what: string, approvers: string[]) => {
    const sent = answer.kind === "queued" ? sentForApproval(what, approvers, "a second Admin", answer.approval.expiresAt) : null;
    done(
      answer.kind === "queued" && sent ? (
        <ResultCard
          tone="queued"
          title={sent.title}
          next={sent.next}
          link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }}
          onDismiss={() => setResult(null)}
        />
      ) : (
        <ResultCard title={`${what}: done`} next="It applies from their next request." activityHref="/operator/override-log?kind=operators" onDismiss={() => setResult(null)} />
      ),
    );
  };
  const addApprovers = eligibleApprovers("A-12", rows, me.id);
  const changeApprovers = eligibleApprovers("A-13", rows, me.id);

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-heading-md text-01">Team</h1>
          {canManage ? (
            <p className="text-body-13 text-03">Who can sign in to this console and what each person can do.</p>
          ) : (
            <WhyNot action="manageTeam" me={me} ask="Can you change an operator's access on Team? It needs an admin." />
          )}
        </div>
        {canManage ? (
          <Button icon={<Plus aria-hidden="true" />} onClick={() => setSheet({ kind: "add" })} className="w-full tablet:w-auto">
            Add someone
          </Button>
        ) : null}
      </header>

      {result ? <div className="w-full">{result}</div> : null}

      <Segmented value={status} onValueChange={(value) => setStatus(value as "ACTIVE" | "")} aria-label="Who to show" className="self-start">
        {(["ACTIVE", ""] as const).map((tab) => {
          const count = countOf(tab);
          return (
            <SegmentedItem key={tab || "all"} value={tab}>
              {tab === "ACTIVE" ? "Active" : "Everyone"}
              {count !== null ? <span className="ml-1.5 tabular-nums text-03">{count}</span> : null}
            </SegmentedItem>
          );
        })}
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
      ) : rows.length === 0 && invites.length === 0 ? (
        <PageState kind="empty" title="Nobody here" />
      ) : (
        <div className="w-full overflow-hidden rounded-xl border border-01 bg-01">
          <div aria-hidden="true" className={cn(TEAM_GRID, "hidden border-b border-01 px-4 py-2 text-label-13 text-03")}>
            <span>Name</span>
            <span>Role</span>
            <span className="text-right">Limit</span>
            <span>Wallet</span>
            <span>Last seen</span>
            <span />
          </div>
          <ul className="flex w-full flex-col divide-y divide-01">
            {rows.map((row) => {
              const change = changes.get(row.id);
              return (
                <li key={row.id} className={cn(TEAM_GRID, "relative flex min-w-0 flex-col gap-1 px-4 py-2.5 pr-14 tablet:pr-4")}>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-label-13 text-01">
                      <span className="truncate">{operatorLabel(row)}</span>
                      {row.id === me.id ? <span className="text-body-xs text-03">(you)</span> : null}
                      {row.status !== "ACTIVE" ? <span className="text-body-xs text-danger-600">{row.status === "REMOVED" ? "removed" : "suspended"}</span> : null}
                    </span>
                    {change ? (
                      <span className="inline-flex items-center gap-1 text-body-xs text-02">
                        <Clock aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                        Change waiting for {firstNames(eligibleApprovers("A-13", rows, change.requestedById).filter((name) => name !== operatorLabel(row)))}
                      </span>
                    ) : null}
                  </div>
                  <span className="min-w-0 text-body-13 text-02">
                    {roleTitle(row.roles)}
                    <span className="tablet:hidden"> · {limitCell(row) === "—" ? "no money actions" : `${limitCell(row)} limit`}</span>
                  </span>
                  <span className="hidden text-right text-body-13 tabular-nums text-02 tablet:block">{limitCell(row)}</span>
                  <span className="flex min-w-0 items-center gap-2 text-body-xs text-03">
                    {row.walletAddress ? <CopyChip value={toChecksumAddress(row.walletAddress)} label="wallet address" /> : <span>No wallet</span>}
                    <span className="tablet:hidden">· {row.lastSeenAt ? <LocalTime value={row.lastSeenAt} /> : "never signed in"}</span>
                  </span>
                  <span className="hidden text-body-13 text-02 tablet:block">
                    {row.lastSeenAt ? <LocalTime value={row.lastSeenAt} /> : <span className="text-03">Never</span>}
                  </span>
                  <span className="absolute right-3 top-2 tablet:static tablet:flex tablet:justify-end">
                    {mayEditRow(me, row) ? (
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={`More for ${operatorLabel(row)}`}>
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[180px] border border-01">
                          <DropdownMenuItem onSelect={() => setSheet({ kind: "change", row })}>Change access</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/operator/override-log?targetId=${encodeURIComponent(row.id)}`}>History in Activity</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setSheet({ kind: "remove", row })} className="text-danger-600 focus:text-danger-700">
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {invites.map((invite) => {
              const limit = inviteLimit(invite, asset, decimals);
              return (
                <li key={invite.id} className={cn(TEAM_GRID, "relative flex min-w-0 flex-col gap-1 bg-02 px-4 py-2.5 pr-14 tablet:pr-4")}>
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-label-13 text-01">
                    <span className="truncate">{invite.name}</span>
                    {invite.subject && invite.subject !== invite.name ? <span className="font-mono text-mono-12 text-03">{invite.subject}</span> : null}
                  </span>
                  <span className="min-w-0 text-body-13 text-02">
                    {invite.roles.length > 0 ? roleTitle(invite.roles) : "—"}
                    <span className="tablet:hidden"> · {limit === "—" ? "no money actions" : `${limit} limit`}</span>
                  </span>
                  <span className="hidden text-right text-body-13 tabular-nums text-02 tablet:block">{limit}</span>
                  <span className="flex min-w-0 items-center text-body-xs text-03">
                    {invite.wallet ? <CopyChip value={toChecksumAddress(invite.wallet)} label="wallet address" /> : null}
                  </span>
                  <span className="inline-flex min-w-0 items-center gap-1 text-body-xs text-02 tablet:col-span-2">
                    <Clock aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                    <span>
                      Invited · waiting for {firstNames(invite.waitingFor)}
                    </span>
                  </span>
                  <span className="absolute right-3 top-2 tablet:hidden">
                    <Button variant="ghost" size="sm" asChild aria-label={`Open the request to add ${invite.name}`}>
                      <Link href={approvalHref(invite.id)}>
                        <ArrowUpRight aria-hidden="true" />
                      </Link>
                    </Button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canManage ? (
        <>
          <AddSheet
            open={sheet?.kind === "add"}
            onClose={() => setSheet(null)}
            decimals={decimals}
            approvers={addApprovers}
            onDone={(answer, name) => queuedOrDone(answer, `Adding ${name}`, addApprovers)}
          />
          <ChangeSheet
            row={sheet?.kind === "change" ? sheet.row : null}
            onClose={() => setSheet(null)}
            decimals={decimals}
            asset={asset}
            approvers={changeApprovers}
            onDone={(answer, name) => queuedOrDone(answer, `Changing ${name}`, changeApprovers.filter((n) => n !== name))}
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

export default function TeamPage() {
  return (
    <React.Suspense fallback={null}>
      <TeamScreen />
    </React.Suspense>
  );
}

// ── Shared fields ───────────────────────────────────────────────────────────

function RoleField({ roles, onChange, error }: { roles: OperatorRole[]; onChange: (roles: OperatorRole[]) => void; error?: string }) {
  const preset = presetOf(roles);
  const [customOpen, setCustom] = React.useState(false);
  // A mix that matches no preset is always shown as Customize, so nothing is hidden.
  const custom = customOpen || (roles.length > 0 && preset === null);
  const value = custom ? "custom" : (preset?.id ?? "");
  const name = React.useId();
  const options = [
    ...ROLE_PRESETS.map((p) => ({ id: p.id, label: p.label, short: p.short, pick: () => onChange([...p.roles]) })),
    { id: "custom", label: "Customize", short: "Pick the roles one by one", pick: () => undefined },
  ];
  return (
    <fieldset className="flex w-full flex-col gap-2">
      <legend className="mb-2 text-label-13 text-01">What they do</legend>
      <div className="flex w-full flex-col overflow-hidden rounded-lg border border-02">
        {options.map((option) => (
          <label
            key={option.id}
            className={cn(
              "flex cursor-pointer items-start gap-3 border-b border-01 px-3 py-2 last:border-b-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-primary-500",
              value === option.id ? "bg-primary-10" : "hover:bg-02",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.id}
              checked={value === option.id}
              onChange={() => {
                setCustom(option.id === "custom");
                option.pick();
              }}
              className="mt-1 size-4 shrink-0 accent-primary-600"
            />
            <span className="flex min-w-0 flex-col">
              <span className="text-label-13 text-01">{option.label}</span>
              <span className="text-body-xs text-03">{option.short}</span>
            </span>
          </label>
        ))}
      </div>
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
      <details className="group text-body-13">
        <summary className="cursor-pointer select-none text-label-13 text-02 hover:text-01">What exactly?</summary>
        <dl className="mt-2 flex flex-col gap-2">
          {ROLE_PRESETS.map((p) => (
            <div key={p.id} className="flex flex-col">
              <dt className="text-label-13 text-01">{p.label}</dt>
              <dd className="text-02">{p.description}</dd>
            </div>
          ))}
        </dl>
      </details>
      {error ? <p className="text-body-xs text-danger-600">{error}</p> : null}
    </fieldset>
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
  blocked = null,
}: {
  busy: boolean;
  error: unknown;
  summary: string | null;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: () => void;
  /** Why the confirm button is held back, when it is. */
  blocked?: string | null;
}) {
  return (
    <SheetFooter className={OPERATOR_SHEET_FOOTER}>
      <div role="alert" className={error || summary || blocked ? "text-body-xs text-danger-600" : "sr-only"}>
        {error ? directoryErrorMessage(error).replace(/\s*\([A-Z_]+\)$/, "") : (summary ?? blocked ?? "")}
        {error instanceof ApiError ? (
          <details className="mt-1 text-03">
            <summary className="cursor-pointer select-none text-label-xs">Details</summary>
            <span className="font-mono text-mono-xs">{error.code}</span>
          </details>
        ) : null}
      </div>
      <div className={OPERATOR_SHEET_BUTTONS}>
        <SheetClose asChild>
          <Button variant="secondary" disabled={busy}>
            Cancel
          </Button>
        </SheetClose>
        <Button variant={tone} loading={busy} disabled={blocked !== null} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </SheetFooter>
  );
}

/** Clears one field's error once it is edited: a message never outlives the mistake. */
function useFieldErrors() {
  const [errors, setErrors] = React.useState<Record<string, string | null | undefined>>({});
  const clear = React.useCallback((...keys: string[]) => {
    setErrors((current) => (keys.some((key) => current[key]) ? { ...current, ...Object.fromEntries(keys.map((key) => [key, undefined])) } : current));
  }, []);
  return { errors, setErrors, clear };
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
  const { errors, setErrors, clear } = useFieldErrors();
  React.useEffect(() => {
    if (reason) clear("reason");
  }, [reason, clear]);
  React.useEffect(() => {
    if (note.trim().length >= DIRECTORY_NOTE_MIN) clear("note");
  }, [note, clear]);
  React.useEffect(() => {
    if (roles.length > 0) clear("roles");
  }, [roles, clear]);
  const soleAdmin = approvers.length === 0;

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
        </SheetHeader>
        <div className="flex w-full flex-col gap-3 px-[18px] pt-3">
          <WhatHappens
            lines={[
              { icon: Users, text: soleAdmin ? "A second admin must approve it, and there is none yet" : `Nothing changes until ${firstNames(approvers)} approves`, tone: soleAdmin ? "warning" : "neutral" },
              { icon: Wallet, text: "Then they sign in with the wallet you enter" },
              { icon: ShieldCheck, text: "Recorded in Activity under your name" },
            ]}
          />
          {soleAdmin ? (
            <div role="alert" className="flex w-full gap-2.5 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning-600" />
              <div className="flex flex-col gap-1 text-body-13 text-02">
                <p className="text-label-13 text-01">You are the only admin, so nobody can approve this yet</p>
                <p>
                  Adding someone always needs a second admin, and the console cannot make the first one. Ask engineering to register a
                  second admin wallet on the backend (operator-access runbook); then send this again and they approve it.
                </p>
              </div>
            </div>
          ) : null}
          <Field
            label="Name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clear("name", "subject");
            }}
            placeholder="Noor Hassan"
            maxLength={128}
            className="font-sans text-body-sm"
            error={errors.name ?? errors.subject ?? undefined}
            hint={
              subject ? (
                <>
                  Their handle: <span className="font-mono">{subject}</span>, the short name Activity and approvals show for
                  them.{" "}
                  {handle === null ? (
                    <button type="button" className="text-primary-600 hover:underline" onClick={() => setHandle(subject)}>
                      change
                    </button>
                  ) : null}
                </>
              ) : undefined
            }
          />
          {handle !== null ? (
            <Field
              label="Handle"
              value={handle}
              onChange={(e) => {
                setHandle(e.target.value);
                clear("subject");
              }}
              maxLength={256}
              hint="The short name Activity and approvals show for them, e.g. noor@. It is not an email address."
            />
          ) : null}
          <Field
            label="Their wallet"
            value={wallet}
            onChange={(e) => {
              setWallet(e.target.value);
              clear("wallet");
            }}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            error={errors.wallet ?? undefined}
            hint={walletCheck && walletCheck.ok ? `Checks out: ${walletCheck.checksummed.slice(0, 6)}…${walletCheck.checksummed.slice(-4)}` : undefined}
          />
          <RoleField roles={roles} onChange={setRoles} error={errors.roles ?? undefined} />
          <LimitField
            choice={limit.choice}
            onChange={(value) => {
              limit.setChoice(value);
              clear("limit");
            }}
            error={errors.limit}
          />
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
          blocked={soleAdmin ? "Held back: no second admin can approve it yet." : null}
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
  const { errors, setErrors, clear } = useFieldErrors();
  const { setChoice } = limit;
  React.useEffect(() => {
    if (reason) clear("reason");
  }, [reason, clear]);
  React.useEffect(() => {
    if (note.trim().length >= DIRECTORY_NOTE_MIN) clear("note");
  }, [note, clear]);
  React.useEffect(() => clear("roles", "limit"), [roles, limit.choice, clear]);

  React.useEffect(() => {
    if (!row) return;
    setRoles([...row.roles]);
    setChoice(initialLimit(row));
    setReason("");
    setNote("");
    setErrors({});
  }, [row, setChoice, setErrors]);

  const change = useMutation({
    mutationFn: (input: { id: string; body: Parameters<typeof changeOperator>[1] }) => changeOperator(input.id, input.body),
    onSuccess: (answer) => row && onDone(answer, operatorLabel(row)),
  });  const { reset: resetChange } = change;
  React.useEffect(() => resetChange(), [row?.id, resetChange]);


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
          blocked={raising && approvers.filter((name) => name !== operatorLabel(row)).length === 0 ? "Held back: no other admin can approve a raise yet. Lowering still applies at once." : null}
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
  });  const { reset: resetRemove } = remove;
  React.useEffect(() => resetRemove(), [row?.id, resetRemove]);


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
          <SheetDescription>
            It applies at once, without a second admin: every session they hold ends and their wallet can no longer sign in. Removal
            is one-person on purpose, so access can be cut in an incident; it is recorded in Activity, and adding them back needs a
            second admin.
          </SheetDescription>
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
