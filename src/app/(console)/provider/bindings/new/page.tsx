"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { PageState } from "@/components/patterns/page-state";
import { Stepper } from "@/components/patterns/stepper";
import { useAccountReadOnly } from "@/features/account-block/use-account-block";
import { applyPublished, isAlreadyLive, isPublishedState } from "@/features/provider-binding/after-publish";
import { bindingQueryKey, useBinding } from "@/features/provider-binding/binding-header";
import { contractMismatchProblems, sameTerms, termsBody, termsOf } from "@/features/provider-binding/contract-terms";
import { documentsEqual } from "@/features/provider-binding/mapping-editor";
import { useProviderCatalogue } from "@/features/provider-binding/tool-name";
import { ConnectStage, type ConnectDraft } from "@/features/provider-binding/wizard/connect-stage";
import { LiveStage, REQUIREMENT_SENTENCE } from "@/features/provider-binding/wizard/live-stage";
import { isWizardStage, wizardSteps, type WizardStage } from "@/features/provider-binding/wizard/stages";
import { ToolStage } from "@/features/provider-binding/wizard/tool-stage";
import type {
  CatalogueTool,
  ToolBindingDetail,
  ToolBindingSummary,
  UpdateToolBindingBody,
} from "@/interfaces";
import { ApiError } from "@/libs/ApiClient";
import { plainError } from "@/libs/plain-language";
import { routes } from "@/libs/routes";
import { getProviderRegistration } from "@/services/provider-registration.service";
import {
  createToolBinding,
  getPublishCheck,
  listToolBindings,
  publishToolBinding,
  updateToolBinding,
} from "@/services/provider-tool-bindings.service";
import { chainIdOfAsset } from "@/utils/chain";
import { toast } from "@/utils/toast";

/**
 * List a tool — one wizard, one URL, three stages:
 *
 *   1 Tool             pick the catalogue tool your API answers
 *   2 Connect & test   endpoint (prefilled from setup), mapping, inline test
 *   3 Go live          price, free calls, promise, stake summary, Publish
 *
 * The stage and the draft ride in the query (`?binding=&stage=`, see
 * `routes.bindingWizard`), so a reload or a link from Home resumes exactly
 * here. The draft is created when stage 2 first runs a test and saved again
 * on every later test; stage 3 autosaves. Setup hands over `?endpoint=` and
 * the public calculator `?price=` (dollars).
 *
 * Replaces four pages (new → configuration → test → publish) and the separate
 * free-tier page; those URLs redirect here or to the listing's Settings.
 */

const DEFAULT_FAILURE_RATE = 0.02;
const DEFAULT_TIMEOUT_MS = 10_000;

function createErrorMessage(error: unknown, bound: ToolBindingSummary | undefined): Error {
  if (error instanceof ApiError) {
    if (error.code === "PROVIDER_BINDING_ALREADY_EXISTS") {
      return new Error(
        bound
          ? "You already list this tool. Open it from Tools to change it."
          : "You already list this tool. Find it under Tools.",
      );
    }
    if (error.code === "PROVIDER_BINDING_CHAIN_NOT_ENROLLED") {
      return new Error("This tool pays out on a chain where you have no payout wallet yet. Add one in setup, then try again.");
    }
    if (error.code === "PROVIDER_BINDING_TOOL_UNKNOWN") {
      return new Error("This tool was just removed from the catalogue. Pick another one.");
    }
  }
  return error instanceof Error ? error : new Error("That did not work. Try again.");
}

function WizardContent() {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const readOnly = useAccountReadOnly();

  const bindingId = params.get("binding") ?? "";
  const stageParam = params.get("stage");
  const endpointParam = params.get("endpoint") ?? "";
  const priceParam = params.get("price");
  const toolParam = params.get("tool");

  const catalogue = useProviderCatalogue();
  const existing = useQuery({
    queryKey: ["provider", "tool-bindings", "sidebar"],
    queryFn: () => listToolBindings({ limit: 50 }),
    retry: 0,
  });
  const registration = useQuery({
    queryKey: ["provider", "registration"],
    queryFn: getProviderRegistration,
    retry: 0,
  });
  const bindingQuery = useBinding(bindingId);
  const binding = bindingQuery.data ?? null;
  const check = useQuery({
    queryKey: ["provider", "tool-binding", bindingId, "publish-check"],
    queryFn: () => getPublishCheck(bindingId),
    enabled: Boolean(bindingId),
    retry: 0,
  });

  const [pickedToolId, setPickedToolId] = React.useState<string | null>(toolParam);
  const toolId = binding?.toolId ?? pickedToolId;
  const tools = catalogue.data?.tools ?? [];
  const tool: CatalogueTool | null = tools.find((candidate) => candidate.id === toolId) ?? null;
  const asset = catalogue.data?.settlementAsset ?? null;

  const boundByTool = React.useMemo(() => {
    const map = new Map<string, ToolBindingSummary>();
    for (const item of existing.data?.items ?? []) {
      if (item.id !== bindingId && !map.has(item.toolId)) map.set(item.toolId, item);
    }
    return map;
  }, [existing.data, bindingId]);

  const testPassed = (check.data?.requirements ?? []).some((r) => r.requirement === "TESTER_PASSED" && r.met);

  // Where to be.
  let stage: WizardStage;
  if (isWizardStage(stageParam)) stage = stageParam;
  else if (binding) stage = binding.status === "DRAFT" && !testPassed ? "connect" : "live";
  else stage = tool ? "connect" : "tool";
  if (stage === "live" && !binding) stage = tool ? "connect" : "tool";
  if (stage === "connect" && !tool && !bindingQuery.isPending) stage = "tool";

  const done = new Set<WizardStage>();
  if (tool) done.add("tool");
  if (binding && testPassed) done.add("connect");
  if (binding && isPublishedState(binding)) done.add("live");

  const go = (next: WizardStage, id: string | null = bindingId || null) => {
    const href = routes.bindingWizard(id ?? undefined, next);
    const extra = new URLSearchParams();
    if (!id && endpointParam) extra.set("endpoint", endpointParam);
    if (priceParam) extra.set("price", priceParam);
    if (!id && pickedToolId && next !== "tool") extra.set("tool", pickedToolId);
    const query = extra.toString();
    router.replace(query ? `${href}${href.includes("?") ? "&" : "?"}${query}` : href, { scroll: false });
    window.scrollTo({ top: 0 });
  };

  const store = (saved: ToolBindingDetail) => {
    queryClient.setQueryData(bindingQueryKey(saved.id), saved);
    void queryClient.invalidateQueries({ queryKey: ["provider", "tool-bindings"] });
  };

  const saveConnection = async (draft: ConnectDraft): Promise<ToolBindingDetail> => {
    if (!tool || !asset) throw new Error("The tool catalogue is still loading. Try again in a moment.");
    if (!binding) {
      const chain = chainIdOfAsset(asset.assetId);
      if (!chain) throw new Error("This tool's payment asset is not recognised. Contact support.");
      let created: ToolBindingDetail;
      try {
        created = await createToolBinding({
          toolId: tool.id,
          endpoint: draft.endpoint,
          requestMapping: draft.requestMapping,
          responseMapping: draft.responseMapping,
          pricingMode: "FREE",
          priceAmount: "0",
          assetId: asset.assetId,
          settlementChains: [chain],
          slaFailureRate: DEFAULT_FAILURE_RATE,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          ...(draft.terms ? termsBody(draft.terms) : {}),
        });
      } catch (error) {
        // The contract problems are shown as a list by the stage itself.
        if (contractMismatchProblems(error)) throw error;
        throw createErrorMessage(error, boundByTool.get(tool.id));
      }
      store(created);
      toast.success("Draft saved. Find it any time under Tools.");
      go("connect", created.id);
      return created;
    }
    const body: UpdateToolBindingBody = {};
    if (draft.endpoint !== binding.endpoint) body.endpoint = draft.endpoint;
    // Sent only when they moved: a mapping save starts a new version, which needs a new test.
    if (!documentsEqual(draft.requestMapping, binding.requestMapping)) body.requestMapping = draft.requestMapping;
    if (!documentsEqual(draft.responseMapping, binding.responseMapping)) body.responseMapping = draft.responseMapping;
    // T3: a changed range or field list is a new revision too, so it needs a new test.
    if (draft.terms && !sameTerms(draft.terms, termsOf(binding))) Object.assign(body, termsBody(draft.terms));
    if (Object.keys(body).length === 0) return binding;
    const saved = await updateToolBinding(binding.id, body);
    store(saved);
    toast.success("Changes saved");
    return saved;
  };

  const savePricing = async (body: UpdateToolBindingBody): Promise<ToolBindingDetail> => {
    if (!binding) throw new Error("Save the connection first.");
    const saved = await updateToolBinding(binding.id, body);
    store(saved);
    return saved;
  };

  const publish = async () => {
    if (!binding) return;
    const latest = await queryClient.fetchQuery({
      queryKey: ["provider", "tool-binding", binding.id, "publish-check"],
      queryFn: () => getPublishCheck(binding.id),
      staleTime: 0,
    });
    if (!latest.publishable) {
      const reasons = latest.requirements.filter((r) => !r.met).map((r) => REQUIREMENT_SENTENCE[r.requirement] ?? r.detail);
      throw new Error(`Not published yet. ${reasons.join(" ")}`);
    }
    try {
      const published = await publishToolBinding(binding.id);
      await applyPublished(queryClient, published, binding);
      toast.success(`${tool?.name ?? "Your tool"} is live`);
    } catch (error) {
      if (!isAlreadyLive(error)) throw error instanceof ApiError ? new Error(plainError(error.code)) : error;
      void queryClient.invalidateQueries({ queryKey: bindingQueryKey(binding.id) });
    }
    router.push(`${routes.binding(binding.id)}&welcome=1`);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  const header = (
    <header className="flex w-full flex-col gap-0.5">
      <h1 className="text-heading-sm text-01 tablet:text-heading-md">
        {tool ? `List ${tool.name}` : "List a tool"}
      </h1>
      <p className="text-body-13 text-03">Three steps. Your progress is saved as you go.</p>
    </header>
  );

  if (bindingId && bindingQuery.isError) {
    return (
      <>
        {header}
        <PageState
          kind="error"
          title="This draft could not be opened"
          description="It may have been removed, or it belongs to another account."
          onRetry={() => void bindingQuery.refetch()}
          code={bindingQuery.error instanceof ApiError ? bindingQuery.error.code : null}
        />
      </>
    );
  }
  if ((bindingId && bindingQuery.isPending) || (toolId && catalogue.isPending)) {
    return (
      <>
        {header}
        <PageState kind="loading" rows={5} label="Opening your listing" />
      </>
    );
  }
  if (binding && isPublishedState(binding) && !isWizardStage(stageParam)) {
    return (
      <>
        {header}
        <PageState
          kind="empty"
          title={`${tool?.name ?? "This tool"} is already live`}
          description="Change its price, free calls or promise in its Settings."
          action={{ label: "Open Settings", href: routes.binding(binding.id, "settings") }}
        />
      </>
    );
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <Stepper
        steps={wizardSteps(stage, done)}
        sticky
        label="Listing steps"
        onSelect={(id) => {
          if (isWizardStage(id) && id !== stage) go(id);
        }}
      />
      {header}

      {stage === "tool" ? (
        <ToolStage
          tools={tools}
          isLoading={catalogue.isPending}
          error={catalogue.isError}
          onRetry={() => void catalogue.refetch()}
          boundByTool={boundByTool}
          selectedId={toolId}
          onPick={(picked) => {
            if (binding && picked.id !== binding.toolId) return;
            setPickedToolId(picked.id);
            const href = routes.bindingWizard(bindingId || undefined, "connect");
            const extra = new URLSearchParams();
            if (!bindingId) extra.set("tool", picked.id);
            if (!bindingId && endpointParam) extra.set("endpoint", endpointParam);
            if (priceParam) extra.set("price", priceParam);
            const query = extra.toString();
            router.replace(query ? `${href}&${query}` : href, { scroll: false });
            window.scrollTo({ top: 0 });
          }}
        />
      ) : null}

      {stage === "connect" && tool ? (
        <ConnectStage
          key={`connect:${tool.id}`}
          tool={tool}
          binding={binding}
          initialEndpoint={endpointParam || registration.data?.registration.endpoint || ""}
          readOnly={readOnly}
          testPassedBefore={testPassed}
          onSave={saveConnection}
          onContinue={() => go("live")}
        />
      ) : null}

      {stage === "live" && tool && binding && asset ? (
        <LiveStage
          key={binding.id}
          tool={tool}
          binding={binding}
          asset={asset}
          terms={registration.data?.terms ?? null}
          priceHint={priceParam}
          readOnly={readOnly}
          onSave={savePricing}
          onPublish={publish}
          onBackToTest={() => go("connect")}
        />
      ) : null}
    </div>
  );
}

export default function NewToolBindingPage() {
  return <WizardContent />;
}
