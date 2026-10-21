"use client";

import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { nextKeyName } from "@/features/buyer-money/agent-label";
import type { AgentReadiness } from "@/features/buyer-money/agent-readiness";
import { ApiError } from "@/libs/ApiClient";
import { plainApiError, plainError } from "@/libs/plain-language";
import { createCredential } from "@/services/account.service";

import { McpConfigTabs } from "./mcp-config-tabs";

/**
 * Create a key for an agent, then show it once with the config to paste.
 * Inline (Get started) or in a sheet (Agents). The key is created on a click,
 * never on mount: a page that mints a credential when opened leaks one per visit.
 */
export interface CreatedKey {
  id: string;
  agentId: string;
  name: string;
  prefix: string;
  token: string;
}

/**
 * What a new key can do: it has no payment key, so it makes free calls only.
 * `payingKey` names the agent's key that already pays, when it has one: the
 * agent keeps paying through that key, and moving it to the new one would
 * stop its paid calls (V1-6). "Run the payment-key step again" read to an
 * agent that already pays as if something were broken.
 */
/** The name of the agent's live key that pays now (bound, permission active), or null. */
export function payingKeyName(readiness: Pick<AgentReadiness, "boundCredential" | "grant"> | undefined): string | null {
  return readiness?.boundCredential && readiness.grant?.status === "ACTIVE" ? readiness.boundCredential.name : null;
}

export function newKeyPaysNote(payingKey?: string | null): string {
  return payingKey
    ? `This key makes free calls only. Your agent pays through its key “${payingKey}”. If you switch the agent to this key, it can make paid calls only once a payment key is bound to this key as well.`
    : "This key makes free calls only: no payment key is bound to it.";
}

/** Plain words for a failed create. */
export function createKeyErrorText(error: unknown): string {
  return error instanceof ApiError ? plainApiError(error) : "The key could not be created. Try again.";
}

/**
 * After a key is made or revoked: every read of the agents and their keys
 * (they all sit under `["agents"]`, the key names included). A read already on
 * its way (a Retry, a poll) is kept rather than sent twice.
 */
export function invalidateAfterKeyWrite(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["agents"] }, { cancelRefetch: false });
}

/**
 * Create a key on a click and hand it back, kept in memory only (never stored
 * or put in a URL): the one moment the full key exists on screen. Named "Key
 * N" by default, counting every key the agent has had.
 */
export function useCreateKey(agentId: string | null, keyCount: number, onCreated: (key: CreatedKey) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createCredential(agentId!, { name: nextKeyName(keyCount), scopes: ["tools:call"] }) as Promise<CreatedKey>,
    onSuccess: (key) => {
      onCreated(key);
      invalidateAfterKeyWrite(queryClient);
    },
  });
}

export function CreateKeyForm({
  agentId,
  defaultName = "Key 1",
  onCreated,
  onDone,
  doneLabel = "I have copied it",
  payingKey = null,
}: {
  agentId: string;
  defaultName?: string;
  /** The agent's key that already pays, if any (see {@link newKeyPaysNote}). */
  payingKey?: string | null;
  onCreated?: (key: CreatedKey) => void;
  onDone?: () => void;
  doneLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState(defaultName);
  const [created, setCreated] = React.useState<CreatedKey | null>(null);
  const create = useMutation({
    mutationFn: () => createCredential(agentId, { name: name.trim(), scopes: ["tools:call"] }) as Promise<CreatedKey>,
    onSuccess: (key) => {
      setCreated(key);
      onCreated?.(key);
      invalidateAfterKeyWrite(queryClient);
    },
  });

  if (created) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4" data-testid="key-created">
        <div className="flex w-full flex-col gap-1.5">
          <span className="text-label-13 text-01">Your key</span>
          <div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-02 bg-02 px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-mono-13 text-01">{created.token}</code>
            <CopyChip value={created.token} label="Copy" />
          </div>
          <p className="flex items-start gap-1.5 text-body-xs text-warning-700">
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            Shown once. We cannot show it again; if you lose it, create a new one and revoke this one.
          </p>
          <p className="text-body-xs text-03" data-testid="key-free-calls">{newKeyPaysNote(payingKey)}</p>
        </div>
        <div className="flex w-full min-w-0 flex-col gap-1.5">
          <span className="text-label-13 text-01">Connect your MCP client</span>
          <McpConfigTabs token={created.token} />
        </div>
        {onDone ? (
          <Button type="button" className="self-start" onClick={onDone}>
            {doneLabel}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <form
      className="flex w-full flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create.mutate();
      }}
    >
      <Field
        id={`key-name-${agentId}`}
        label="Key name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        hint="So you can tell your keys apart, e.g. the machine it runs on."
        error={create.isError ? createKeyErrorText(create.error) : undefined}
      />
      <Button type="submit" className="self-start" loading={create.isPending} disabled={!name.trim()}>
        Create key
      </Button>
    </form>
  );
}

export function CreateKeySheet({
  agentId,
  agentName,
  keyCount = 0,
  payingKey = null,
  open,
  onOpenChange,
}: {
  agentId: string | null;
  agentName?: string;
  /** The agent's key that already pays, if any. */
  payingKey?: string | null;
  /** Keys the agent has had (revoked included), for the default name "Key N". */
  keyCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="tablet:max-w-[620px]">
        <SheetHeader>
          <SheetTitle>New key{agentName ? ` for ${agentName}` : ""}</SheetTitle>
          <SheetDescription>Your agent uses it to call tools. You can revoke it at any time; that takes effect at once.</SheetDescription>
        </SheetHeader>
        <div className="flex w-full min-w-0 flex-col gap-4 px-[18px] pb-6 pt-4">
          {agentId ? <CreateKeyForm key={String(open)} agentId={agentId} defaultName={nextKeyName(keyCount)} payingKey={payingKey} onDone={() => onOpenChange(false)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
