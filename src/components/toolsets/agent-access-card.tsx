"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ban, CircleCheck, TriangleAlert, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { useSpendPolicyQuery } from "@/components/buyer-money/use-agents";
import { useCatalogue } from "@/components/g31/use-catalogue";
import { EntityPicker } from "@/components/patterns/entity-picker";
import { SkeletonRows } from "@/components/patterns/page-state";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import {
  accessSummary,
  addToolsetBody,
  excludeProviderBody,
  includeProviderBody,
  maxPriceBody,
  modeBody,
  priceText,
  removeToolBody,
  removeToolsetBody,
  toolResultLine,
  toolResultTone,
  verifiedOnlyBody,
  viaUrlOnlyBody,
} from "@/features/toolsets/access-result";
import { ACCESS_LABEL, PROVIDER_LIMITS_LABEL, VERIFIED_ONLY_LABEL } from "@/features/toolsets/labels";
import { restrictToConnected, type AgentAccess, type UpdateAgentAccessBody } from "@/services/toolsets.service";
import { cn } from "@/utils";
import { parseAmountInput, toDecimal } from "@/utils/money";
import { toast } from "@/utils/toast";

import { errorText, toolsetKeys, useAgentAccess, useToolsets, useUpdateAccess } from "./use-toolsets";

/**
 * Agent › What this agent can use (design spec §7.10), next to Spending
 * limits. One section, two or three clicks for any change, each saved as it
 * is made:
 *
 *   - Everything, or Only these tool sets and tools — and "Only what's
 *     connected" in one click;
 *   - Provider limits: excluded providers, max price, "Only verified
 *     providers" (minimum quality stays hidden until it is measured);
 *   - the combined result per tool: "get_weather: 2 of 4 providers left".
 *
 * Per-key narrowing exists in the API only and is not shown here.
 */
export function AgentAccessCard({ agentId, agentName, highlight = false }: { agentId: string; agentName: string; highlight?: boolean }) {
  const query = useAgentAccess(agentId);
  const ref = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (highlight && ref.current && query.data) ref.current.scrollIntoView({ block: "start" });
  }, [highlight, query.data]);

  return (
    <section
      ref={ref}
      id={highlight ? "access" : undefined}
      aria-label={ACCESS_LABEL}
      data-testid="agent-access"
      className={cn("flex min-w-0 flex-col gap-3", highlight && "scroll-mt-24 rounded-md outline outline-2 outline-offset-4 outline-primary-500")}
    >
      {query.isPending ? (
        <SkeletonRows rows={3} />
      ) : query.isError || !query.data ? (
        <p className="flex flex-wrap items-center gap-2 text-body-13 text-02">
          What {agentName} can use could not be loaded ({errorText(query.error)}). Its limits still apply.
          <button type="button" className="font-semibold text-primary-600 hover:underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : (
        <AccessEditor access={query.data} agentName={agentName} />
      )}
    </section>
  );
}

export function AccessEditor({ access, agentName }: { access: AgentAccess; agentName: string }) {
  const queryClient = useQueryClient();
  const update = useUpdateAccess(access.agentId);
  const toolsets = useToolsets();
  const catalogue = useCatalogue();
  const policy = useSpendPolicyQuery();
  const save = (body: UpdateAgentAccessBody, done?: string) => update.mutate(body, { onSuccess: () => done && toast.success(done) });

  const onlyConnected = useMutation({
    mutationFn: () => restrictToConnected(access.agentId),
    onSuccess: (next) => {
      queryClient.setQueryData(toolsetKeys.access(access.agentId), next);
      void queryClient.invalidateQueries({ queryKey: ["mcp-preview", access.agentId] });
      toast.success(
        next.everything
          ? `One of ${agentName}'s servers is Everything, so only what's connected means every tool.`
          : `${agentName} can now use only what its servers serve.`,
      );
    },
    onError: (error) => toast.error(errorText(error, "The change could not be saved")),
  });

  const restricted = access.accessMode === "RESTRICTED";
  const toolName = (id: string) => access.tools.find((t) => t.toolId === id)?.name ?? catalogue.tools.find((t) => t.toolId === id)?.name ?? "A tool no longer listed";
  const providerName = (id: string) => catalogue.providers.find((p) => p.providerId === id)?.name ?? "A provider no longer listed";
  const freeSets = (toolsets.data?.items ?? []).filter((set) => !access.allowedToolsets.some((t) => t.toolsetId === set.id));
  const decimals = access.rules.maxPrice?.decimals ?? policy.data?.decimals ?? 6;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-body-13 text-02" data-testid="access-summary">
        {accessSummary(access)}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          value={access.accessMode}
          onValueChange={(v) => v !== access.accessMode && save(modeBody(access, v as "ALL" | "RESTRICTED"))}
          aria-label={`What ${agentName} can use`}
        >
          <SegmentedItem value="ALL">Everything</SegmentedItem>
          <SegmentedItem value="RESTRICTED">Only these tool sets and tools</SegmentedItem>
        </Segmented>
        <Button size="sm" variant="secondary" loading={onlyConnected.isPending} onClick={() => onlyConnected.mutate()}>
          Only what&apos;s connected
        </Button>
      </div>

      {restricted ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-01 bg-02 p-3">
          <div className="flex flex-col gap-2">
            <span className="text-label-13 text-01">Tool sets</span>
            {access.allowedToolsets.length === 0 ? (
              <p className="text-body-xs text-03">None.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {access.allowedToolsets.map((set) => (
                  <li key={set.toolsetId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-01 px-2.5 py-2">
                    <span className="min-w-0 flex-1 text-label-13 text-01">
                      {set.deleted ? <span className="text-warning-700">Tool set deleted by its owner</span> : set.name ?? "A tool set"}
                    </span>
                    {!set.deleted ? (
                      <Switch
                        checked={set.viaUrlOnly}
                        onChange={(e) => save(viaUrlOnlyBody(access, set.toolsetId, e.target.checked))}
                        label="Only through its own URL"
                      />
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Stop allowing ${set.name ?? "this tool set"}`}
                      className="rounded-full p-1 text-03 hover:bg-02 hover:text-01"
                      onClick={() => save(removeToolsetBody(access, set.toolsetId, set.name ?? "a tool set"))}
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {freeSets.length > 0 ? (
              <select
                aria-label="Allow a tool set"
                className="w-full rounded-md border border-02 bg-01 px-3 py-2 text-body-sm text-01 tablet:w-[320px]"
                value=""
                onChange={(e) => {
                  const set = freeSets.find((s) => s.id === e.target.value);
                  if (set) save(addToolsetBody(access, set.id, set.name), `${set.name} allowed for ${agentName}`);
                }}
              >
                <option value="">Allow a tool set…</option>
                {freeSets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            ) : toolsets.data && toolsets.data.items.length === 0 ? (
              <p className="text-body-xs text-03">
                No tool sets yet.{" "}
                <Link href="/toolsets/mine" className="text-primary-600 hover:underline">
                  Create one
                </Link>
              </p>
            ) : null}
            {access.allowedToolsets.some((s) => s.viaUrlOnly) ? (
              <p className="text-body-xs text-03">
                &ldquo;Only through its own URL&rdquo; keeps the tool set&apos;s provider rules on every call: its tools work only through that tool set&apos;s server.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-label-13 text-01">Tools</span>
            {access.allowedToolIds.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {access.allowedToolIds.map((id) => (
                  <li key={id} className="inline-flex items-center gap-1 rounded-full bg-01 py-0.5 pl-2.5 pr-1 font-mono text-mono-12 text-01">
                    {toolName(id)}
                    <button
                      type="button"
                      aria-label={`Stop allowing ${toolName(id)}`}
                      className="rounded-full p-0.5 text-03 hover:bg-02 hover:text-01"
                      onClick={() => save(removeToolBody(access, id, toolName(id)))}
                    >
                      <X aria-hidden="true" className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-xs text-03">None.</p>
            )}
            <EntityPicker
              label="Allow a tool"
              value={null}
              placeholder="Search tools by name"
              options={access.tools
                .filter((t) => !access.allowedToolIds.includes(t.toolId))
                .map((t) => ({ id: t.toolId, label: t.name, detail: `${t.providersTotal} provider${t.providersTotal === 1 ? "" : "s"}` }))}
              onChange={(id) => id && save({ allowedToolIds: [...access.allowedToolIds, id], changeReason: `Allowed ${toolName(id)}` }, `${toolName(id)} allowed`)}
              className="tablet:w-[320px]"
            />
          </div>
        </div>
      ) : null}

      <ProviderLimits
        access={access}
        decimals={decimals}
        providerName={providerName}
        providers={catalogue.providers.map((p) => ({ id: p.providerId, label: p.name, detail: p.tier === "NEW" ? "Not verified yet" : "Verified" }))}
        onSave={save}
        pending={update.isPending}
      />

      <details className="rounded-lg border border-01 px-3 py-2.5" open>
        <summary className="cursor-pointer select-none text-label-13 text-01">Result per tool</summary>
        <ul className="mt-2 flex flex-col gap-1" data-testid="access-results">
          {access.tools.length === 0 ? <li className="text-body-xs text-03">No tools listed yet.</li> : null}
          {access.tools.map((tool) => {
            const tone = toolResultTone(tool);
            return (
              <li key={tool.toolId} className={cn("flex items-start gap-2 text-body-13", tone === "blocked" ? "text-03" : tone === "warn" ? "text-warning-700" : "text-02")}>
                {tone === "blocked" ? (
                  <Ban aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                ) : tone === "warn" ? (
                  <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <CircleCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success-500" />
                )}
                <span className="min-w-0 break-words">{toolResultLine(tool, access.rules)}</span>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}

function ProviderLimits({
  access,
  decimals,
  providers,
  providerName,
  onSave,
  pending,
}: {
  access: AgentAccess;
  decimals: number;
  providers: { id: string; label: string; detail: string }[];
  providerName: (id: string) => string;
  onSave: (body: UpdateAgentAccessBody, done?: string) => void;
  pending: boolean;
}) {
  const { rules } = access;
  const current = rules.maxPrice ? toDecimal(rules.maxPrice).toString() : "";
  const [max, setMax] = React.useState(current);
  React.useEffect(() => setMax(current), [current]);
  const parsed = parseAmountInput(max, { decimals, required: false });
  const changed = max.trim() !== current;

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-01 p-3" data-testid="provider-limits">
      <div className="flex flex-col gap-0.5">
        <span className="text-label-13 text-01">{PROVIDER_LIMITS_LABEL}</span>
        <span className="text-body-xs text-03">Apply to every call this agent makes, through any server.</span>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-label-xs text-02">Never use these providers</span>
        {rules.excludeProviderIds.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {rules.excludeProviderIds.map((id) => (
              <li key={id} className="inline-flex items-center gap-1 rounded-full bg-03 py-0.5 pl-2.5 pr-1 text-label-xs text-01">
                {providerName(id)}
                <button
                  type="button"
                  aria-label={`Remove ${providerName(id)} from limits`}
                  className="rounded-full p-0.5 text-03 hover:bg-02 hover:text-01"
                  onClick={() => onSave(includeProviderBody(rules, id, providerName(id)))}
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <EntityPicker
          label="Exclude a provider"
          value={null}
          placeholder="Search providers"
          options={providers.filter((p) => !rules.excludeProviderIds.includes(p.id))}
          onChange={(id) => id && onSave(excludeProviderBody(rules, id, providerName(id)), `${providerName(id)} excluded`)}
          className="tablet:w-[320px]"
        />
      </div>

      <form
        className="flex flex-col gap-2 tablet:flex-row tablet:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!parsed.error && changed) onSave(maxPriceBody(parsed.atomic), parsed.atomic ? "Max price saved" : "Max price removed");
        }}
      >
        <Field
          id={`max-price-${access.agentId}`}
          label="Max price per call"
          inputMode="decimal"
          suffix="USD"
          placeholder="No limit"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          error={parsed.error ?? undefined}
          hint={rules.maxPrice ? `Now: ${priceText(rules.maxPrice)} a call` : "Providers that charge more are not used."}
          wrapperClassName="tablet:w-[240px]"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!changed || Boolean(parsed.error)} loading={pending && changed}>
          {max.trim() === "" && rules.maxPrice ? "Remove" : "Save"}
        </Button>
      </form>

      <Switch
        checked={rules.minTier !== null}
        onChange={(e) => onSave(verifiedOnlyBody(e.target.checked))}
        label={rules.minTier === "TRUSTED" ? "Only trusted providers (set through the API)" : VERIFIED_ONLY_LABEL}
      />
    </div>
  );
}
