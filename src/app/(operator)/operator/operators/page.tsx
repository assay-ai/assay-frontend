"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import {
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  PanelTitles,
} from "@/components/ui/panel";
import { Select } from "@/components/ui/select";
import { Table, type TableColumn, type TableRowData } from "@/components/ui/table";
import { Tag } from "@/components/ui/tag";
import { DASH } from "@/features/g34a/stats";
import {
  DIRECTORY_NOTE_MIN,
  ROLE_OPTIONS,
  directoryErrorMessage,
  limitInputOf,
  mayEditRow,
  mayManageOperators,
  validateAddOperator,
  validateChangeOperator,
  validateRemoveOperator,
  type AddOperatorInput,
  type ChangeOperatorInput,
  type FormErrors,
  type LimitInput,
  type LimitMode,
  type RemoveOperatorInput,
} from "@/features/operator/directory";
import { QueuedNotice } from "@/features/operator/queued-notice";
import { useOperatorSession } from "@/features/operator/session-context";
import { queuedMessage } from "@/features/operator/two-person";
import type {
  ApprovalQueued,
  OperatorDirectoryEntry,
  OperatorRole,
  OperatorStatus,
} from "@/interfaces/operator";
import { checkEvmAddress, toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import {
  addOperator,
  changeOperator,
  listOperators,
  removeOperator,
} from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

/**
 * The operator directory, route `/operator/operators`.
 *
 * Any operator reads it. `OPS_ADMIN` alone writes: add (`A-12`, always
 * two-person), change roles or limit (`A-13`: lowering applies at once,
 * adding a role or raising the limit is two-person) and remove (`A-14`, at
 * once, ending every session the operator holds). Nobody edits or removes
 * their own row, so those buttons are not drawn on it.
 */

const LIST_LIMIT = 50;

interface OperatorRow extends TableRowData, OperatorDirectoryEntry {}

function when(iso: string | null): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

function limitText(row: Pick<OperatorDirectoryEntry, "authorityLimit">): string {
  if (row.authorityLimit === null) return "unbounded";
  return formatMoney(row.authorityLimit);
}

const EMPTY_ADD: AddOperatorInput = {
  walletAddress: "",
  subject: "",
  displayName: "",
  roles: [],
  limit: { mode: "zero", amount: "" },
  reasonCode: "",
  note: "",
};

type Editing =
  | { kind: "change"; row: OperatorDirectoryEntry }
  | { kind: "remove"; row: OperatorDirectoryEntry }
  | null;

export default function OperatorsPage() {
  const me = useOperatorSession();
  const queryClient = useQueryClient();
  const canManage = mayManageOperators(me.roles);

  const [status, setStatus] = React.useState<"" | OperatorStatus>("ACTIVE");
  const [queued, setQueued] = React.useState<ApprovalQueued | null>(null);

  const list = useInfiniteQuery({
    queryKey: ["operator", "operators", "list", status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listOperators({ status: status || undefined, cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows: OperatorRow[] = React.useMemo(
    () => (list.data?.pages ?? []).flatMap((page) => page.items),
    [list.data],
  );

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "operators"] });
    void queryClient.invalidateQueries({ queryKey: ["operator", "approvals"] });
  }, [queryClient]);

  const onQueued = React.useCallback((approval: ApprovalQueued) => {
    setQueued(approval);
    toast.success(queuedMessage(approval));
  }, []);

  // ── Add (A-12) ────────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = React.useState(false);
  const [addForm, setAddForm] = React.useState<AddOperatorInput>(EMPTY_ADD);
  const [addErrors, setAddErrors] = React.useState<FormErrors<keyof AddOperatorInput>>({});
  const [addServerError, setAddServerError] = React.useState<string | null>(null);
  const walletPreview = checkEvmAddress(addForm.walletAddress);

  const add = useMutation({
    mutationFn: addOperator,
    onSuccess: (answer) => {
      setAddForm(EMPTY_ADD);
      setAddErrors({});
      setAddServerError(null);
      setAddOpen(false);
      if (answer.kind === "queued") onQueued(answer.approval);
      else toast.success(`Added ${answer.result.subject}.`);
      invalidate();
    },
    onError: (error) => setAddServerError(directoryErrorMessage(error)),
  });

  function submitAdd(event: React.FormEvent) {
    event.preventDefault();
    setAddServerError(null);
    const result = validateAddOperator(addForm);
    if (!result.ok) {
      setAddErrors(result.errors);
      return;
    }
    setAddErrors({});
    add.mutate(result.body);
  }

  // ── Change (A-13) and remove (A-14) ───────────────────────────────────────
  const [editing, setEditing] = React.useState<Editing>(null);
  const [changeForm, setChangeForm] = React.useState<ChangeOperatorInput | null>(null);
  const [changeErrors, setChangeErrors] = React.useState<FormErrors<keyof ChangeOperatorInput | "change">>({});
  const [removeForm, setRemoveForm] = React.useState<RemoveOperatorInput>({ reasonCode: "", note: "" });
  const [removeErrors, setRemoveErrors] = React.useState<FormErrors<keyof RemoveOperatorInput>>({});
  const [editServerError, setEditServerError] = React.useState<string | null>(null);

  const closeEditing = React.useCallback(() => {
    setEditing(null);
    setChangeForm(null);
    setChangeErrors({});
    setRemoveForm({ reasonCode: "", note: "" });
    setRemoveErrors({});
    setEditServerError(null);
  }, []);

  const startChange = (row: OperatorDirectoryEntry) => {
    closeEditing();
    setEditing({ kind: "change", row });
    setChangeForm({ roles: [...row.roles], limit: limitInputOf(row), reasonCode: "", note: "" });
  };

  const startRemove = (row: OperatorDirectoryEntry) => {
    closeEditing();
    setEditing({ kind: "remove", row });
  };

  const change = useMutation({
    mutationFn: (args: { id: string; body: Parameters<typeof changeOperator>[1] }) =>
      changeOperator(args.id, args.body),
    onSuccess: (answer) => {
      if (answer.kind === "queued") onQueued(answer.approval);
      else toast.success(`Changed ${answer.result.subject}. Lowering applies at once.`);
      closeEditing();
      invalidate();
    },
    onError: (error) => setEditServerError(directoryErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (args: { id: string; body: RemoveOperatorInput }) => removeOperator(args.id, args.body),
    onSuccess: (result) => {
      toast.success(`Removed ${result.subject}. Every session they held has ended.`);
      closeEditing();
      invalidate();
    },
    onError: (error) => setEditServerError(directoryErrorMessage(error)),
  });

  function submitChange(event: React.FormEvent) {
    event.preventDefault();
    if (editing?.kind !== "change" || !changeForm) return;
    setEditServerError(null);
    const result = validateChangeOperator(editing.row, changeForm);
    if (!result.ok) {
      setChangeErrors(result.errors);
      return;
    }
    setChangeErrors({});
    change.mutate({ id: editing.row.id, body: result.body });
  }

  function submitRemove(event: React.FormEvent) {
    event.preventDefault();
    if (editing?.kind !== "remove") return;
    setEditServerError(null);
    const result = validateRemoveOperator(removeForm);
    if (!result.ok) {
      setRemoveErrors(result.errors);
      return;
    }
    setRemoveErrors({});
    remove.mutate({ id: editing.row.id, body: result.body });
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const columns: TableColumn<OperatorRow>[] = [
    {
      key: "operator",
      header: "Operator",
      noTruncate: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label-13 text-01">
            {row.displayName}
            {row.id === me.id ? <span className="text-03"> (you)</span> : null}
          </span>
          <span className="font-mono text-mono-12 text-02">{row.subject}</span>
          {row.email ? <span className="text-body-xs text-03">{row.email}</span> : null}
        </span>
      ),
    },
    {
      key: "wallet",
      header: "Wallet",
      noTruncate: true,
      cell: (row) => (
        <span className="break-all font-mono text-mono-12 text-01">
          {row.walletAddress ? toChecksumAddress(row.walletAddress) : DASH}
        </span>
      ),
    },
    {
      key: "roles",
      header: "Roles",
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-wrap gap-1">
          {row.roles.length === 0
            ? DASH
            : row.roles.map((role) => (
                <Tag key={role} variant="secondary" size="sm">
                  {role}
                </Tag>
              ))}
        </span>
      ),
    },
    { key: "limit", header: "Authority limit", width: 130, cell: (row) => limitText(row) },
    {
      key: "status",
      header: "Status",
      width: 100,
      cell: (row) => <span className="font-mono text-mono-12 text-01">{row.status}</span>,
    },
    { key: "seen", header: "Last seen", width: 170, cell: (row) => when(row.lastSeenAt) },
    {
      key: "actions",
      header: "",
      width: 170,
      noTruncate: true,
      cell: (row) =>
        mayEditRow(me, row) ? (
          <span className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant="secondary" onClick={() => startChange(row)}>
              Edit
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => startRemove(row)}>
              Remove
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Operators</h1>
          <p className="text-body-sm text-03">
            who may sign in to this console · add is A-12, change A-13, remove A-14
          </p>
        </div>
        {canManage && !addOpen ? (
          <Button type="button" onClick={() => setAddOpen(true)}>
            Add operator
          </Button>
        ) : null}
      </header>

      {!canManage ? (
        <Banner
          tone="primary"
          title="You can read the directory, not change it"
          description={`Adding, changing and removing operators needs the OPS_ADMIN role. You hold ${
            me.roles.length > 0 ? me.roles.join(", ") : "no role"
          }.`}
        />
      ) : null}

      {queued ? <QueuedNotice approval={queued} onDismiss={() => setQueued(null)} /> : null}

      {canManage && addOpen ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Add an operator</PanelTitle>
              <PanelDescription>
                A-12 · two-person: a second OPS_ADMIN approves it in the approvals inbox
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitAdd} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <Field
                label="Wallet address"
                value={addForm.walletAddress}
                onChange={(e) => setAddForm((f) => ({ ...f, walletAddress: e.target.value }))}
                placeholder="0x…"
                autoComplete="off"
                spellCheck={false}
                error={addErrors.walletAddress}
                hint={
                  walletPreview.ok
                    ? `Checksummed: ${walletPreview.checksummed}`
                    : "The EVM address they will sign in with. Mixed case must match its EIP-55 checksum."
                }
              />
              <Field
                label="Subject"
                value={addForm.subject}
                onChange={(e) => setAddForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder="dan@"
                autoComplete="off"
                spellCheck={false}
                error={addErrors.subject}
                hint="A short unique handle, shown in the override log."
              />
              <Field
                label="Display name (optional)"
                value={addForm.displayName}
                onChange={(e) => setAddForm((f) => ({ ...f, displayName: e.target.value }))}
                placeholder="Dan Smith"
                autoComplete="off"
                error={addErrors.displayName}
                hint="Defaults to the subject."
              />
              <RolesField
                value={addForm.roles}
                onChange={(roles) => setAddForm((f) => ({ ...f, roles }))}
                error={addErrors.roles}
              />
              <LimitField
                value={addForm.limit}
                onChange={(limit) => setAddForm((f) => ({ ...f, limit }))}
                error={addErrors.limit}
              />
              <Field
                label="Reason code"
                value={addForm.reasonCode}
                onChange={(e) => setAddForm((f) => ({ ...f, reasonCode: e.target.value }))}
                maxLength={64}
                placeholder="NEW_HIRE"
                autoComplete="off"
                error={addErrors.reasonCode}
              />
              <NoteBox
                id="add-note"
                value={addForm.note}
                onChange={(note) => setAddForm((f) => ({ ...f, note }))}
                error={addErrors.note}
                placeholder="Who they are and why they need these roles."
              />
              {addServerError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {addServerError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" loading={add.isPending}>
                  Send for approval
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setAddOpen(false);
                    setAddErrors({});
                    setAddServerError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      ) : null}

      {editing?.kind === "change" && changeForm ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Change {editing.row.subject}</PanelTitle>
              <PanelDescription>
                A-13 · lowering applies at once; adding a role or raising the limit needs a second
                OPS_ADMIN
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitChange} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <RolesField
                value={changeForm.roles}
                onChange={(roles) => setChangeForm((f) => (f ? { ...f, roles } : f))}
                error={changeErrors.roles}
              />
              <LimitField
                value={changeForm.limit}
                onChange={(limit) => setChangeForm((f) => (f ? { ...f, limit } : f))}
                error={changeErrors.limit}
              />
              <Field
                label="Reason code"
                value={changeForm.reasonCode}
                onChange={(e) => setChangeForm((f) => (f ? { ...f, reasonCode: e.target.value } : f))}
                maxLength={64}
                placeholder="ROLE_CHANGE"
                autoComplete="off"
                error={changeErrors.reasonCode}
              />
              <NoteBox
                id="change-note"
                value={changeForm.note}
                onChange={(note) => setChangeForm((f) => (f ? { ...f, note } : f))}
                error={changeErrors.note}
                placeholder="Why the access changes."
              />
              {changeErrors.change ? (
                <p className="text-body-13 text-danger-600">{changeErrors.change}</p>
              ) : null}
              {editServerError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {editServerError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" loading={change.isPending}>
                  Save change
                </Button>
                <Button type="button" variant="secondary" onClick={closeEditing}>
                  Cancel
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      ) : null}

      {editing?.kind === "remove" ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Remove {editing.row.subject}</PanelTitle>
              <PanelDescription>
                A-14 · at once, and every session they hold ends on every instance
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitRemove} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <Field
                label="Reason code"
                value={removeForm.reasonCode}
                onChange={(e) => setRemoveForm((f) => ({ ...f, reasonCode: e.target.value }))}
                maxLength={64}
                placeholder="LEFT_TEAM"
                autoComplete="off"
                error={removeErrors.reasonCode}
              />
              <NoteBox
                id="remove-note"
                value={removeForm.note}
                onChange={(note) => setRemoveForm((f) => ({ ...f, note }))}
                error={removeErrors.note}
                placeholder="Why their access ends."
              />
              {editServerError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {editServerError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" variant="danger" loading={remove.isPending}>
                  Remove operator
                </Button>
                <Button type="button" variant="secondary" onClick={closeEditing}>
                  Cancel
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      ) : null}

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>Directory</PanelTitle>
            <PanelDescription>newest first</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <div className="mb-4 w-full max-w-[240px]">
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | OperatorStatus)}
            >
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="REMOVED">Removed</option>
              <option value="">All</option>
            </Select>
          </div>

          {list.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : list.isError ? (
            <p className="text-body-13 text-danger-600" role="alert">
              {directoryErrorMessage(list.error)}
            </p>
          ) : rows.length === 0 ? (
            <EmptyState title="No operators" description="No operator has this status." />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table columns={columns} rows={rows} caption="Operators" className="min-w-[1080px]" />
            </div>
          )}
        </PanelBody>
      </Panel>

      {list.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          Load more
        </Button>
      ) : null}
    </>
  );
}

function RolesField({
  value,
  onChange,
  error,
}: {
  value: readonly OperatorRole[];
  onChange: (next: OperatorRole[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="flex w-full flex-col gap-2">
      <legend className="mb-1.5 text-label-13 text-01">Roles</legend>
      <div className="grid w-full grid-cols-1 gap-2 tablet:grid-cols-2">
        {ROLE_OPTIONS.map(({ role, label }) => (
          <Checkbox
            key={role}
            checked={value.includes(role)}
            onChange={(e) =>
              onChange(e.target.checked ? [...value, role] : value.filter((r) => r !== role))
            }
            label={
              <>
                <span className="font-mono text-mono-12">{role}</span> · {label}
              </>
            }
          />
        ))}
      </div>
      {error ? <p className="text-body-xs text-danger-600">{error}</p> : null}
    </fieldset>
  );
}

function LimitField({
  value,
  onChange,
  error,
}: {
  value: LimitInput;
  onChange: (next: LimitInput) => void;
  error?: string;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      <Select
        label="Authority limit"
        value={value.mode}
        onChange={(e) => onChange({ ...value, mode: e.target.value as LimitMode })}
        hint="The largest amount one action of theirs may move. Zero suits roles that move no money."
      >
        <option value="zero">Zero</option>
        <option value="amount">An amount (minor units)</option>
        <option value="unbounded">Unbounded</option>
      </Select>
      {value.mode === "amount" ? (
        <Field
          label="Limit in minor units"
          value={value.amount}
          onChange={(e) => onChange({ ...value, amount: e.target.value })}
          inputMode="numeric"
          placeholder="1000000000"
          autoComplete="off"
          error={error}
          hint="Minor units of the platform asset: 1000000 is 1.00 of a 6-decimal asset."
        />
      ) : error ? (
        <p className="text-body-xs text-danger-600">{error}</p>
      ) : null}
    </div>
  );
}

function NoteBox({
  id,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const length = value.trim().length;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-01">
        Note
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={
          error
            ? "w-full rounded-md border-[1.5px] border-danger-500 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03"
            : "w-full rounded-md border border-02 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03 focus:border-[1.5px] focus:border-primary-500"
        }
      />
      <p className={error ? "text-body-xs text-danger-600" : "font-mono text-mono-12 text-03"}>
        {error ?? `${length} / ${DIRECTORY_NOTE_MIN} minimum`}
      </p>
    </div>
  );
}
