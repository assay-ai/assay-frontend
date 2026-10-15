"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, Clock, MoreHorizontal, Plus, Search, ShieldCheck, Undo2, Users } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { approvalTargetId } from "@/features/operator/approvals";
import { arbiterErrorMessage, mayBlockOnChain } from "@/features/operator/arbiter";
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
import { ContractCallAction } from "@/features/operator/contract-call-action";
import { eligibleApprovers } from "@/features/operator/inbox";
import { BLOCK_REASONS, UNBLOCK_REASONS, reasonLabel } from "@/features/operator/reasons";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref, approverPhrase, sentForApproval } from "@/features/operator/two-person";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import { WhatHappens } from "@/features/operator/what-happens";
import { WhyNot } from "@/features/operator/why-not";
import { OPERATOR_SHEET_BUTTONS, OPERATOR_SHEET_FOOTER } from "@/features/operator/sheet-footer";
import type { AccountBlock, BlockSubjectKind, OperatorApproval } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";
import {
  createAccountBlock,
  createArbiterBlockIntent,
  getPlatformHealth,
  listAccountBlocks,
  listApprovals,
  unblockAccount,
} from "@/services/operator.service";
import { cn } from "@/utils";
import { formatMoney } from "@/utils/money";

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

type Filter = "active" | "lifted";

function BlocksScreen() {
  const me = useOperatorSession();
  const canAct = mayBlock(me.roles);
  const canChain = mayBlockOnChain(me.roles);
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filter, setFilter] = React.useState<Filter>("active");
  const [search, setSearch] = React.useState("");
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [prefill, setPrefill] = React.useState<{ kind: BlockSubjectKind; subject: string } | null>(null);
  const [lifting, setLifting] = React.useState<AccountBlock | null>(null);
  const [chainBlocking, setChainBlocking] = React.useState<AccountBlock | null>(null);
  const [openNote, setOpenNote] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<React.ReactNode>(null);

  // Lifts already waiting for approval, by block id — the same query as the badge.
  const pendingQuery = useQuery({
    queryKey: ["operator", "approvals", "pending-count"],
    queryFn: () => listApprovals({ status: "PENDING", limit: 100 }),
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
    if ((!subject && !fresh) || !canAct) return;
    setPrefill(subject ? { kind: searchParams.get("kind") === "WALLET" ? "WALLET" : "ORGANIZATION", subject } : null);
    setBlockOpen(true);
  }, [searchParams, canAct]);
  // The link's params go when the sheet closes, so a reload does not open it again.
  const onBlockOpenChange = (open: boolean) => {
    setBlockOpen(open);
    if (!open && (searchParams.has("new") || searchParams.has("block"))) router.replace(pathname, { scroll: false });
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
      [label(row), row.subject, reasonLabel(row.reasonCode), row.blockedBy, directory.nameOf(row.blockedBy), row.ticketRef ?? "", row.note]
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
            className="w-full tablet:w-auto"
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

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
        <Segmented value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Which blocks" className="self-start">
          {(["active", "lifted"] as const).map((tab) => {
            const count = countOf(tab);
            return (
              <SegmentedItem key={tab} value={tab}>
                {tab === "active" ? "Active" : "Lifted"}
                {count !== null ? <span className="ml-1.5 tabular-nums text-03">{count}</span> : null}
              </SegmentedItem>
            );
          })}
        </Segmented>
        <label className="flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 tablet:max-w-[320px]">
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
                          {directory.nameOf(block.blockedBy)} · <LocalTime value={block.blockedAt} dateOnly />
                        </>
                      ) : (
                        <>
                          {directory.nameOf(block.unblockedBy)}
                          {block.unblockApprovedBy ? <span className="text-03">, approved by {directory.nameOf(block.unblockApprovedBy)}</span> : null} ·{" "}
                          <LocalTime value={block.unblockedAt} dateOnly />
                        </>
                      )}
                    </span>
                    <div className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-2 tablet:mt-0 tablet:w-auto tablet:justify-end">
                      {waiting ? (
                        <Button variant="secondary" size="sm" asChild className="min-w-0 flex-1 tablet:flex-none">
                          <Link href={approvalHref(waiting.id)}>View request</Link>
                        </Button>
                      ) : block.active && canAct ? (
                        <Button variant="secondary" size="sm" onClick={() => setLifting(block)} className="min-w-0 flex-1 tablet:flex-none">
                          Lift block
                        </Button>
                      ) : null}
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" aria-label={`More for ${label(block)}`} className="touch-target ml-auto tablet:ml-0">
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[200px] border border-01">
                          <DropdownMenuItem onSelect={() => setOpenNote(noteOpen ? null : block.id)}>{noteOpen ? "Hide the note" : "Show the note"}</DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/operator/override-log?targetId=${encodeURIComponent(block.id)}`}>History in Activity</Link>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill: { kind: BlockSubjectKind; subject: string } | null;
  canChain: boolean;
  activeBlocks: readonly AccountBlock[];
  onDone: (node: React.ReactNode) => void;
}) {
  const queryClient = useQueryClient();
  const providers = useProviderNames();
  const directory = useOperatorDirectory();
  const health = useQuery({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, enabled: open && canChain, retry: 0 });
  const [target, setTarget] = React.useState<string | null>(null);
  const [targetLabel, setTargetLabel] = React.useState<string | undefined>(undefined);
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [ticket, setTicket] = React.useState("");
  const [onChain, setOnChain] = React.useState(false);
  const [errors, setErrors] = React.useState<{ target?: string; reason?: string; note?: string }>({});

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
  const chainId = health.data ? (health.data.chainState?.[0]?.chainId ?? ROBINHOOD_TESTNET_STAKE.chainId) : null;

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
      let call: SlashContractCall | null = null;
      let chainError: unknown = null;
      if (onChain && evm && chainId) {
        try {
          call = await createArbiterBlockIntent({ chainId, account: evm, reasonCode: reason, note: note.trim(), ...(ticket.trim() ? { ticketRef: ticket.trim() } : {}) });
        } catch (error) {
          chainError = error;
        }
      }
      return { created, call, chainError };
    },
    onSuccess: ({ created, call, chainError }) => {
      void queryClient.invalidateQueries({ queryKey: ["operator", "blocks"] });
      const name = blockSubjectLabel(created, providers.lookup);
      onDone(
        <div className="flex w-full flex-col gap-3">
          <ResultCard
            title={`${name} is blocked`}
            next={
              call
                ? "It applies within seconds. Now have the arbiter sign the on-chain block below."
                : chainError
                  ? `It applies within seconds. The on-chain block could not be prepared: ${arbiterErrorMessage(chainError, "block").replace(/\s*\([A-Z_]+\)$/, "")} Use "Block on chain" on its row to try again.`
                  : "It applies within seconds on every instance. Lifting it needs two people."
            }
            activityHref={`/operator/override-log?targetId=${encodeURIComponent(created.id)}`}
            onDismiss={() => onDone(null)}
          />
          {call ? (
            <section className="flex w-full flex-col gap-2 rounded-xl border border-01 bg-01 p-4">
              <p className="text-label-13 text-01">Also block on chain</p>
              <ContractCallAction
                call={call}
                signLabel="Sign and send the on-chain block"
                successTitle="Blocked on chain"
                successDescription="The contracts refuse the wallet once this lands. Only the admin can lift it."
                afterExport="Import the file in the Safe that holds the arbiter key and sign it there. The contracts refuse the wallet once it lands."
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
    block.mutate();
  };

  return (
    <Sheet open={open} onOpenChange={(next) => (block.isPending ? undefined : onOpenChange(next))}>
      <SheetContent
        showCloseButton={!block.isPending}
        // Never focus (and so open) the account search on opening: its list would cover the reason and note,
        // and on a phone raise the keyboard. The list opens when the person taps or types.
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Block an account</SheetTitle>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-3">
          <WhatHappens
            lines={[
              { icon: Ban, text: "It stops paying and being paid through Assay within seconds" },
              { icon: Users, text: "Lifting it later needs two people" },
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
                    {provider.stake.length > 0 ? `, ${provider.stake.map((s) => formatMoney({ amount: s.amount, asset: s.asset, decimals: s.decimals })).join(" + ")} staked` : ""}.
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
          <Field label="Ticket (optional)" value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="INC-123" maxLength={128} />
          {canChain ? (
            <div className="flex w-full flex-col gap-1">
              <Switch
                checked={onChain && evm !== null && chainId !== null}
                disabled={evm === null || chainId === null}
                onChange={(e) => setOnChain(e.target.checked)}
                label="Also block on chain"
              />
              <p className="text-body-xs text-03">
                {picked?.kind !== "WALLET"
                  ? "For a wallet only: pick a wallet (0x…) above to turn this on. An organization is blocked here, not on chain."
                  : evm === null
                  ? "Only an EVM wallet can be blocked on chain."
                  : chainId === null
                    ? health.isError
                      ? "The chain could not be read just now, so this cannot be built. Block it on chain from its row later."
                      : "Reading the chain…"
                  : "The contracts then refuse the wallet too. The arbiter signs it next; only the admin can lift it."}
              </p>
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
            <Button variant="danger" loading={block.isPending} onClick={submit}>
              {onChain && evm && chainId ? "Block, then sign on chain" : "Block account"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── On-chain block of an existing wallet block (A-11) ──────────────────────

function ChainBlockSheet({ block, label, onClose }: { block: AccountBlock | null; label: string; onClose: () => void }) {
  const health = useQuery({ queryKey: ["operator", "health"], queryFn: getPlatformHealth, enabled: block !== null, retry: 0 });
  const chainId = health.data?.chainState?.[0]?.chainId ?? ROBINHOOD_TESTNET_STAKE.chainId;
  const build = useMutation({
    mutationFn: (input: AccountBlock) =>
      createArbiterBlockIntent({
        chainId,
        account: evmAddressOf(input.subject)!,
        reasonCode: input.reasonCode,
        // The block's own reason and note (at least 20 characters, as every block has) go on the record.
        note: input.note,
        ...(input.ticketRef ? { ticketRef: input.ticketRef } : {}),
      }),
  });
  const { mutate, reset } = build;
  const [signing, setSigning] = React.useState(false);
  const chainKnown = health.data !== undefined;
  React.useEffect(() => {
    // Built only once the chain is known: a fallback chain would build the block for the wrong one.
    if (block && chainKnown) mutate(block);
    if (!block) reset();
  }, [block, chainKnown, mutate, reset]);

  return (
    <Sheet open={block !== null} onOpenChange={(open) => (!open && !signing ? onClose() : undefined)}>
      <SheetContent showCloseButton={!signing}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Also block {label} on chain?</SheetTitle>
          <SheetDescription>
            The contracts then refuse it as a party to payments, deposits, withdrawals and execution. The arbiter signs it; only the
            admin can lift it.
          </SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pb-6 pt-4">
          {health.isError ? (
            <PageState
              kind="error"
              title="The chain could not be read"
              description="Assay could not tell which chain to block on. Try again in a moment."
              onRetry={() => void health.refetch()}
              bare
            />
          ) : build.isPending || build.isIdle ? (
            <PageState kind="loading" rows={2} label="Preparing the on-chain block" bare />
          ) : build.isError ? (
            <PageState
              kind="error"
              title="The on-chain block could not be prepared"
              description={arbiterErrorMessage(build.error, "block").replace(/\s*\([A-Z_]+\)$/, "")}
              onRetry={() => block && mutate(block)}
              code={build.error instanceof ApiError ? build.error.code : null}
              bare
            />
          ) : build.data ? (
            <ContractCallAction
              call={build.data}
              signLabel="Sign and send the on-chain block"
              successTitle="Blocked on chain"
              successDescription="The contracts refuse the wallet once this lands."
              afterExport="Import the file in the Safe that holds the arbiter key and sign it there."
              onBusyChange={setSigning}
            />
          ) : null}
        </div>
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
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
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
                {nameOf(waiting.requestedBy)} asked <LocalTime value={waiting.createdAt} />. A second request would wait for the same
                approvers, so it is not sent.{" "}
                <Link href={approvalHref(waiting.id)} className="text-primary-600 hover:underline">
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
