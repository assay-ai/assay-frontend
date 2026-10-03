import type { CursorPage, ListQuery } from "@/interfaces";

import { api } from "./api";

export interface Agent {
  /** The wire calls it agentId, not id. */
  agentId: string;
  label?: string;
  agentAccount?: string;
  [key: string]: unknown;
}

/** GET /agents. */
export function listAgents(query: ListQuery = {}): Promise<CursorPage<Agent>> {
  return api.get<CursorPage<Agent>>("/agents", query as Record<string, unknown>);
}

/** POST /agents/{agentId}/credentials — creates a credential; the secret is shown once. */
export function createCredential(agentId: string, body?: unknown): Promise<unknown> {
  return api.post(`/agents/${agentId}/credentials`, body);
}

export function listCredentials(agentId: string, query: ListQuery = {}): Promise<CursorPage<unknown>> {
  return api.get<CursorPage<unknown>>(`/agents/${agentId}/credentials`, query as Record<string, unknown>);
}

export function revokeCredential(agentId: string, id: string): Promise<unknown> {
  return api.delete(`/agents/${agentId}/credentials/${id}`);
}

/** GET /audit-log. */
export function listAuditLog(query: ListQuery = {}): Promise<CursorPage<unknown>> {
  return api.get<CursorPage<unknown>>("/audit-log", query as Record<string, unknown>);
}

/** GET /notifications. An alert blocks nothing. */
export function listNotifications(query: ListQuery = {}): Promise<CursorPage<unknown>> {
  return api.get<CursorPage<unknown>>("/notifications", query as Record<string, unknown>);
}

export function getUnreadCount(): Promise<{ count: number }> {
  return api.get<{ count: number }>("/notifications/unread-count");
}

/** GET /spend-policy — the Limits screen. A limit REFUSES a call; it is not an alert. */
export function getSpendPolicy(): Promise<unknown> {
  return api.get("/spend-policy");
}
