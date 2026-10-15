"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import * as React from "react";

import { CopyChip } from "@/components/patterns/copy-chip";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
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

export function CreateKeyForm({
  agentId,
  defaultName = "My agent",
  onCreated,
  onDone,
  doneLabel = "I have copied it",
}: {
  agentId: string;
  defaultName?: string;
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
      void queryClient.invalidateQueries({ queryKey: ["agent-keys"] });
      void queryClient.invalidateQueries({ queryKey: ["credentials"] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });

  if (created) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-4" data-testid="key-created">
        <div className="flex w-full flex-col gap-1.5">
          <span className="text-label-13 text-01">Your key</span>
          <div className="flex w-full min-w-0 items-center gap-2 rounded-md border border-02 bg-02 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-mono-13 text-01">{created.token}</code>
            <CopyChip value={created.token} label="Copy" />
          </div>
          <p className="flex items-start gap-1.5 text-body-xs text-warning-700">
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            Shown once. We cannot show it again; if you lose it, create a new one and revoke this one.
          </p>
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
        error={create.isError ? (create.error instanceof ApiError ? plainError(create.error.code) : "The key could not be created. Try again.") : undefined}
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
  open,
  onOpenChange,
}: {
  agentId: string | null;
  agentName?: string;
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
          {agentId ? <CreateKeyForm key={String(open)} agentId={agentId} onDone={() => onOpenChange(false)} /> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
