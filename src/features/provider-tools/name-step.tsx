"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";

import { toolsetKeys, useOrgHandle } from "@/components/toolsets/use-toolsets";
import { isTestnet, testnetDepositLine } from "@/features/buyer-money/gas-help";
import { DEPOSIT_MINIMUM_USD } from "@/features/explorer/buyer-costs";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { STARTER_INPUT, STARTER_OUTPUT } from "@/features/operator/contract-editor";
import { useProviderEntry } from "@/features/provider-entry/use-provider-entry";
import { handleErrorView, handleProblem, normaliseHandle, type HandleErrorView } from "@/features/toolsets/sharing";
import { useChains } from "@/hooks/useChains";
import { ApiError } from "@/libs/ApiClient";
import { isEvmChain } from "@/libs/chains/registry";
import { routes } from "@/libs/routes";
import { listPublicCategories } from "@/services/public-toolsets.service";
import { createProviderTool, listProviderTools, updateProviderTool, type ProviderTool } from "@/services/provider-tools.service";
import { claimOrgHandle } from "@/services/toolsets.service";
import { toast } from "@/utils/toast";

import { TryPanel, type TryOutcome } from "./fields-editor";
import { optionalFromSchema } from "./schema-fields";

import {
  createBody,
  FULL_NAME_MAX,
  fullToolName,
  localNameProblem,
  MODEL_NAME_MAX,
  modelSeenName,
  nameLengthWarning,
  parseTags,
  providerToolErrorView,
  type ProviderToolErrorView,
} from "./model";
import { providerToolKeys } from "./queries";

/**
 * Step 1, "Name": the public name (claimed inline the first time), the tool
 * name under it, previewed exactly as a model sees it, its topic and the one
 * line agents read. Creating it saves a private draft with a starter schema
 * that step 2 replaces. Stake and payout are shown up front as a checklist.
 */

const CATEGORY_RE = /^[a-z][a-z0-9-]{1,63}$/;
const SUMMARY_MAX = 200;

/**
 * Step 1 starts here when the team has no public name yet. Whether this
 * account claims it free is said before any click (onboarding wave 3): a
 * provider whose setup is finished gets its first name free; anyone else adds
 * funds once. `freeClaim` is that guess from the provider setup (`null` while
 * unknown); the server decides, and a refusal for funding says how to add
 * them, with the testnet minimum, the token, gas and the faucet.
 */
export function HandleClaim({ freeClaim = null }: { freeClaim?: boolean | null }) {
  const queryClient = useQueryClient();
  const chains = useChains();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<HandleErrorView | null>(null);
  const claim = useMutation({
    mutationFn: async (raw: string) => {
      const problem = handleProblem(raw);
      if (problem) throw new Error(problem);
      return claimOrgHandle(normaliseHandle(raw));
    },
    onSuccess: (claimed) => {
      setError(null);
      queryClient.setQueryData(toolsetKeys.handle, claimed);
      toast.success(`@${claimed.handle} is yours`);
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(handleErrorView(err.code, err.context, name));
      else setError({ text: err instanceof Error ? err.message : "That name could not be claimed.", suggestions: [], action: null });
    },
  });
  // Checked as it is typed, by the server's own rule (`handleProblem`), so Claim never sends a name that cannot be had.
  const typedProblem = name.trim() === "" ? null : handleProblem(name);
  const funding = error?.action ? error : null;
  const depositChain = chains.chains.find((c) => isEvmChain(c.chainId) && isTestnet(c)) ?? null;
  const testnetLine = funding ? testnetDepositLine(depositChain, funding.minimumDepositUsd ?? DEPOSIT_MINIMUM_USD) : null;
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-warning-10 p-3.5" data-testid="handle-claim">
      <p className="text-label-13 text-01">First, choose your public name</p>
      <p className="text-body-13 text-02">Your tools are named after it, like @acme → acme__search_posts. It never shows an email, a wallet or a real name.</p>
      <p className="text-body-13 text-02">
        It is asked for now because a tool&apos;s name includes it from the first save. The draft itself stays private until you
        choose who can use it.
      </p>
      {freeClaim === true ? (
        <p className="flex items-center gap-1.5 text-body-13 text-success-700" data-testid="handle-claim-free">
          <Check aria-hidden="true" className="size-3.5 shrink-0" />
          Your provider setup is finished, so your first public name is free: no funds needed.
        </p>
      ) : freeClaim === false ? (
        <p className="text-body-13 text-02" data-testid="handle-claim-cost">
          It needs funds added once (at least ${DEPOSIT_MINIMUM_USD}), or a finished{" "}
          <Link href="/provider/setup" className="text-primary-600 hover:underline">
            provider setup
          </Link>
          : then your first public name is free.
        </p>
      ) : null}
      <div className="flex flex-col gap-2 tablet:flex-row tablet:items-start">
        <Field
          label="Public name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          suffix={name ? `@${normaliseHandle(name)}` : undefined}
          hint="3–24 lowercase letters, digits or “-” (not “_”), starting with a letter. Tool names use “_” instead: “__” joins the two."
          error={(funding ? undefined : error?.text) ?? typedProblem ?? undefined}
          wrapperClassName="tablet:max-w-[360px]"
          autoComplete="off"
          spellCheck={false}
        />
        <Button className="tablet:mt-6" loading={claim.isPending} disabled={name.trim() === "" || typedProblem !== null} onClick={() => claim.mutate(name)}>
          Claim
        </Button>
      </div>
      {funding?.action ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-warning-20 bg-01 p-3" data-testid="handle-claim-funding">
          <p className="text-body-13 text-warning-700">{funding.text}</p>
          {testnetLine ? <p className="text-body-xs text-03">{testnetLine}</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <a href={funding.action.href} target="_blank" rel="noopener noreferrer">
                {funding.action.label} (new tab)
              </a>
            </Button>
            <Button size="sm" variant="secondary" loading={claim.isPending} onClick={() => claim.mutate(name)}>
              I&apos;ve done it: try again
            </Button>
          </div>
          <p className="text-body-xs text-03">Everything you typed here stays as it is.</p>
        </div>
      ) : null}
      {error?.suggestions.length ? (
        <div className="flex flex-wrap gap-2">
          {error.suggestions.map((s) => (
            <Button key={s} variant="secondary" size="sm" className="touch-target" onClick={() => {
              setName(s);
              claim.mutate(s);
            }}>
              @{s}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NamePreview({ handle, localName }: { handle: string; localName: string }) {
  const full = fullToolName(handle, localName || "your_tool");
  const seen = modelSeenName(handle, localName || "your_tool");
  const warning = localName ? nameLengthWarning(handle, localName) : null;
  const tooLongForApps = seen.length > MODEL_NAME_MAX;
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-02 px-3 py-2.5" data-testid="name-preview">
      <p className="text-body-xs text-03">
        Agents call it ({full.length} of {FULL_NAME_MAX} characters)
      </p>
      <p className="break-all font-mono text-mono-13 text-01">{full}</p>
      {warning ? <p className="text-body-xs text-warning-700">{warning}</p> : null}
      {tooLongForApps ? (
        <p className="text-body-xs text-warning-700">Some agent apps cut names longer than {MODEL_NAME_MAX} characters once they add their own prefix. A shorter tool name keeps the whole name visible.</p>
      ) : null}
      <details className="text-body-xs text-03">
        <summary className="inline-flex min-h-10 cursor-pointer items-center">How an agent app shows it</summary>
        <p>Apps such as Claude put the server&apos;s name in front, like this; it still fits:</p>
        <p className="break-all font-mono text-mono-12 text-02">{seen}</p>
      </details>
    </div>
  );
}

/** What others need before they can use it; shown before any work starts, as information (step 3 checks it). */
function UpFrontChecklist() {
  const items = [
    { text: "a passing test of your endpoint", href: null },
    { text: "stake at the minimum on every chain you are paid on", href: routes.stake() },
    { text: "a payout wallet", href: "/provider/setup?step=wallet" },
  ];
  return (
    <section className="flex flex-col gap-1.5 rounded-lg border border-01 px-3.5 py-3">
      <p className="text-label-13 text-01">Before anyone outside your team can use it, it needs (step 3 checks these for you):</p>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.text} className="flex items-center gap-2 text-body-13 text-02">
            <span aria-hidden="true" className="text-03">·</span>
            {item.href ? (
              <Link href={item.href} className="inline-flex min-h-10 items-center text-primary-600 hover:underline">
                {item.text}
              </Link>
            ) : (
              item.text
            )}
          </li>
        ))}
      </ul>
      <p className="text-body-xs text-03">Keeping it to your own team needs none of these. Nothing to do here now.</p>
    </section>
  );
}

function ErrorBox({ view, onSuggestion }: { view: ProviderToolErrorView; onSuggestion?: (name: string) => void }) {
  return (
    <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-danger-20 bg-danger-10 px-3.5 py-2.5 text-body-13 text-danger-700">
      <p>{view.text}</p>
      {view.problems.length > 0 ? (
        <ul className="list-disc pl-4">
          {view.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {view.suggestion && onSuggestion ? (
        <Button variant="secondary" size="sm" className="touch-target self-start" onClick={() => onSuggestion(view.suggestion!)}>
          Use {view.suggestion}
        </Button>
      ) : null}
    </div>
  );
}

export function NameStep({ tool, onContinue }: { tool: ProviderTool | null; onContinue: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const handle = useOrgHandle();
  // A finished provider setup claims its first public name free (the server decides; this says it up front).
  const providerEntry = useProviderEntry({ enabled: !tool });
  const categories = useQuery({ queryKey: ["public-categories"], queryFn: listPublicCategories, retry: 0, staleTime: 5 * 60_000 });
  const [localName, setLocalName] = React.useState("");
  const [category, setCategory] = React.useState(tool?.category ?? "");
  const [tags, setTags] = React.useState((tool?.tags ?? []).join(", "));
  const [summary, setSummary] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  // What a try run of the endpoint worked out: the new tool starts from it instead of a placeholder schema.
  const [tried, setTried] = React.useState<TryOutcome | null>(null);
  const listId = React.useId();

  // A provider that already publishes tools holds its public name: never ask it to claim it again.
  const ownTools = useQuery({ queryKey: [...providerToolKeys.all, "handle"], queryFn: () => listProviderTools({ limit: 1 }), retry: 0, enabled: !tool });
  const existing = ownTools.data?.items[0]?.handle ?? null;
  const owner = tool?.handle ?? handle.data?.handle ?? existing;
  const nameProblem = localNameProblem(owner, localName);
  const categoryProblem = category.trim() === "" ? "Pick a topic." : CATEGORY_RE.test(category.trim()) ? null : "Lowercase letters, digits and “-”, starting with a letter.";
  const summaryProblem = summary.trim() === "" ? "Say in one line what it does." : summary.length > SUMMARY_MAX ? `At most ${SUMMARY_MAX} characters.` : /[\r\n]/.test(summary) ? "Keep it on one line." : null;

  const create = useMutation({
    mutationFn: () =>
      createProviderTool(
        createBody(localName, category, {
          summary: summary.trim(),
          description: summary.trim(),
          inputSchema: tried?.inputSchema ?? (STARTER_INPUT as Record<string, unknown>),
          outputSchema: tried?.outputSchema ?? (STARTER_OUTPUT as Record<string, unknown>),
          examples: tried?.examples.slice(0, 10) ?? [],
          ...(tried ? { optionalInputFields: optionalFromSchema(tried.inputSchema), optionalOutputFields: tried.outputSchema ? optionalFromSchema(tried.outputSchema) : [] } : {}),
        }),
      ),
    onSuccess: (created) => {
      queryClient.setQueryData(providerToolKeys.one(created.id), created);
      void queryClient.invalidateQueries({ queryKey: providerToolKeys.list });
      toast.success(`${created.name} saved. Only your team can see it.`);
      router.replace(routes.providerApi(created.id, "contract"), { scroll: false });
    },
  });
  const save = useMutation({
    mutationFn: () =>
      updateProviderTool(tool!.id, {
        category: category.trim(),
        tags: parseTags(tags).tags,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(providerToolKeys.one(updated.id), updated);
      toast.success("Saved");
    },
  });

  const datalist = (
    <datalist id={listId}>
      {(categories.data?.categories ?? []).map((c) => (
        <option key={c.category} value={c.category} />
      ))}
    </datalist>
  );

  if (tool) {
    const tagsChanged = tags !== tool.tags.join(", ") || category !== tool.category;
    const tagProblem = parseTags(tags).problem;
    return (
      <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4">
        <h2 className="text-label-md text-01">Name</h2>
        <NamePreview handle={tool.handle} localName={tool.localName} />
        <p className="text-body-13 text-03">A tool&apos;s name can&apos;t change. To use another name, publish a new tool.</p>
        <div className="grid grid-cols-1 gap-3 tablet:grid-cols-2">
          <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} list={listId} error={categoryProblem ?? undefined} hint="Search and the catalogue group tools by it." />
          <Field label="Tags (optional)" value={tags} onChange={(e) => setTags(e.target.value)} hint="Up to 10, separated by commas." error={tagProblem ?? undefined} className="font-sans" />
        </div>
        {datalist}
        {tool.visibility === "LISTED" ? <p className="text-body-xs text-03">On a listed tool, a new topic or tags wait for the next review: change them with a new version in step 2.</p> : null}
        {save.isError ? <ErrorBox view={providerToolErrorView(save.error)} /> : null}
        <div className="flex flex-wrap gap-2">
          {tool.visibility !== "LISTED" ? (
            <Button variant="secondary" disabled={!tagsChanged || categoryProblem !== null || tagProblem !== null} loading={save.isPending} onClick={() => save.mutate()}>
              Save topic and tags
            </Button>
          ) : null}
          <Button onClick={onContinue}>Continue to inputs & outputs</Button>
        </div>
      </section>
    );
  }

  const noHandle = handle.isSuccess && !handle.data?.handle && !existing && !ownTools.isPending;
  const ready = !noHandle && owner !== null && !nameProblem && !categoryProblem && !summaryProblem;
  return (
    <section className="flex w-full flex-col gap-4 rounded-xl border border-01 bg-01 px-4 py-4">
      <h2 className="text-label-md text-01">Name it</h2>
      {/* The public name comes first, above everything else in step 1 (onboarding wave 3). */}
      {noHandle ? <HandleClaim freeClaim={providerEntry ? providerEntry.provider && providerEntry.href === "/provider" : null} /> : null}
      <UpFrontChecklist />
      {owner ? (
        <p className="flex items-center gap-1.5 text-body-13 text-02">
          <Check aria-hidden="true" className="size-3.5 text-success-700" />
          Published as <span className="font-mono text-mono-13 text-01">@{owner}</span>, your public name
        </p>
      ) : null}
      <Field
        label="Tool name"
        value={localName}
        onChange={(e) => setLocalName(e.target.value)}
        onBlur={() => setTouched(true)}
        hint="Lowercase letters, digits and “_” (not “-”, unlike your public name), 2–40 characters, like search_posts. It can't change later."
        // Its rules show as it is typed, before a public name is claimed too (onboarding wave item 4).
        error={localName ? (nameProblem ?? undefined) : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {owner ? <NamePreview handle={owner} localName={localName.trim()} /> : null}
      <Field label="Topic" value={category} onChange={(e) => setCategory(e.target.value)} list={listId} placeholder="social" error={touched && category ? (categoryProblem ?? undefined) : undefined} hint="Search and the catalogue group tools by it." />
      {datalist}
      <Field
        label="What it does, in one line"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        suffix={`${summary.length}/${SUMMARY_MAX}`}
        hint="The only text agents see in their tool list. Say what it does and when to use it."
        error={touched && summary ? (summaryProblem ?? undefined) : undefined}
        className="font-sans"
      />
      {tried ? (
        <p className="flex items-center gap-1.5 text-body-13 text-success-700">
          <Check aria-hidden="true" className="size-3.5" />
          Inputs, outputs and an example come from your endpoint&apos;s answer; you can change them in step 2.
        </p>
      ) : (
        <TryPanel compact onUse={(outcome) => setTried(outcome)} />
      )}
      {create.isError ? <ErrorBox view={providerToolErrorView(create.error)} onSuggestion={(s) => setLocalName(s.includes("__") ? s.split("__").pop()! : s)} /> : null}
      <div className="flex flex-col gap-1">
        <Button
          className="self-start"
          loading={create.isPending}
          disabled={!ready}
          onClick={() => {
            setTouched(true);
            if (ready) create.mutate();
          }}
        >
          Save and continue
        </Button>
        {!ready ? (
          <p className="text-body-xs text-03">
            {noHandle
              ? `Claim a public name first.${localName && nameProblem ? ` Tool name: ${nameProblem}` : ""}`
              : (nameProblem ?? categoryProblem ?? summaryProblem ?? "")}
          </p>
        ) : (
          <p className="text-body-xs text-03">Saved as a private draft: only your team can see it.</p>
        )}
      </div>
    </section>
  );
}
