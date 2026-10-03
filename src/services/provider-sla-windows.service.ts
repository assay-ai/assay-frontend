import type {
  BindingSla,
  CursorPage,
  ListSlaWindowsQuery,
  SlaWindow,
  SlaWindowEvidence,
  SlaWindowPosition,
} from "@/interfaces";

import { api } from "./api";

/**
 * `GET /providers/me/sla-windows` — one row per real `sla_windows` window
 *, each scoped to one **binding**, not to the whole
 * provider. Pass `bindingId` to scope the list to one binding; omit it to see
 * every window across every binding this provider owns. `status`/`outcome`
 * narrow further.
 */
export function listSlaWindows(
  query: ListSlaWindowsQuery = {}
): Promise<CursorPage<SlaWindow>> {
  return api.get<CursorPage<SlaWindow>>(
    "/providers/me/sla-windows",
    query as Record<string, unknown>
  );
}

/**
 * `GET /providers/me/sla-windows/{windowId}` — one window's full live
 * Position: sample-gate state, the server's Wilson 99% interval,
 * the projected close, the error budget and whether the window is already
 * confidently above the declared rate. Pass a `windowId` from the list
 * verbatim — it is a uuid and a value that does not decode answers
 * `PROVIDER_SLA_WINDOW_NOT_FOUND`.
 */
export function getSlaWindow(windowId: string): Promise<SlaWindowPosition> {
  return api.get<SlaWindowPosition>(
    `/providers/me/sla-windows/${encodeURIComponent(windowId)}`
  );
}

/**
 * `GET /providers/me/sla-windows/{windowId}/evidence` — the whole window plus
 * every call behind it, and the two failure breakdowns (`failuresByReasonCode`,
 * `failuresByAgentId`) the SLA window screen's "Recent failures" reads directly.
 *
 * Retrievable for any window, not only a slashed one: providers audit their
 * own quality continuously rather than only when accused. Pass a `windowId`
 * from the list verbatim — it is a uuid and a value that does not decode
 * answers `PROVIDER_SLA_WINDOW_NOT_FOUND`.
 */
export function getSlaWindowEvidence(windowId: string): Promise<SlaWindowEvidence> {
  return api.get<SlaWindowEvidence>(
    `/providers/me/sla-windows/${encodeURIComponent(windowId)}/evidence`
  );
}

/**
 * `GET /providers/me/bindings/{bindingId}/sla` — the SLA workbench:
 * The measured rate (aggregated over every CLOSED window for this binding)
 * with its own Wilson 99% interval, the in-flight window if one is open, the
 * effective threshold evaluated at the volume actually measured, and the
 * cross-organization peer distribution on this binding's tool.
 */
export function getBindingSla(bindingId: string): Promise<BindingSla> {
  return api.get<BindingSla>(`/providers/me/bindings/${encodeURIComponent(bindingId)}/sla`);
}
