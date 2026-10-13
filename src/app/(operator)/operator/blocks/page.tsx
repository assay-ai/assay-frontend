"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
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
import { DASH } from "@/features/g34a/stats";
import {
  BLOCK_NOTE_MAX,
  BLOCK_NOTE_MIN,
  BLOCK_REASON_SUGGESTIONS,
  UNBLOCK_REASON_SUGGESTIONS,
  blockErrorMessage,
  mayBlock,
  normaliseSubject,
  validateBlockForm,
  validateUnblockForm,
  type BlockFormInput,
  type FormErrors,
  type UnblockFormInput,
} from "@/features/operator/blocks";
import { useOperatorSession } from "@/features/operator/session-context";
import type { AccountBlock, BlockSubjectKind, ListAccountBlocksQuery } from "@/interfaces/operator";
import {
  createAccountBlock,
  listAccountBlocks,
  unblockAccount,
} from "@/services/operator.service";

/**
 * The account blocklist, route `/operator/blocks`.
 *
 * Built like the case screen's actions: reads by any operator, the block form
 * only for the roles that may use it (`A-9`: `ADJL`, `SRE`), and lifting as a
 * maker/checker act (`A-10`) with the second operator's own token in
 * `X-Operator-Approver` — held in component state only, cleared on success,
 * on close and on unmount, never a mutation variable.
 *
 * Client-side validation renders inline next to its field; server refusals
 * render inline under the form too, in words, with the code kept so it can be
 * quoted into a ticket (`blockErrorMessage`).
 *
 * The audit trail of every block and lifting is the override log, filtered by
 * `targetType=account_block` — linked from the header and from each row.
 */

const LIST_LIMIT = 25;
const HISTORY_HREF = "/operator/override-log?targetType=account_block";

type ActiveFilter = "" | "true" | "false";

interface Filters {
  subjectKind: "" | BlockSubjectKind;
  subject: string;
  active: ActiveFilter;
  reasonCode: string;
}

const EMPTY_FILTERS: Filters = { subjectKind: "", subject: "", active: "true", reasonCode: "" };

/** Only filters that are set are sent: an empty one is not a filter. */
function toQuery(filters: Filters): ListAccountBlocksQuery {
  return {
    subjectKind: filters.subjectKind || undefined,
    subject: filters.subject.trim() || undefined,
    active: filters.active === "" ? undefined : filters.active === "true",
    reasonCode: filters.reasonCode.trim() || undefined,
  };
}

interface BlockRow extends TableRowData, AccountBlock {}

function when(iso: string | null): string {
  if (!iso) return DASH;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

const EMPTY_BLOCK_FORM: BlockFormInput = {
  subjectKind: "WALLET",
  subject: "",
  reasonCode: "",
  note: "",
  ticketRef: "",
};

const EMPTY_UNBLOCK_FORM: Omit<UnblockFormInput, "approverToken"> = {
  reasonCode: "",
  note: "",
  ticketRef: "",
};

export default function AccountBlocksPage() {
  const identity = useOperatorSession();
  const queryClient = useQueryClient();
  const canAct = mayBlock(identity.roles);

  // ── The list ──────────────────────────────────────────────────────────────
  const [draftFilters, setDraftFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = React.useState<Filters>(EMPTY_FILTERS);
  const query = toQuery(filters);

  const list = useInfiniteQuery({
    queryKey: ["operator", "blocks", "list", query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listAccountBlocks({ limit: LIST_LIMIT, cursor: pageParam, ...query }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });

  const rows: BlockRow[] = React.useMemo(
    () => (list.data?.pages ?? []).flatMap((page) => page.items),
    [list.data],
  );

  const invalidateList = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["operator", "blocks"] });
  }, [queryClient]);

  // ── Block (A-9) ───────────────────────────────────────────────────────────
  const [blockForm, setBlockForm] = React.useState<BlockFormInput>(EMPTY_BLOCK_FORM);
  const [blockErrors, setBlockErrors] = React.useState<FormErrors<keyof BlockFormInput>>({});
  const [blockServerError, setBlockServerError] = React.useState<string | null>(null);
  const subjectPreview = normaliseSubject(blockForm.subjectKind, blockForm.subject);

  const block = useMutation({
    mutationFn: createAccountBlock,
    onSuccess: (result) => {
      toast.success(`Blocked ${result.subject}. It takes effect within seconds on every instance.`);
      setBlockForm(EMPTY_BLOCK_FORM);
      setBlockErrors({});
      setBlockServerError(null);
      invalidateList();
    },
    onError: (error) => setBlockServerError(blockErrorMessage(error, "block")),
  });

  function submitBlock(event: React.FormEvent) {
    event.preventDefault();
    setBlockServerError(null);
    const result = validateBlockForm(blockForm);
    if (!result.ok) {
      setBlockErrors(result.errors);
      return;
    }
    setBlockErrors({});
    block.mutate(result.body);
  }

  // ── Unblock (A-10) ────────────────────────────────────────────────────────
  const [unblocking, setUnblocking] = React.useState<AccountBlock | null>(null);
  const [unblockForm, setUnblockForm] = React.useState(EMPTY_UNBLOCK_FORM);
  /** Another operator's credential: state only, cleared on every exit. */
  const [approverToken, setApproverToken] = React.useState("");
  const [unblockErrors, setUnblockErrors] = React.useState<FormErrors<keyof UnblockFormInput>>({});
  const [unblockServerError, setUnblockServerError] = React.useState<string | null>(null);

  React.useEffect(() => () => setApproverToken(""), []);

  const closeUnblock = React.useCallback(() => {
    setUnblocking(null);
    setUnblockForm(EMPTY_UNBLOCK_FORM);
    setApproverToken("");
    setUnblockErrors({});
    setUnblockServerError(null);
  }, []);

  const unblock = useMutation({
    // The token is closed over, not passed as a variable, so it never sits on
    // `unblock.variables` for as long as this screen lives.
    mutationFn: (args: { blockId: string; body: { reasonCode: string; note: string; ticketRef?: string } }) =>
      unblockAccount(args.blockId, args.body, approverToken.trim()),
    onSuccess: (result) => {
      toast.success(`Lifted the block on ${result.subject}.`);
      closeUnblock();
      invalidateList();
    },
    onError: (error) => setUnblockServerError(blockErrorMessage(error, "unblock")),
  });

  function submitUnblock(event: React.FormEvent) {
    event.preventDefault();
    if (!unblocking) return;
    setUnblockServerError(null);
    const result = validateUnblockForm({ ...unblockForm, approverToken });
    if (!result.ok) {
      setUnblockErrors(result.errors);
      return;
    }
    setUnblockErrors({});
    const { approverToken: _token, ...body } = result.body;
    unblock.mutate({ blockId: unblocking.id, body });
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  const columns: TableColumn<BlockRow>[] = [
    {
      key: "subject",
      header: "Subject",
      noTruncate: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-label-13 text-02">
            {row.subjectKind === "ORGANIZATION" ? "Organization" : "Wallet"}
          </span>
          <span className="break-all font-mono text-mono-12 text-01">{row.subject}</span>
          {row.subjectKind === "WALLET" ? (
            <span className="font-mono text-mono-12 text-03">matches {row.subjectKey}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      width: 90,
      cell: (row) =>
        row.active ? (
          <span className="font-mono text-mono-12 font-semibold text-danger-600">ACTIVE</span>
        ) : (
          <span className="font-mono text-mono-12 text-03">lifted</span>
        ),
    },
    {
      key: "blocked",
      header: "Blocked",
      noTruncate: true,
      cell: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-mono-12 text-01">{row.reasonCode}</span>
          <span className="text-body-xs text-02">
            by {row.blockedBy} · {when(row.blockedAt)}
          </span>
          {row.ticketRef ? (
            <span className="font-mono text-mono-12 text-03">{row.ticketRef}</span>
          ) : null}
          <span className="text-body-xs text-03 [overflow-wrap:anywhere]" title="Internal note">
            {row.note}
          </span>
        </span>
      ),
    },
    {
      key: "lifted",
      header: "Lifted",
      noTruncate: true,
      cell: (row) =>
        row.unblockedAt ? (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-body-xs text-02">
              by {row.unblockedBy ?? DASH}, approved by {row.unblockApprovedBy ?? DASH}
            </span>
            <span className="text-body-xs text-02">{when(row.unblockedAt)}</span>
            {row.unblockNote ? (
              <span className="text-body-xs text-03 [overflow-wrap:anywhere]">{row.unblockNote}</span>
            ) : null}
          </span>
        ) : (
          DASH
        ),
    },
    {
      key: "actions",
      header: "",
      width: 150,
      noTruncate: true,
      cell: (row) => (
        <span className="flex flex-col items-start gap-1.5">
          {row.active && canAct ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                closeUnblock();
                setUnblocking(row);
              }}
            >
              Lift block…
            </Button>
          ) : null}
          <Link
            href={`/operator/override-log?targetType=account_block&targetId=${encodeURIComponent(row.id)}`}
            className="text-label-13 text-primary-600 hover:underline"
          >
            History
          </Link>
        </span>
      ),
    },
  ];

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Account blocks</h1>
          <p className="text-body-sm text-03">
            the off-chain blocklist · block is A-9, lifting is A-10
          </p>
        </div>
        <Link href={HISTORY_HREF} className="text-label-13 text-primary-600 hover:underline">
          Full history in the override log
        </Link>
      </header>

      <Panel className="w-full">
        <PanelHeader>
          <PanelTitles>
            <PanelTitle>What a block does</PanelTitle>
            <PanelDescription>takes effect within seconds, on every instance</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-body-13 text-02">
            <li>
              People on the account can still sign in, but only to read: they see their data and that
              they are blocked. Every change they try is refused.
            </li>
            <li>No payments: no new payment, voucher or withdrawal by or to the blocked account.</li>
            <li>A blocked provider&rsquo;s tools are hidden from the catalogue and are not routed to.</li>
            <li>The account&rsquo;s agents are refused outright, whatever key they use.</li>
            <li>
              A wallet is blocked on every EVM chain at once (eip155:8453:0xabc also blocks
              eip155:84532:0xabc), because a leaked key signs everywhere.
            </li>
            <li>
              The account holder sees the reason code and the date, never the note. Funds already on
              chain are not touched: that needs the on-chain blacklist as well.
            </li>
          </ul>
        </PanelBody>
      </Panel>

      {canAct ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Block an organization or a wallet</PanelTitle>
              <PanelDescription>A-9 · ADJL or SRE · takes effect without a second operator</PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitBlock} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <Select
                label="What to block"
                value={blockForm.subjectKind}
                onChange={(e) =>
                  setBlockForm((f) => ({ ...f, subjectKind: e.target.value as BlockSubjectKind }))
                }
              >
                <option value="WALLET">A wallet (CAIP-10 account or 0x address)</option>
                <option value="ORGANIZATION">An organization (its uuid)</option>
              </Select>

              <Field
                label={blockForm.subjectKind === "WALLET" ? "Wallet" : "Organization id"}
                value={blockForm.subject}
                onChange={(e) => setBlockForm((f) => ({ ...f, subject: e.target.value }))}
                placeholder={
                  blockForm.subjectKind === "WALLET"
                    ? "eip155:8453:0x… or 0x…"
                    : "3f2c1b7e-0a4d-4e5f-9a8b-1c2d3e4f5a6b"
                }
                autoComplete="off"
                spellCheck={false}
                error={blockErrors.subject}
                hint={
                  subjectPreview.ok && subjectPreview.note
                    ? subjectPreview.note
                    : blockForm.subjectKind === "WALLET"
                      ? "Blocked on every chain of its namespace."
                      : "Stops the whole tenant: its sessions, its agents and, for a provider, its tools."
                }
              />

              <ReasonCodeField
                id="block-reason"
                value={blockForm.reasonCode}
                onChange={(reasonCode) => setBlockForm((f) => ({ ...f, reasonCode }))}
                suggestions={BLOCK_REASON_SUGGESTIONS}
                error={blockErrors.reasonCode}
              />

              <NoteBox
                id="block-note"
                label="Internal note"
                value={blockForm.note}
                onChange={(note) => setBlockForm((f) => ({ ...f, note }))}
                error={blockErrors.note}
                placeholder="What happened, and who reported it. Never shown to the account holder."
              />

              <Field
                label="Ticket (optional)"
                value={blockForm.ticketRef}
                onChange={(e) => setBlockForm((f) => ({ ...f, ticketRef: e.target.value }))}
                placeholder="INC-123"
                autoComplete="off"
                error={blockErrors.ticketRef}
              />

              {blockServerError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {blockServerError}
                </p>
              ) : null}

              <Button type="submit" variant="danger" className="self-start" loading={block.isPending}>
                Block now
              </Button>
            </form>
          </PanelBody>
        </Panel>
      ) : (
        <Banner
          tone="primary"
          title="You can read the blocklist, not change it"
          description={`Blocking and lifting need the ADJL or SRE role. You hold ${
            identity.roles.length > 0 ? identity.roles.join(", ") : "no role"
          }.`}
        />
      )}

      {unblocking ? (
        <Panel className="w-full">
          <PanelHeader>
            <PanelTitles>
              <PanelTitle>Lift the block on {unblocking.subject}</PanelTitle>
              <PanelDescription>
                A-10 · ADJL or SRE, plus a second operator who holds ADJL
              </PanelDescription>
            </PanelTitles>
          </PanelHeader>
          <PanelBody className="p-4 tablet:p-5">
            <form onSubmit={submitUnblock} className="flex w-full max-w-[720px] flex-col gap-4" noValidate>
              <p className="text-body-13 text-02">
                Lifting re-enables whatever the account or key can spend, which is why it needs a
                second person and blocking does not. The block row stays as the record.
              </p>

              <ReasonCodeField
                id="unblock-reason"
                value={unblockForm.reasonCode}
                onChange={(reasonCode) => setUnblockForm((f) => ({ ...f, reasonCode }))}
                suggestions={UNBLOCK_REASON_SUGGESTIONS}
                error={unblockErrors.reasonCode}
              />

              <NoteBox
                id="unblock-note"
                label="Note"
                value={unblockForm.note}
                onChange={(note) => setUnblockForm((f) => ({ ...f, note }))}
                error={unblockErrors.note}
                placeholder="Why it is safe to lift: the key was rotated, the report was wrong…"
              />

              <Field
                label="Ticket (optional)"
                value={unblockForm.ticketRef}
                onChange={(e) => setUnblockForm((f) => ({ ...f, ticketRef: e.target.value }))}
                autoComplete="off"
                error={unblockErrors.ticketRef}
              />

              <Field
                label="Approver's operator token"
                type="password"
                value={approverToken}
                onChange={(e) => setApproverToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                error={unblockErrors.approverToken}
                hint="A second operator's own credential. The approver must hold ADJL and cannot be you."
              />

              {unblockServerError ? (
                <p className="text-body-13 text-danger-600" role="alert">
                  {unblockServerError}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2.5">
                <Button type="submit" loading={unblock.isPending}>
                  Lift block
                </Button>
                <Button type="button" variant="secondary" onClick={closeUnblock}>
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
            <PanelTitle>Blocks</PanelTitle>
            <PanelDescription>newest first</PanelDescription>
          </PanelTitles>
        </PanelHeader>
        <PanelBody className="p-4 tablet:p-5">
          <form
            className="mb-4 grid w-full grid-cols-1 items-end gap-3 tablet:grid-cols-2 desktop:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              setFilters(draftFilters);
            }}
            aria-label="Block filters"
          >
            <Select
              label="Kind"
              value={draftFilters.subjectKind}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, subjectKind: e.target.value as Filters["subjectKind"] }))
              }
            >
              <option value="">Both</option>
              <option value="ORGANIZATION">Organizations</option>
              <option value="WALLET">Wallets</option>
            </Select>
            <Field
              label="Subject"
              value={draftFilters.subject}
              onChange={(e) => setDraftFilters((f) => ({ ...f, subject: e.target.value }))}
              placeholder="uuid or CAIP-10"
              autoComplete="off"
              spellCheck={false}
            />
            <Select
              label="State"
              value={draftFilters.active}
              onChange={(e) =>
                setDraftFilters((f) => ({ ...f, active: e.target.value as ActiveFilter }))
              }
            >
              <option value="true">Active</option>
              <option value="false">Lifted</option>
              <option value="">Both</option>
            </Select>
            <Field
              label="Reason code"
              value={draftFilters.reasonCode}
              onChange={(e) => setDraftFilters((f) => ({ ...f, reasonCode: e.target.value }))}
              placeholder="LEAKED_KEY"
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button type="submit" variant="secondary">
                Apply
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraftFilters(EMPTY_FILTERS);
                  setFilters(EMPTY_FILTERS);
                }}
              >
                Reset
              </Button>
            </div>
          </form>

          {list.isLoading ? (
            <p className="text-body-13 text-03">Loading…</p>
          ) : list.isError ? (
            <p className="text-body-13 text-danger-600" role="alert">
              {blockErrorMessage(list.error, "list")}
            </p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No blocks match"
              description="Nothing on the blocklist matches these filters. A wallet filter matches on any chain of its namespace."
            />
          ) : (
            <div className="w-full overflow-x-auto">
              <Table columns={columns} rows={rows} caption="Account blocks" className="min-w-[1080px]" />
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

/** A reason code: free text up to 64 characters, with the usual ones offered. */
function ReasonCodeField({
  id,
  value,
  onChange,
  suggestions,
  error,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  suggestions: readonly string[];
  error?: string;
}) {
  return (
    <>
      <Field
        label="Reason code"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={`${id}-options`}
        autoComplete="off"
        spellCheck={false}
        placeholder={suggestions[0]}
        error={error}
        hint={`Short and closed-list, e.g. ${suggestions.join(", ")}. The account holder sees it.`}
      />
      <datalist id={`${id}-options`}>
        {suggestions.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
    </>
  );
}

/** A prose note with a live counter, styled like the case screen's. */
function NoteBox({
  id,
  label,
  value,
  onChange,
  error,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  placeholder?: string;
}) {
  const length = value.trim().length;
  return (
    <div className="flex w-full flex-col gap-1.5">
      <label htmlFor={id} className="text-label-13 text-01">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        maxLength={BLOCK_NOTE_MAX + 200}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={
          error
            ? "w-full rounded-md border-[1.5px] border-danger-500 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03"
            : "w-full rounded-md border border-02 bg-01 px-3 py-2.5 text-body-sm text-01 outline-none placeholder:text-03 focus:border-[1.5px] focus:border-primary-500"
        }
      />
      <p className={error ? "text-body-xs text-danger-600" : "font-mono text-mono-12 text-03"}>
        {error ?? `${length} / ${BLOCK_NOTE_MIN} minimum, ${BLOCK_NOTE_MAX} maximum`}
      </p>
    </div>
  );
}
