import { toTwoPersonAnswer, type TwoPersonAnswer } from "@/features/operator/two-person";
import type { CursorPage } from "@/interfaces/api";
import type {
  ContractActionBody,
  CreateStandardToolBody,
  DeprecateVersionBody,
  MoveCurrentVersionBody,
  OperatorTool,
  OperatorToolList,
  SaveContractDraftBody,
} from "@/interfaces/contracts";
import type { ApprovalQueued } from "@/interfaces/operator";

import { operatorApi } from "./operator-api";

/**
 * The standard contract editor (assay-backend `operator-contracts.controller.ts`,
 * design spec §7.5): tools, their published versions, the one draft with its
 * diff, and the three actions that reach traffic. Publish (P-10) and "Make
 * current" (P-11) are two-person and answer 202; deprecate (P-12) is one
 * operator's act. Drafting is not an override: nothing serves a draft.
 */

const base = (toolId: string) => `/operator/tools/${encodeURIComponent(toolId)}`;

/** `GET /operator/tools` — every tool, drafts included. */
export function listOperatorTools(): Promise<OperatorToolList> {
  return operatorApi.get<OperatorToolList>("/operator/tools");
}

/** `GET /operator/tools/:id` — versions, the draft and its diff, bindings per major. */
export function getOperatorTool(toolId: string): Promise<OperatorTool> {
  return operatorApi.get<OperatorTool>(base(toolId));
}

/** `POST /operator/tools` — a DRAFT standard tool with no version yet. 409 TOOL_CONTRACT_NAME_TAKEN with a suggestion. */
export function createStandardTool(body: CreateStandardToolBody): Promise<OperatorTool> {
  return operatorApi.post<OperatorTool>("/operator/tools", body);
}

/** `POST /operator/tools/:id/versions` — save (create or replace) the draft. 400 TOOL_CONTRACT_INVALID with `problems`. */
export function saveContractDraft(toolId: string, body: SaveContractDraftBody): Promise<OperatorTool> {
  return operatorApi.post<OperatorTool>(`${base(toolId)}/versions`, body);
}

/** `DELETE /operator/tools/:id/versions/draft`. */
export function discardContractDraft(toolId: string): Promise<OperatorTool> {
  return operatorApi.delete<OperatorTool>(`${base(toolId)}/versions/draft`);
}

/** `POST …/versions/:v/publish` — P-10, two-person: a 202 waits for a Policy approver. */
export async function publishContractVersion(
  toolId: string,
  version: number,
  body: ContractActionBody,
): Promise<TwoPersonAnswer<OperatorTool>> {
  return toTwoPersonAnswer(
    await operatorApi.postWithStatus<OperatorTool | ApprovalQueued>(`${base(toolId)}/versions/${version}/publish`, body),
  );
}

/** `POST /operator/tools/:id/current-version` — P-11, two-person. */
export async function moveCurrentVersion(toolId: string, body: MoveCurrentVersionBody): Promise<TwoPersonAnswer<OperatorTool>> {
  return toTwoPersonAnswer(await operatorApi.postWithStatus<OperatorTool | ApprovalQueued>(`${base(toolId)}/current-version`, body));
}

/** `POST …/versions/:v/deprecate` — P-12: the whole major retires at `sunsetAt` (≥ 90 days, UTC). */
export function deprecateContractVersion(toolId: string, version: number, body: DeprecateVersionBody): Promise<OperatorTool> {
  return operatorApi.post<OperatorTool>(`${base(toolId)}/versions/${version}/deprecate`, body);
}

/* ------------------------------------------------------------ tool requests */

export type OperatorToolRequestStatus = "OPEN" | "ACKNOWLEDGED" | "ACCEPTED" | "DECLINED";

/** `GET /operator/tool-requests` — one unanswered request (`OperatorToolRequestQueueRowDto`). */
export interface OperatorToolRequestRow {
  id: string;
  organizationId: string;
  title: string;
  expectedMonthlyCalls: number | null;
  status: OperatorToolRequestStatus;
  ownerOperatorId: string | null;
  firstResponseDueAt: string;
  createdAt: string;
}

/** `GET /operator/tool-requests/:id` and the PATCH answer (`ToolRequestDto`). */
export interface OperatorToolRequest {
  id: string;
  title: string;
  description: string;
  upstreamUrl: string | null;
  expectedMonthlyCalls: number | null;
  status: OperatorToolRequestStatus;
  ownerOperatorId: string | null;
  firstResponseDueAt: string;
  firstRespondedAt: string | null;
  resolutionNote: string | null;
  closedAt: string | null;
  /** The DRAFT standard tool an accepted request created. */
  toolId: string | null;
  createdAt: string;
}

export interface AnswerToolRequestBody {
  status: "ACKNOWLEDGED" | "ACCEPTED" | "DECLINED";
  resolutionNote?: string;
  /** ACCEPTED only: snake_case; derived from the title when omitted. */
  toolName?: string;
  /** ACCEPTED only; `uncategorised` when omitted. */
  toolCategory?: string;
}

/** The requests still to decide (unanswered, or looked at and not yet accepted or declined), oldest due first. */
export function listOperatorToolRequests(
  statuses: readonly OperatorToolRequestStatus[] = ["OPEN", "ACKNOWLEDGED"],
): Promise<CursorPage<OperatorToolRequestRow>> {
  return operatorApi.get<CursorPage<OperatorToolRequestRow>>("/operator/tool-requests", { limit: 50, status: statuses.join(",") });
}

export function getOperatorToolRequest(id: string): Promise<OperatorToolRequest> {
  return operatorApi.get<OperatorToolRequest>(`/operator/tool-requests/${encodeURIComponent(id)}`);
}

/** `PATCH /operator/tool-requests/:id` — accepting creates the DRAFT tool (`toolId` on the answer). */
export function answerOperatorToolRequest(id: string, body: AnswerToolRequestBody): Promise<OperatorToolRequest> {
  return operatorApi.patch<OperatorToolRequest>(`/operator/tool-requests/${encodeURIComponent(id)}`, body);
}
