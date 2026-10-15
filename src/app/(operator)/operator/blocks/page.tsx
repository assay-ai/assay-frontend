"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { ApprovalFooter } from "@/components/patterns/approval-footer";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { LocalTime } from "@/components/patterns/local-time";
import { PageState } from "@/components/patterns/page-state";
import { ReasonChips } from "@/components/patterns/reason-chips";
import { StatusChip } from "@/components/patterns/status-chip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { approvalNeeds } from "@/features/operator/approvals";
import { mayBlockOnChain } from "@/features/operator/arbiter";
import {
  blockSubjectLabel,
  evmAddressOf,
  noTargetText,
  pickedTarget,
  searchBlockTargets,
  targetId,
} from "@/features/operator/block-targets";
import { BLOCK_NOTE_MAX, BLOCK_NOTE_MIN, blockErrorMessage, mayBlock, validateBlockForm, validateUnblockForm } from "@/features/operator/blocks";
import { ContractCallAction } from "@/features/operator/contract-call-action";
import { eligibleApprovers } from "@/features/operator/inbox";
import { BLOCK_REASONS, UNBLOCK_REASONS, reasonLabel } from "@/features/operator/reasons";
import { ResultCard } from "@/features/operator/result-card";
import { useOperatorSession } from "@/features/operator/session-context";
import { approvalHref } from "@/features/operator/two-person";
import { useOperatorDirectory, useProviderNames } from "@/features/operator/use-operator-lookups";
import type { AccountBlock, BlockSubjectKind } from "@/interfaces/operator";
import type { SlashContractCall } from "@/interfaces/slash-dispute";
import { ApiError } from "@/libs/ApiClient";
import { ROBINHOOD_TESTNET_STAKE } from "@/libs/chains/evm/stake-slashes/deployments";
import {
  createAccountBlock,
  createArbiterBlockIntent,
  getPlatformHealth,
  listAccountBlocks,
  unblockAccount,
} from "@/services/operator.service";
import { formatMoney } from "@/utils/money";

/**
 * Blocks, route `/operator/blocks`.
 *
 * Block an account in under a minute: one search box (a wallet, a provider's
 * name, an organization id — the kind is inferred), what the block will stop,
 * a reason chip and a note. For a wallet, "Also block on chain" builds the
 * arbiter's `setBlocked` in the same flow. Lifting is two-person: the sheet
 * says who can approve it.
 *
 * `?block=<id>&kind=ORGANIZATION|WALLET` opens the form prefilled — the case
 * and arbiter pages link here with it.
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
  const [result, setResult] = React.useState<React.ReactNode>(null);

  // A link from a case or the arbiter page opens the form prefilled, once.
  React.useEffect(() => {
    const subject = searchParams.get("block");
    if (!subject || !canAct) return;
    const kind = searchParams.get("kind") === "WALLET" ? "WALLET" : "ORGANIZATION";
    setPrefill({ kind, subject });
    setBlockOpen(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, canAct, router, pathname]);

  const list = useInfiniteQuery({
    queryKey: ["operator", "blocks", "list", { active: filter === "active" }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listAccountBlocks({ active: filter === "active", cursor: pageParam, limit: LIST_LIMIT }),
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    retry: 0,
  });
  const rows = React.useMemo(() => (list.data?.pages ?? []).flatMap((page) => page.items), [list.data]);
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

  return (
    <>
      <header className="flex w-full flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="text-heading-md text-01">Blocks</h1>
          <p className="text-body-13 text-03">A blocked account cannot pay or be paid through Assay. It applies within seconds.</p>
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

      {result ? <div className="w-full">{result}</div> : null}

      <div className="flex w-full flex-col gap-2.5 tablet:flex-row tablet:items-center tablet:justify-between">
        <Segmented value={filter} onValueChange={(value) => setFilter(value as Filter)} aria-label="Which blocks" className="self-start">
          <SegmentedItem value="active">Active</SegmentedItem>
          <SegmentedItem value="lifted">Lifted</SegmentedItem>
        </Segmented>
        <label className="flex w-full items-center gap-2 rounded-md border border-02 bg-01 px-3 py-2 focus-within:ring-2 focus-within:ring-primary-500 tablet:max-w-[320px]">
          <Search aria-hidden="true" className="size-4 shrink-0 text-03" />
          <span className="sr-only">Search blocks</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, wallet, reason, who"
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
        <ul className="flex w-full flex-col gap-2">
          {shown.map((block) => (
            <li key={block.id} className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-01 bg-01 p-4 tablet:flex-row tablet:items-center tablet:gap-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label-13 text-01">{label(block)}</span>
                  <StatusChip status={block.active ? "blocked" : "closed"} detail={block.active ? undefined : "lifted"} />
                  <span className="text-body-xs text-03">{block.subjectKind === "ORGANIZATION" ? "Organization" : "Wallet"}</span>
                </div>
                <p className="text-body-13 text-02">
                  {reasonLabel(block.reasonCode)} · blocked by {directory.nameOf(block.blockedBy)} · <LocalTime value={block.blockedAt} />
                  {block.ticketRef ? ` · ${block.ticketRef}` : ""}
                </p>
                {block.unblockedAt ? (
                  <p className="text-body-xs text-03">
                    Lifted by {directory.nameOf(block.unblockedBy)}, approved by {directory.nameOf(block.unblockApprovedBy)} ·{" "}
                    <LocalTime value={block.unblockedAt} />
                  </p>
                ) : null}
                <p className="text-body-xs text-03 [overflow-wrap:anywhere]">{block.note}</p>
              </div>
              <div className="flex shrink-0 flex-row gap-2">
                <Button variant="ghost" size="sm" asChild>
                  <Link href={`/operator/override-log?targetId=${encodeURIComponent(block.id)}`}>History</Link>
                </Button>
                {block.active && canAct ? (
                  <Button variant="secondary" size="sm" onClick={() => setLifting(block)}>
                    Lift block
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage ? (
        <Button variant="secondary" className="self-start" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          Load more
        </Button>
      ) : null}

      {canAct ? (
        <BlockSheet
          open={blockOpen}
          onOpenChange={setBlockOpen}
          prefill={prefill}
          canChain={canChain}
          activeBlocks={filter === "active" ? rows : []}
          onDone={setResult}
        />
      ) : null}
      {canAct ? (
        <LiftSheet
          block={lifting}
          label={lifting ? label(lifting) : ""}
          approvers={directory.isPending ? undefined : eligibleApprovers("A-10", directory.operators, me.id)}
          onClose={() => setLifting(null)}
          onDone={setResult}
        />
      ) : null}
    </>
  );
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
  const provider = picked?.kind === "ORGANIZATION" ? providers.providers.find((p) => p.providerId === picked.subject) : undefined;
  const evm = picked?.kind === "WALLET" ? evmAddressOf(picked.subject) : null;
  const alreadyBlocked = picked
    ? activeBlocks.find((b) => b.subjectKind === picked.kind && (b.subject === picked.subject.toLowerCase() || b.subjectKey.endsWith(picked.subject.toLowerCase())))
    : undefined;
  const chainId = health.data?.chainState?.[0]?.chainId ?? ROBINHOOD_TESTNET_STAKE.chainId;

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
      if (onChain && evm) {
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
                  ? `It applies within seconds. The on-chain block could not be prepared: ${blockErrorMessage(chainError, "block")} Try it from the Arbiter page.`
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
      <SheetContent showCloseButton={!block.isPending}>
        <SheetHeader className="tablet:pt-5">
          <SheetTitle className="pr-8">Block an account</SheetTitle>
          <SheetDescription>It stops paying and being paid through Assay within seconds. Lifting it later needs two people.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
          <EntityPicker
            label="Who"
            value={target}
            selectedLabel={targetLabel}
            onChange={(id, option) => {
              setTarget(id);
              setTargetLabel(option?.label);
              setErrors((e) => ({ ...e, target: undefined }));
            }}
            search={async (q) => searchBlockTargets(q, providers.providers)}
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
              {alreadyBlocked ? <p className="text-danger-600">It is already blocked, by {alreadyBlocked.blockedBy}.</p> : null}
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
          {canChain && picked?.kind === "WALLET" ? (
            <div className="flex w-full flex-col gap-1">
              <Switch
                checked={onChain && evm !== null}
                disabled={evm === null}
                onChange={(e) => setOnChain(e.target.checked)}
                label="Incident: also block on chain"
              />
              <p className="text-body-xs text-03">
                {evm === null
                  ? "Only an EVM wallet can be blocked on chain."
                  : "The contracts then refuse the wallet too. The arbiter signs it next; only the admin can lift it."}
              </p>
            </div>
          ) : null}
        </div>
        <SheetFooter className="sticky bottom-0 bg-01">
          <div role="alert" className={block.error ? "text-body-xs text-danger-600" : "sr-only"}>
            {block.error ? blockErrorMessage(block.error, "block").replace(/\s*\([A-Z_]+\)$/, "") : ""}
            {block.error instanceof ApiError ? (
              <details className="mt-1 text-03">
                <summary className="cursor-pointer select-none text-label-xs">Details</summary>
                <span className="font-mono text-mono-xs">{block.error.code}</span>
              </details>
            ) : null}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <SheetClose asChild>
              <Button variant="secondary" disabled={block.isPending}>
                Cancel
              </Button>
            </SheetClose>
            <Button variant="danger" loading={block.isPending} onClick={submit}>
              {onChain && evm ? "Block, then sign on chain" : "Block account"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Lift (A-10, two-person) ─────────────────────────────────────────────────

function LiftSheet({
  block,
  label,
  approvers,
  onClose,
  onDone,
}: {
  block: AccountBlock | null;
  label: string;
  approvers: string[] | undefined;
  onClose: () => void;
  onDone: (node: React.ReactNode) => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState("");
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<{ reason?: string; note?: string }>({});

  const lift = useMutation({
    mutationFn: (input: { id: string; reasonCode: string; note: string }) =>
      unblockAccount(input.id, { reasonCode: input.reasonCode, note: input.note }),
    onSuccess: (answer) => {
      void queryClient.invalidateQueries({ queryKey: ["operator"] });
      onDone(
        answer.kind === "queued" ? (
          <ResultCard
            tone="queued"
            title={`Lifting the block on ${label} is waiting for approval`}
            next={`Nothing has changed yet. It needs ${approvalNeeds("A-10")}${approvers && approvers.length > 0 ? ` (${approvers.join(", ")})` : ""}; send them the link.`}
            link={{ label: "Open the request", href: approvalHref(answer.approval.approvalId) }}
            onDismiss={() => onDone(null)}
          />
        ) : (
          <ResultCard title={`The block on ${label} is lifted`} next="It applies within seconds." onDismiss={() => onDone(null)} />
        ),
      );
      setReason("");
      setNote("");
      onClose();
    },
  });

  const submit = () => {
    if (!block) return;
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
          <SheetDescription>Nothing changes until a second operator approves it. Then the account can use Assay again.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full flex-col gap-4 px-[18px] pt-4">
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
          <ApprovalFooter needs={approvalNeeds("A-10")} approvers={approvers} />
        </div>
        <SheetFooter className="sticky bottom-0 bg-01">
          <div role="alert" className={lift.error ? "text-body-xs text-danger-600" : "sr-only"}>
            {lift.error ? blockErrorMessage(lift.error, "unblock").replace(/\s*\([A-Z_]+\)$/, "") : ""}
          </div>
          <div className="flex w-full flex-col-reverse gap-2 tablet:flex-row tablet:justify-end">
            <SheetClose asChild>
              <Button variant="secondary" disabled={lift.isPending}>
                Keep it blocked
              </Button>
            </SheetClose>
            <Button loading={lift.isPending} onClick={submit}>
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
