import type {
  BindingTestReport,
  CredentialHeaderInput,
  CredentialSetSummary,
  CursorPage,
  ListToolBindingsQuery,
  PausedToolBinding,
  PauseToolBindingBody,
  PublishCheck,
  PublishedToolBinding,
  RunBindingTestBody,
  SavedToolBinding,
  SaveToolBindingBody,
  ToolBindingDetail,
  ToolBindingSummary,
  ToolCatalogue,
  UpdateToolBindingBody,
  ValidateMappingBody,
  ValidateMappingResponse,
} from "@/interfaces";

import { api } from "./api";

/**
 * The provider's own tool bindings: write, validate, test, publish, pause.
 *
 * The flow the routes encode, in order — a screen that lets a provider skip a
 * step is a screen that will meet `PROVIDER_PUBLISH_CHECKS_FAILED`:
 *
 *   create/update (always DRAFT)  →  test at the current revision
 *     →  publish-check  →  publish
 *
 * Editing the mappings, endpoint, price or timeout **raises the revision**,
 * which invalidates any green tester run against the old one. `version` is the
 * current revision, `publishedVersion` is what is live, and
 * `hasUnpublishedChanges` is the difference — the publish gate keys on
 * exactly that.
 */

/** `GET /providers/me/tool-bindings`. Sortable field: `createdAt` only. */
export function listToolBindings(
  query: ListToolBindingsQuery = {}
): Promise<CursorPage<ToolBindingSummary>> {
  return api.get<CursorPage<ToolBindingSummary>>(
    "/providers/me/tool-bindings",
    query as Record<string, unknown>
  );
}

/** `GET /providers/me/tool-bindings/{id}` — one binding with its two mappings. */
export function getToolBinding(id: string): Promise<ToolBindingDetail> {
  return api.get<ToolBindingDetail>(`/providers/me/tool-bindings/${id}`);
}

/**
 * `GET /providers/me/tool-bindings/catalogue` — the platform-defined tools a
 * provider can implement, and the asset every binding settles in. What the
 * create screen's tool picker and `assetId` field are built from.
 */
export function listToolCatalogue(): Promise<ToolCatalogue> {
  return api.get<ToolCatalogue>("/providers/me/tool-bindings/catalogue");
}

/**
 * `POST /providers/me/tool-bindings` — always DRAFT. Publishing is a separate
 * step and cannot be folded in here.
 *
 * `404 PROVIDER_BINDING_TOOL_UNKNOWN`, `409 PROVIDER_BINDING_ALREADY_EXISTS`
 * (one binding per tool per provider).
 */
export function createToolBinding(body: SaveToolBindingBody): Promise<SavedToolBinding> {
  return api.post<SavedToolBinding>("/providers/me/tool-bindings", body);
}

/**
 * `PATCH /providers/me/tool-bindings/{id}`.
 *
 * `toolId` has no field: re-pointing a binding at another tool would silently
 * re-target every verdict, receipt and dispute that already names it. Send
 * only the changed keys — `null` clears a nullable ceiling and omitting the
 * key leaves it alone, so do not normalise one into the other.
 *
 * `409 PROVIDER_BINDING_NOT_EDITABLE` when the binding is SUSPENDED.
 */
export function updateToolBinding(
  id: string,
  body: UpdateToolBindingBody
): Promise<SavedToolBinding> {
  return api.patch<SavedToolBinding>(`/providers/me/tool-bindings/${id}`, body);
}

/**
 * `POST /providers/me/tool-bindings/validate-mapping` — check a mapping
 * without saving it. This is what the editor calls on a debounce while the
 * provider types.
 *
 * There is no `{ valid: false }` branch: an invalid mapping raises
 * `TOOL_MAPPING_INVALID` with a pointer at the offending node, through the
 * ordinary error path. Catch it and render the pointer.
 *
 * Note the route is a literal segment on the same collection as `:id`, so it
 * must never be reached through the id-shaped helpers above.
 */
export function validateToolMapping(
  body: ValidateMappingBody
): Promise<ValidateMappingResponse> {
  return api.post<ValidateMappingResponse>(
    "/providers/me/tool-bindings/validate-mapping",
    body
  );
}

/**
 * `POST /providers/me/tool-bindings/{id}/test` — call the provider's endpoint
 * for real, in a sandbox, and report what every production layer made of the
 * answer. Charges nobody.
 *
 * It writes no payment intent, so a test call is invisible to the per-call
 * export. The report's `mappingVersion` is what the publish gate later checks,
 * so a run is only useful while it matches the binding's current `version`.
 */
export function testToolBinding(
  id: string,
  body: RunBindingTestBody
): Promise<BindingTestReport> {
  return api.post<BindingTestReport>(`/providers/me/tool-bindings/${id}/test`, body);
}

/**
 * `GET /providers/me/tool-bindings/{id}/publish-check` — which conditions are
 * met and what is missing.
 *
 * A first-class response, not an error body: a provider reads it *before*
 * pressing publish. Publishing anyway raises `PROVIDER_PUBLISH_CHECKS_FAILED`
 * carrying this same list.
 */
export function getPublishCheck(id: string): Promise<PublishCheck> {
  return api.get<PublishCheck>(`/providers/me/tool-bindings/${id}/publish-check`);
}

/** `POST /providers/me/tool-bindings/{id}/publish` — put the current revision live. */
export function publishToolBinding(id: string): Promise<PublishedToolBinding> {
  return api.post<PublishedToolBinding>(`/providers/me/tool-bindings/${id}/publish`);
}

/**
 * `POST /providers/me/tool-bindings/{id}/pause` — stop taking traffic from the
 * next call.
 *
 * No penalty, no effect on earnings already accrued, no mark in the quality
 * profile. The body's `reason` is a free-text **note** for support and the
 * provider's own trail; the stored `pauseReason` is always
 * `PROVIDER_REQUESTED` on this route, because a column a provider can set is a
 * column that cannot be evidence.
 *
 * `409 PROVIDER_BINDING_NOT_PAUSABLE` — it is not serving.
 */
export function pauseToolBinding(
  id: string,
  body: PauseToolBindingBody = {}
): Promise<PausedToolBinding> {
  return api.post<PausedToolBinding>(`/providers/me/tool-bindings/${id}/pause`, body);
}

/**
 * `POST /providers/me/tool-bindings/{id}/resume` — take traffic again, at the
 * revision that was already live. Not a republish.
 *
 * `409 PROVIDER_BINDING_NOT_PAUSED` (nothing to resume) or
 * `PROVIDER_BINDING_NEVER_PUBLISHED` (publish it instead) — two different
 * next actions, so branch on `code`.
 */
export function resumeToolBinding(id: string): Promise<PausedToolBinding> {
  return api.post<PausedToolBinding>(`/providers/me/tool-bindings/${id}/resume`);
}

/** `GET /providers/me/tool-bindings/{id}/credentials` — which headers are stored per origin. Values are never returned. */
export function listBindingCredentials(id: string): Promise<CredentialSetSummary[]> {
  return api.get<CredentialSetSummary[]>(`/providers/me/tool-bindings/${id}/credentials`);
}

/** `PUT .../credentials` — replaces every stored header for `origin`. */
export function putBindingCredentials(
  id: string,
  origin: string,
  headers: CredentialHeaderInput[]
): Promise<CredentialSetSummary> {
  return api.put<CredentialSetSummary>(`/providers/me/tool-bindings/${id}/credentials`, {
    origin,
    headers,
  });
}

/** `DELETE .../credentials?origin=` — forget the stored headers for one origin. */
export function deleteBindingCredentials(id: string, origin: string): Promise<void> {
  return api.delete<void>(
    `/providers/me/tool-bindings/${id}/credentials?origin=${encodeURIComponent(origin)}`
  );
}
