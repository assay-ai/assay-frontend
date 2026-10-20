"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock, Link2, MoreHorizontal, PenLine, Plus, Search, ShieldCheck, Undo2, Users } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { UtcTime } from "@/components/patterns/utc-time";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { approvalTargetId } from "@/features/operator/approvals";
import { ApprovedArbiterBlocks } from "@/features/operator/approved-arbiter-blocks";
import { arbiterErrorMessage, mayBlockOnChain, mayRule } from "@/features/operator/arbiter";
import {
  blockSubjectLabel,
  evmAddressOf,
  noTargetText,
  pickedTarget,
  searchBlockTargets,
  targetId,
  walletLabel,
} from "@/features/operator/block-targets";
import { BLOCK_NOTE_MAX, BLOCK_NOTE_MIN, blockErrorMessage, mayBlock, validateBlockForm, validateUnblockForm } from "@/features/operator/blocks";
import { callSummary, chainDisplayName } from "@/features/operator/call-summary";
import { ContractCallAction } from "@/features/operator/contract-call-action";
import { eligibleApprovers } from "@/features/operator/inbox";
import { BLOCK_REASONS, UNBLOCK_REASONS, reasonLabel } from "@/features/operator/reasons";
import { AFTER_BLOCK_LIFT, refreshAfter } from "@/features/operator/refresh-after";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref, approverPhrase, sentForApproval } from "@/features/operator/two-person";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import { WhatHappens } from "@/features/operator/what-happens";
import { WhyNot } from "@/features/operator/why-not";
import { dropUrlParams } from "@/features/operator/url-params";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import type { AccountBlock, ApprovalQueued, BlockSubjectKind, OperatorApproval } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { ROBINHOOD_TESTNET_STAKE, stakeDeploymentFor } from "@/libs/chains/evm/stake-slashes/deployments";
import {
  createAccountBlock,
  createArbiterBlockIntent,
  listAccountBlocks,
  unblockAccount,
} from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";
import { operatorQueries } from "@/features/operator/queries";

/**
 * Blocks, route `/operator/blocks`.
 *
 * Block an account in under a minute: one search box (a wallet, a provider's
 * name, an organization id — the kind is inferred), what the block will stop,
 * a reason chip and a note. For a wallet, "Also block on chain" builds the
 * arbiter's `setBlocked` in the same flow. Lifting is two-person: the sheet
 * says who can approve it, a block whose lift is already waiting says so on
 * its row, and a second identical request is not sent.
 *
 * `?block=<id>&kind=ORGANIZATION|WALLET` opens the form prefilled — the case
 * and arbiter pages link here with it. `?new=1` opens it empty (Home's quick
 * action for Support).
 *
 * The list is one table: account, kind, reason (and ticket), who and when, and
 * one button — Lift, or the waiting lift request. The note, the history and
 * "Block on chain" are in the row's menu.
 *
 * [backend] Whether a wallet is blocked on chain is not on the block record;
 * an "On chain" column needs it.
 */

const LIST_LIMIT = 50;

function capitalFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type Filter = "active" | "lifted";

function BlocksScreen() {
  const me = useOperatorSession();
  const canAct = mayBlock(me.roles);
  const canChain = mayBlockOnChain(me.roles);
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  const searchParams = useSearchParams();

  // Activity links to one block: `?q=` its id (or subject), `?show=lifted` once it was lifted.
  const [filter, setFilter] = React.useState<Filter>(() => (searchParams.get("show") === "lifted" ? "lifted" : "active"));
  const [search, setSearch] = React.useState(() => searchParams.get("q") ?? "");
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<{ kind: BlockSubjectKind; subject: string } | null>(null);
  const [lifting, setLifting] = React.useState<AccountBlock | null>(null);
  const [chainBlocking, setChainBlocking] = React.useState<AccountBlock | null>(null);
  const [openNote, setOpenNote] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<React.ReactNode>(null);

  // Lifts already waiting for approval, by block id — the same query as the badge.
  const pendingQuery = useQuery({
    ...operatorQueries.pendingApprovals(),
    refetchInterval: 30_000,
    retry: 0,
  });
  const pendingLift = React.useMemo(() => {
    const map = new Map<string, OperatorApproval>();
    for (const approval of pendingQuery.data?.items ?? []) {
      if (approval.action === "account.unblock" && approval.status === "PENDING") map.set(approvalTargetId(approval), approval);
    }
    return map;
  }, [pendingQuery.data]);

  // A link opens the form once: prefilled from a case or the arbiter page
  // (`?block=…&kind=…`), or empty from Home's quick action (`?new=1`).
  React.useEffect(() => {
    const subject = searchParams.get("block");
    const fresh = searchParams.get("new") === "1";
    if (!subject && !fresh) return;
    // Without the right no sheet opens to clear them, so the link's params go now.
    if (!canAct) {
      dropUrlParams(["new", "block", "kind"]);
      return;
    }
    setPrefill(subject ? { kind: searchParams.get("kind") === "WALLET" ? "WALLET" : "ORGANIZATION", subject } : null);
    setBlockOpen(true);
  }, [searchParams, canAct]);
  // The link's params go when the sheet closes, so a reload does not open it again.
  const onBlockOpenChange = (open: boolean) => {
    setBlockOpen(open);
    if (!open) dropUrlParams(["new", "block", "kind"]);
  };

  const list = useInfiniteQuery({
    queryKey: ["operator", "blocks", "list", { active: filter === "active" }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listAccountBlocks({ active: filter === "active", cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });
  // The other tab's count, for its label.
  const other = useQuery({
    queryKey: ["operator", "blocks", "list", { active: filter !== "active" }, "count"],
    queryFn: () => listAccountBlocks({ active: filter !== "active", limit: LIST_LIMIT }),
    retry: 0,
  });
  const rows = React.useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
  const countOf = (tab: Filter): string | null => {
    if (tab === filter) {
      if (!list.data) return null;
      return `${rows.length}${list.hasNextPage ? "+" : ""}`;
    }
    if (!other.data) return null;
    return `${other.data.items.length}${other.data.pageInfo.nextCursor ? "+" : ""}`;
  };
  const label = React.useCallback((block: AccountBlock) => blockSubjectLabel(block, providers.lookup), [providers]);
  const shown = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      [row.id, label(row), row.subject, reasonLabel(row.reasonCode), row.blockedBy, directory.nameOf(row.blockedBy), row.ticketRef ?? "", row.note]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search, label, directory]);
  const approversOf = (approval: OperatorApproval) =>
    directory.isPending ? [] : eligibleApprovers("A-10", directory.operators, approval.requestedById);

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Blocks</h1>
          <p className="text-body-13 text-03">A blocked account cannot pay or be paid through Assay.</p>
        </div>
        {canAct ? (
          <Button
            icon={<Plus aria-hidden="true" />}
            onClick={() => {
              setPrefill(null);
              setBlockOpen(true);
            }}
            className="touch-target w-full sm:w-auto"
          >
            Block an account
          </Button>
        ) : null}
      </header>

      {!canAct ? (
        <WhyNot
          action="block"
          me={me}
          ask="Can you help with an account block on Assay? My role cannot block or lift accounts."
        />
      ) : null}

      {result ? <div className="w-full">{result}</div> : null}

      {/* Approved on-chain blocks wait for the arbiter's signature: listed here too, not only on Arbiter (P3-a). */}
      {canChain ? <ApprovedArbiterBlocks canRule={mayRule(me.roles)} onSent={() => void list.refetch()} /> : null}

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
        <Segmented value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Which blocks" className="self-start">
          {(["active", "lifted"] as const).map((tab) => {
            const count = countOf(tab);
            return (
              <SegmentedItem key={tab} value={tab} className="touch-target">
                {tab === "active" ? "Active" : "Lifted"}
                {count !== null ? <span className="ml-1.5 tabular-nums text-03">{count}</span> : null}
              </SegmentedItem>
            );
          })}
        </Segmented>
        <label className="touch-target flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 tablet:max-w-[320px]">
          <Search aria-hidden="true" className="size-4 shrink-0 text-03" />
          <span className="sr-only">Search blocks</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, wallet, reason, who"
            className="w-full min-w-0 bg-transparent text-body-sm text-01 outline-none placeholder:text-03"
          />
        </label>
      </div>

      {list.isLoading ? (
        <PageState kind="loading" rows={4} label="Loading blocks" />
      ) : list.isError ? (
        <PageState
          kind="error"
          description={blockErrorMessage(list.error, "list")}
          onRetry={() => void list.refetch()}
          code={list.error instanceof ApiError ? list.error.code : null}
        />
      ) : shown.length === 0 ? (
        <PageState
          kind="empty"
          title={search ? "Nothing matches" : filter === "active" ? "No account is blocked" : "No block has been lifted"}
          description={search ? "Try a name, a wallet or a reason." : filter === "active" ? "Blocked accounts appear here until a block is lifted." : undefined}
        />
      ) : (
        <div className="w-full overflow-hidden rounded-xl border border-01 bg-01">
          <div aria-hidden="true" className={cn(BLOCK_GRID, "hidden border-b border-01 px-4 py-2 text-label-13 text-03 tablet:grid")}>
            <span>Account</span>
            <span>Kind</span>
            <span>Reason</span>
            <span>{filter === "active" ? "Blocked by" : "Lifted by"}</span>
            <span />
          </div>
          <ul className="flex w-full flex-col divide-y divide-01">
            {shown.map((block) => {
              const waiting = block.active ? pendingLift.get(block.id) : undefined;
              const walletOnChain = block.active && canChain && block.subjectKind === "WALLET" && evmAddressOf(block.subject) !== null;
              const noteOpen = openNote === block.id;
              return (
                <li key={block.id} className="flex w-full min-w-0 flex-col gap-2 px-4 py-3">
                  <div className={cn(BLOCK_GRID, "flex flex-wrap items-center gap-x-3 gap-y-1.5 tablet:grid")}>
                    <div className="flex w-full min-w-0 flex-col gap-0.5 tablet:w-auto">
                      <span className="min-w-0 truncate text-label-13 text-01" title={label(block)}>
                        {label(block)}
                        <span className="text-body-xs text-03 tablet:hidden"> · {block.subjectKind === "ORGANIZATION" ? "Organization" : "Wallet"}</span>
                      </span>
                      {waiting ? (
                        <span className="inline-flex flex-wrap items-center gap-1 text-body-xs text-02">
                          <Clock aria-hidden="true" className="size-3.5 shrink-0 text-03" />
                          Lift waiting for approval
                          {approversOf(waiting).length > 0 ? <span className="text-03">· {askNames(approversOf(waiting))}</span> : null}
                        </span>
                      ) : null}
                    </div>
                    <span className="hidden text-body-13 text-02 tablet:block">{block.subjectKind === "ORGANIZATION" ? "Organization" : "Wallet"}</span>
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body-13 text-02">
                      {reasonLabel(block.reasonCode)}
                      {block.ticketRef ? <span className="rounded bg-03 px-1.5 py-px font-mono text-mono-12 text-02">{block.ticketRef}</span> : null}
                    </span>
                    <span className="min-w-0 text-body-13 text-02">
                      {block.active || !block.unblockedAt ? (
                        <>
                          {directory.nameOf(block.blockedBy)} · <UtcTime value={block.blockedAt} dateOnly />
                        </>
                      ) : (
                        <>
                          {directory.nameOf(block.unblockedBy)}
                          {block.unblockApprovedBy ? <span className="text-03">, approved by {directory.nameOf(block.unblockApprovedBy)}</span> : null} ·{" "}
                          <UtcTime value={block.unblockedAt} dateOnly />
                        </>
                      )}
                    </span>
                    <div className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-2 sm:justify-end tablet:mt-0 tablet:w-auto">
                      {waiting ? (
                        <Button variant="secondary" size="sm" asChild className="touch-target min-w-0 flex-1 sm:flex-none">
                          <Link href={approvalHref(waiting.id)}>View request</Link>
                        </Button>
                      ) : block.active && canAct ? (
                        <Button variant="secondary" size="sm" onClick={() => setLifting(block)} className="touch-target min-w-0 flex-1 sm:flex-none">
                          Lift block
                        </Button>
                      ) : null}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={`More for ${label(block)}`} className="touch-target ml-auto sm:ml-0">
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[200px] border border-01">
                          <DropdownMenuItem onSelect={() => setOpenNote(noteOpen ? null : block.id)}>{noteOpen ? "Hide the note" : "Show the note"}</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/operator/activity?targetId=${encodeURIComponent(block.id)}`}>History in Activity</Link>
                          </DropdownMenuItem>
                          {walletOnChain ? <DropdownMenuItem onSelect={() => setChainBlocking(block)}>Block on chain</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {noteOpen ? (
                    <div className="flex w-full flex-col gap-1 rounded-md bg-02 px-3 py-2 text-body-13 text-02 [overflow-wrap:anywhere]">
                      <p>{block.note}</p>
                      {block.unblockNote ? <p className="text-03">Lifted: {block.unblockNote}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {list.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      ) : null}

      {canAct ? (
        <BlockSheet
          open={blockOpen}
          onOpenChange={onBlockOpenChange}
          prefill={prefill}
          canChain={canChain}
          activeBlocks={filter === "active" ? rows : []}
          onDone={setResult}
          onRetryChain={(created) => {
            setResult(null);
            setChainBlocking(created);
          }}
        />
      ) : null}
      {canChain ? (
        <ChainBlockSheet block={chainBlocking} label={chainBlocking ? label(chainBlocking) : ""} onClose={() => setChainBlocking(null)} />
      ) : null}
      {canAct ? (
        <LiftSheet
          block={lifting}
          label={lifting ? label(lifting) : ""}
          waiting={lifting ? (pendingLift.get(lifting.id) ?? null) : null}
          nameOf={directory.nameOf}
          approvers={directory.isPending ? undefined : eligibleApprovers("A-10", directory.operators, me.id)}
          onClose={() => setLifting(null)}
          onDone={setResult}
        />
      ) : null}
    </>
  );
}

/** The desktop columns: account, kind, reason, who and when, actions. */
const BLOCK_GRID = "tablet:grid-cols-[minmax(0,1.5fr)_100px_minmax(0,1fr)_minmax(0,1.2fr)_196px] tablet:gap-4";

/** "Riley or Jordan", "Riley Brooks" — who can approve, short. */
function askNames(names: readonly string[]): string {
  if (names.length === 1) return names[0]!;
  const first = (name: string) => name.split(/\s+/)[0] ?? name;
  if (names.length === 2) return `${first(names[0]!)} or ${first(names[1]!)}`;
  return `${first(names[0]!)} or ${names.length - 1} others`;
}

// ── Block (A-9), with the optional on-chain block (A-11) ────────────────────

function BlockSheet({
  open,
  onOpenChange,
  prefill,
  canChain,
  activeBlocks,
  onDone,
  onRetryChain,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: { kind: BlockSubjectKind; subject: string } | null;
  canChain: boolean;
  activeBlocks: readonly AccountBlock[];
  onDone: (node: React.ReactNode) => void;
  /** Open "Block on chain" for a block just made, when its call was refused. */
  onRetryChain?: (block: AccountBlock) => void;
}) {
  const queryClient = useQueryClient();
  const me = useOperatorSession();
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  // The on-chain block (A-11) is two-person: a first request is queued for an approver.
  const chainNeeds = approverPhrase("A-11", me.roles);
  const chainApprovers = directory.isPending ? undefined : eligibleApprovers("A-11", directory.operators, me.id);
  const chains = useBlockChains(open && canChain);
  const [pickedChain, setPickedChain] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<string | null>(null);
  const [targetLabel, setTargetLabel] = React.useState<string | undefined>(undefined);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [onChain, setOnChain] = React.useState(false);
  const [errors, setErrors] = React.useState<{ target?: string; reason?: string; note?: string }>({});
  const titleRef = React.useRef<HTMLHeadingElement>(null);
  const reasonsRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    if (prefill) {
      setTarget(targetId(prefill.kind, prefill.subject));
      setTargetLabel(prefill.kind === "ORGANIZATION" ? (providers.lookup(prefill.subject) ?? undefined) : undefined);
    }
    // Prefill once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const picked = pickedTarget(target);
  const catalogue = providers.providers;
  // Stable, or the picker would search again on every render.
  const searchTargets = React.useCallback(async (q: string) => searchBlockTargets(q, catalogue), [catalogue]);
  const shownLabel =
    targetLabel ??
    (picked ? (picked.kind === "ORGANIZATION" ? (providers.lookup(picked.subject) ?? undefined) : walletLabel(picked.subject)) : undefined);
  const provider = picked?.kind === "ORGANIZATION" ? providers.providers.find((p) => p.providerId === picked.subject) : undefined;
  const evm = picked?.kind === "WALLET" ? evmAddressOf(picked.subject) : null;
  const alreadyBlocked = picked
    ? activeBlocks.find((b) => b.subjectKind === picked.kind && (b.subject === picked.subject.toLowerCase() || b.subjectKey.endsWith(picked.subject.toLowerCase())))
    : undefined;
  // One chain: that one, named. Several: the one picked, never the first silently.
  const chainId = chains.ids.length === 1 ? chains.ids[0]! : pickedChain && chains.ids.includes(pickedChain) ? pickedChain : null;

  const block = useMutation({
    mutationFn: async () => {
      const validated = validateBlockForm({
        subjectKind: picked!.kind,
        subject: picked!.subject,
        reasonCode: reason,
        note,
        ticketRef: ticket,
      });
      if (!validated.ok) throw new Error(validated.errors.subject ?? "Check the form.");
      const created = await createAccountBlock(validated.body);
      let call: { call: SlashContractCall; account: string } | null = null;
      let queued: ApprovalQueued | null = null;
      let chainError: unknown = null;
      if (onChain && evm && chainId) {
        try {
          const answer = await createArbiterBlockIntent({ chainId, account: evm, reasonCode: reason, note: note.trim(), ...(ticket.trim() ? { ticketRef: ticket.trim() } : {}) });
          if (answer.kind === "queued") queued = answer.approval;
          else call = { call: answer.result, account: evm };
        } catch (error) {
          chainError = error;
        }
      }
      return { created, call, queued, chainError };
    },
    onSuccess: ({ created, call, queued, chainError }) => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "blocks"] });
      const name = blockSubjectLabel(created, providers.lookup);
      onDone(
        <div className="flex w-full flex-col gap-3">
          <ResultCard
            title={`${name} is blocked`}
            next={
              call
                ? "It applies within seconds in Assay. The on-chain block for the arbiter's wallet is below."
                : queued
                  ? "It applies within seconds in Assay. The on-chain block went to a second operator for approval, below; nothing is blocked on chain yet."
                  : chainError
                  ? `It applies within seconds in Assay, but not on chain yet: the on-chain block could not be prepared. ${arbiterErrorMessage(chainError, "block").replace(/\s*\([A-Z_]+\)$/, "")} Use "Block on chain" on its row to try again.`
                  : "It applies within seconds on every instance. Lifting it needs two people."
            }
            activityHref={`/operator/activity?targetId=${encodeURIComponent(created.id)}`}
            onDismiss={() => onDone(null)}
          />
          {queued ? (
            <QueuedChainBlock approval={queued} needs={chainNeeds} approvers={chainApprovers} onDismiss={() => onDone(null)} />
          ) : null}
          {call ? (
            <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4">
              <p className="text-label-13 text-01">Also block on chain</p>
              <ContractCallAction
                call={call.call}
                // The wallet picked on this screen, never the server's label.
                expected={{ contract: "config", functionName: "setBlocked", args: [call.account, true] }}
                signLabel="Sign and send the on-chain block"
                successTitle="Blocked on chain"
                successDescription="The contracts refuse the wallet once this lands. Only the contracts' admin key can lift it on chain."
                afterExport="Open the file in the arbiter's multi-signer wallet and sign it there. The contracts refuse the wallet once it lands."
                onRetry={onRetryChain ? () => onRetryChain(created) : undefined}
              />
            </section>
          ) : null}
        </div>,
      );
      setTarget(null);
      setReason("");
      setNote("");
      setTicket("");
      setOnChain(false);
      setPickedChain(null);
      onOpenChange(false);
    },
  });

  // A refusal from the last attempt is not about this opening. (A typed draft is kept.)
  const { reset: resetBlock } = block;
  React.useEffect(() => {
    if (open) resetBlock();
  }, [open, resetBlock]);

  const submit = () => {
    const next = {
      target: picked ? (alreadyBlocked ? "This account is already blocked." : undefined) : "Search for the account to block.",
      reason: reason ? undefined : "Pick a reason.",
      note: note.trim().length < BLOCK_NOTE_MIN ? `Write at least ${BLOCK_NOTE_MIN} characters: what happened, and who reported it.` : undefined,
    };
    setErrors(next);
    if (next.target || next.reason || next.note) return;
    // Several chains and none picked: say so rather than block off-chain only.
    if (onChain && evm && chainId === null) return;
    block.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (block.isPending ? undefined : onOpenChange(next))}>
      <SheetContent
        showCloseButton={!block.isPending}
        // Never focus (and so open) the account search on opening: its list would cover the reason and note,
        // and on a phone raise the keyboard. The list opens when the person taps or types. Focus still
        // moves into the sheet: to the first reason when the account came with the link, else the title.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const firstReason = prefill ? reasonsRef.current?.querySelector<HTMLElement>('[role="radio"]') : null;
          (firstReason ?? titleRef.current)?.focus();
        }}
      >
        <SheetHeader className="tablet:pt-5">
          <SheetTitle ref={titleRef} tabIndex={-1} className="pr-8 focus:outline-none">
            Block an account
          </SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens
            lines={[
              { icon: Ban, text: "The Assay block needs only you: it stops paying and being paid through Assay within seconds, on every instance" },
              { icon: Users, text: "Lifting the Assay block later needs two people" },
              ...(onChain && evm && chainId
                ? [
                    {
                      icon: Link2,
                      text: `On ${chainDisplayName(chainId)} it needs a second person: ${chainNeeds} approves, then the arbiter signs. Nothing is blocked on chain until it lands, and only the contracts' admin key can lift it there`,
                    },
                  ]
                : []),
              { icon: ShieldCheck, text: "Recorded in Activity under your name" },
            ]}
          />
          <EntityPicker
            inline
            label="Who"
            value={target}
            selectedLabel={shownLabel}
            onChange={(id, option) => {
              setTarget(id);
              setTargetLabel(option?.label);
              setErrors((e) => ({ ...e, target: undefined }));
            }}
            search={searchTargets}
            placeholder="Wallet 0x…, provider name or organization id"
            emptyText={noTargetText}
            error={errors.target}
          />
          {picked ? (
            <div className="flex w-full flex-col gap-1 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-02">
              {picked.kind === "ORGANIZATION" ? (
                provider ? (
                  <p>
                    <span className="text-label-13 text-01">{provider.legalName}</span>: {provider.activeBindings} live tool
                    {provider.activeBindings === 1 ? "" : "s"}
                    {provider.stake.length > 0 ? `, ${stakedPhrase(provider.stake)}` : ""}.
                    Its tools stop being paid and its agents stop paying.
                  </p>
                ) : (
                  <p>The organization&rsquo;s agents stop paying and its tools stop being paid.</p>
                )
              ) : (
                <p>This wallet can no longer pay or be paid through Assay, on any EVM chain.</p>
              )}
              {alreadyBlocked ? <p className="text-danger-600">It is already blocked, by {directory.nameOf(alreadyBlocked.blockedBy)}.</p> : null}
            </div>
          ) : null}
          <div ref={reasonsRef} className="contents">
            <ReasonChips
              label="Why"
              options={BLOCK_REASONS}
              value={reason}
              onChange={setReason}
              note={note}
              onNoteChange={setNote}
              noteLabel="Note (internal, never shown to the account)"
              noteMin={BLOCK_NOTE_MIN}
              noteMax={BLOCK_NOTE_MAX}
              notePlaceholder="What happened, and who reported it."
              errors={errors}
            />
          </div>
          <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="INC-123" maxLength={128} />
          {canChain ? (
            <div className="flex w-full flex-col gap-1">
              <Switch
                checked={onChain && evm !== null && chains.ids.length > 0}
                disabled={evm === null || chains.ids.length === 0}
                onChange={(e) => setOnChain(e.target.checked)}
                label="Also block on chain"
              />
              <p className="text-body-xs text-03">
                {picked?.kind !== "WALLET"
                  ? "For a wallet only: pick a wallet (0x…) above to turn this on. An organization is blocked here, not on chain."
                  : evm === null
                  ? "Only an EVM wallet can be blocked on chain."
                  : chains.isError
                    ? "The chain could not be read just now, so this cannot be built. Block it on chain from its row later."
                    : chains.isLoading
                      ? "Reading the chain…"
                      : chainId === null
                        ? "Pick the chain to block it on."
                        : `The contracts on ${chainDisplayName(chainId)} then refuse the wallet too. ${capitalFirst(chainNeeds)} approves it, then the arbiter signs; only the contracts' admin key can lift it there.`}
              </p>
              {onChain && evm ? <ChainChoice ids={chains.ids} value={chainId} onChange={setPickedChain} /> : null}
              {onChain && evm && chainId ? <ChainBlockPreview account={evm} chainId={chainId} /> : null}
            </div>
          ) : null}
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <div role="alert" className={block.error ? "text-body-xs text-danger-600" : "sr-only"}>
            {block.error ? blockErrorMessage(block.error, "block").replace(/\s*\([A-Z_]+\)$/, "") : ""}
            {block.error instanceof ApiError ? (
              <details className="mt-1 text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="font-mono text-mono-xs">{block.error.code}</span>
              </details>
            ) : null}
          </div>
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={block.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button variant="danger" loading={block.isPending} onClick={submit} disabled={onChain && evm !== null && chainId === null}>
              {onChain && evm ? "Block, and ask to block on chain" : "Block account"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── On-chain block of an existing wallet block (A-11) ──────────────────────

/**
 * The chains an on-chain block can be built for: the ones the platform reports
 * that this build has pinned contracts for (the guard refuses any other).
 * With several, the operator picks one; it is never chosen silently, and the
 * one used is always named (operator review 2026-10-16b, P1-5).
 */
function useBlockChains(enabled: boolean) {
  const health = useQuery({ ...operatorQueries.health(), enabled, retry: 0 });
  const ids = React.useMemo(() => {
    if (!health.data) return [];
    const reported = health.data.chainState.map((state) => state.chainId).filter((id) => stakeDeploymentFor(id) !== null);
    return reported.length > 0 ? [...new Set(reported)] : [ROBINHOOD_TESTNET_STAKE.chainId];
  }, [health.data]);
  return { ids, isError: health.isError, isLoading: health.isLoading, refetch: health.refetch };
}

/** One chain named, or a picker when there are several. */
function ChainChoice({ ids, value, onChange }: { ids: readonly string[]; value: string | null; onChange: (id: string) => void }) {
  if (ids.length <= 1) return null;
  return (
    <Select label="Chain" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="" disabled>
        Pick the chain to block on
      </option>
      {ids.map((id) => (
        <option key={id} value={id}>
          {chainDisplayName(id)}
        </option>
      ))}
    </Select>
  );
}

/** The call the arbiter will sign, in plain words, before anything is sent. */
function ChainBlockPreview({ account, chainId }: { account: string; chainId: string }) {
  const lines = callSummary({
    functionName: "setBlocked",
    args: [account, true],
    contract: "config",
    to: stakeDeploymentFor(chainId)?.configContract ?? "",
    chainId,
    signer: null,
  });
  return (
    <section aria-label="What the arbiter will sign" className="flex w-full flex-col gap-2 rounded-lg border border-01 bg-02 px-3 py-2.5">
      <h3 className="text-label-13 text-01">What the arbiter will sign</h3>
      <dl className="grid w-full grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 text-body-13">
        {lines.map((line) => (
          <React.Fragment key={line.label}>
            <dt className="text-03">{line.label}</dt>
            <dd className="min-w-0 text-01 [overflow-wrap:anywhere]">{line.value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <p className="text-body-xs text-03">The call is built once approved, and only offered for signing if it is exactly this.</p>
    </section>
  );
}

/**
 * Its stake as "bonded", per chain: the same measure Home's "Stake bonded"
 * tile sums over every provider, so the two read as one figure, not two that
 * disagree.
 */
function stakedPhrase(stake: readonly { chainId: string; amount: string; asset: string; decimals: number }[]): string {
  const parts = stake.map((s) => `${formatMoney({ amount: s.amount, asset: s.asset, decimals: s.decimals })} on ${chainDisplayName(s.chainId)}`);
  return `stake bonded: ${parts.join(" and ")}`;
}

/** An on-chain block request (A-11) queued for a second operator: who approves it, and that nothing is blocked on chain yet. */
function QueuedChainBlock({
  approval,
  needs,
  approvers,
  onDismiss,
}: {
  approval: ApprovalQueued;
  needs: string;
  approvers: string[] | undefined;
  onDismiss?: () => void;
}) {
  const sent = sentForApproval("The on-chain block", approvers, needs, approval.expiresAt);
  return (
    <div className="flex w-full flex-col gap-2">
      <ResultCard
        tone="queued"
        title={sent.title}
        next={`${sent.next} Once approved, the approver gets the unsigned call for the arbiter's wallet to sign; it is also listed on Arbiter.`}
        link={{ label: "Open the request", href: approvalHref(approval.approvalId) }}
        onDismiss={onDismiss}
      />
      <ApprovalFooter needs={needs} approvers={approvers} link={approvalHref(approval.approvalId)} expiresAt={approval.expiresAt} />
    </div>
  );
}

function ChainBlockSheet({ block, label, onClose }: { block: AccountBlock | null; label: string; onClose: () => void }) {
  const me = useOperatorSession();
  const directory = useOperatorDirectory();
  const needs = approverPhrase("A-11", me.roles);
  const approvers = directory.isPending ? undefined : eligibleApprovers("A-11", directory.operators, me.id);
  const chains = useBlockChains(block !== null);
  const [pickedChain, setPickedChain] = React.useState<string | null>(null);
  const chainId = chains.ids.length === 1 ? chains.ids[0]! : pickedChain && chains.ids.includes(pickedChain) ? pickedChain : null;
  const account = block ? evmAddressOf(block.subject) : null;
  // Nothing is sent when the sheet opens: only on "Send for approval" (operator review 2026-10-16b, P1-5).
  const build = useMutation({
    mutationFn: ({ input, chain }: { input: AccountBlock; chain: string }) =>
      createArbiterBlockIntent({
        chainId: chain,
        account: evmAddressOf(input.subject)!,
        reasonCode: input.reasonCode,
        // The block's own reason and note (at least 20 characters, as every block has) go on the record.
        note: input.note,
        ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      }),
  });
  const { reset } = build;
  const [signing, setSigning] = React.useState(false);
  React.useEffect(() => {
    if (!block) {
      reset();
      setPickedChain(null);
    }
  }, [block, reset]);
  const send = () => block && chainId && build.mutate({ input: block, chain: chainId });

  return (
    <Sheet open={block !== null} onOpenChange={(open) => (!open && !signing && !build.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!signing} aria-describedby={undefined}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Block {label} on chain</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-4 pt-3">
          {build.data?.kind === "queued" ? (
            <QueuedChainBlock approval={build.data.approval} needs={needs} approvers={approvers} />
          ) : build.data && block ? (
            <ContractCallAction
              call={build.data.result}
              // The blocked wallet itself, never the server's label.
              expected={{ contract: "config", functionName: "setBlocked", args: [evmAddressOf(block.subject)!, true] }}
              signLabel="Sign and send the on-chain block"
              successTitle="Blocked on chain"
              successDescription="The contracts refuse the wallet once this lands. Only the contracts' admin key can lift it on chain."
              afterExport="Open the file in the arbiter's multi-signer wallet and sign it there."
              onBusyChange={setSigning}
              onRetry={send}
            />
          ) : (
            <>
              <WhatHappens
                lines={[
                  {
                    icon: Ban,
                    text: `The contracts${chainId ? ` on ${chainDisplayName(chainId)}` : ""} refuse the wallet as a party to payments, deposits, withdrawals and execution`,
                  },
                  { icon: Users, text: `${capitalFirst(needs)} approves the request first` },
                  { icon: PenLine, text: "Then the arbiter's wallet signs it. Nothing is blocked on chain until it lands" },
                  { icon: Link2, text: "Only the contracts' admin key can lift it on chain" },
                ]}
              />
              {chains.isError ? (
                <PageState
                  kind="error"
                  title="The chain could not be read"
                  description="Assay could not tell which chains it can block on. Try again in a moment."
                  onRetry={() => void chains.refetch()}
                  bare
                />
              ) : chains.isLoading ? (
                <PageState kind="loading" rows={1} label="Reading the chain" bare />
              ) : (
                <>
                  <ChainChoice ids={chains.ids} value={chainId} onChange={setPickedChain} />
                  {account && chainId ? <ChainBlockPreview account={account} chainId={chainId} /> : null}
                  <ApprovalFooter needs={needs} approvers={approvers} />
                </>
              )}
              {build.isError ? (
                <div role="alert" className="flex flex-col gap-1 text-body-13 text-danger-600">
                  <p>The request could not be sent. {arbiterErrorMessage(build.error, "block").replace(/\s*\([A-Z_]+\)$/, "")}</p>
                  {build.error instanceof ApiError ? (
                    <details className="text-03">
                      <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                      <span className="font-mono text-mono-xs">{build.error.code}</span>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        {!build.data ? (
          <SheetFooter className={OPERATOR_SHEET_FOOTER}>
            <div className={OPERATOR_SHEET_BUTTONS}>
              <SheetClose asChild>
                <Button variant="secondary" disabled={build.isPending}>
                  Cancel
                </Button>
              </SheetClose>
              <Button variant="danger" loading={build.isPending} disabled={!chainId || !account} onClick={send}>
                Send for approval
              </Button>
            </div>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ── Lift (A-10, two-person) ─────────────────────────────────────────────────

function LiftSheet({
  block,
  label,
  waiting,
  nameOf,
  approvers,
  onClose,
  onDone,
}: {
  block: AccountBlock | null;
  label: string;
  /** A request to lift this block that is already waiting, if any. */
  waiting: OperatorApproval | null;
  nameOf: (subject: string | null | undefined) => string;
  approvers: string[] | undefined;
  onClose: () => void;
  onDone: (node: React.ReactNode) => void;
}) {
  const queryClient = useQueryClient();
  const me = useOperatorSession();
  // "a Lead adjudicator" for Support, "a second Lead adjudicator" for a Lead.
  const needs = approverPhrase("A-10", me.roles);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});

  const lift = useMutation({
    mutationFn: (input: { id: string; reasonCode: string; note: string }) =>
      unblockAccount(input.id, { reasonCode: input.reasonCode, note: input.note }),
    onSuccess: (answer) => {
      refreshAfter(queryClient, AFTER_BLOCK_LIFT);
      const sent = answer.kind === "queued" ? sentForApproval(`Lifting the block on ${label}`, approvers, needs, answer.approval.expiresAt) : null;
      onDone(
        answer.kind === "queued" && sent ? (
          <div className="flex w-full flex-col gap-2">
            <ResultCard
              tone="queued"
              title={sent.title}
              next={`${sent.next} Until then ${label} stays blocked.`}
              link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }}
              onDismiss={() => onDone(null)}
            />
            <ApprovalFooter needs={needs} approvers={approvers} link={approvalHref(answer.approval.approvalId)} expiresAt={answer.approval.expiresAt} />
          </div>
        ) : (
          <ResultCard title={`The block on ${label} is lifted`} next="It applies within seconds." onDismiss={() => onDone(null)} />
        ),
      );
      setReason("");
      setNote("");
      onClose();
    },
  });  const { reset: resetLift } = lift;
  React.useEffect(() => {
    setReason("");
    setNote("");
    setErrors({});
    resetLift();
  }, [block?.id, resetLift]);

  const submit = () => {
    if (!block || waiting) return;
    const validated = validateUnblockForm({ reasonCode: reason, note, ticketRef: "" });
    const next = {
      reason: reason ? undefined : "Pick a reason.",
      note: validated.ok ? undefined : validated.errors.note,
    };
    setErrors(next);
    if (!validated.ok || next.reason) return;
    lift.mutate({ id: block.id, reasonCode: validated.body.reasonCode, note: validated.body.note });
  };

  return (
    <Sheet open={block !== null} onOpenChange={(open) => (!open && !lift.isPending ? onClose() : undefined)}>
      <SheetContent showCloseButton={!lift.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Lift the block on {label}?</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens
            lines={[
              { icon: Undo2, text: `Once approved, ${label} can use Assay again within seconds` },
              { icon: Ban, text: "Until then it stays blocked" },
            ]}
          />
          {waiting ? (
            <div role="status" className="flex w-full flex-col gap-1 rounded-lg border border-warning-20 bg-warning-10 px-3.5 py-2.5 text-body-13 text-02">
              <p className="text-label-13 text-01">A request to lift this block is already waiting</p>
              <p>
                {nameOf(waiting.requestedBy)} asked <UtcTime value={waiting.createdAt} />. A second request would wait for the same
                approvers, so it is not sent.{" "}
                <Link href={approvalHref(waiting.id)} className="hit-area text-primary-600 hover:underline">
                  Open the waiting request
                </Link>
              </p>
            </div>
          ) : null}
          <ReasonChips
            label="Why"
            options={UNBLOCK_REASONS}
            value={reason}
            onChange={setReason}
            note={note}
            onNoteChange={setNote}
            noteMin={BLOCK_NOTE_MIN}
            noteMax={BLOCK_NOTE_MAX}
            notePlaceholder="What changed, and how you checked it."
            errors={errors}
          />
          <ApprovalFooter needs={needs} approvers={approvers} />
        </div>
        <SheetFooter className={OPERATOR_SHEET_FOOTER}>
          <div role="alert" className={lift.error ? "text-body-xs text-danger-600" : "sr-only"}>
            {lift.error ? blockErrorMessage(lift.error, "unblock").replace(/\s*\([A-Z_]+\)$/, "") : ""}
          </div>
          <div className={OPERATOR_SHEET_BUTTONS}>
            <SheetClose asChild>
              <Button variant="secondary" disabled={lift.isPending}>
                Keep it blocked
              </Button>
            </SheetClose>
            <Button loading={lift.isPending} disabled={waiting !== null} onClick={submit}>
              Send for approval
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function BlocksPage() {
  return (
    <React.Suspense fallback={null}>
      <BlocksScreen />
    </React.Suspense>
  );
}
