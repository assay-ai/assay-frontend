/**
 * An agent's label, checked the way `PATCH /agents/:id` checks it, so the
 * rename field says what is wrong before the request: trimmed, 1–64
 * characters, no control, format or line-separator characters.
 */
export const AGENT_LABEL_MAX = 64;

const FORBIDDEN = /[\p{C}\p{Zl}\p{Zp}]/u;

export function agentLabelError(raw: string): string | null {
  const label = raw.trim();
  if (!label) return "Give it a name.";
  if (label.length > AGENT_LABEL_MAX) return `At most ${AGENT_LABEL_MAX} characters.`;
  if (FORBIDDEN.test(label)) return "Use letters, numbers, spaces and punctuation only.";
  return null;
}

/** "key “laptop” of My agent": a key is always named with the agent it belongs to. */
export function keyOfAgent(keyName: string, agentLabel: string | null | undefined): string {
  return agentLabel ? `key “${keyName}” of ${agentLabel}` : `key “${keyName}”`;
}

/** The default name for a new key: "Key N", counting every key the agent has had. */
export function nextKeyName(keyCount: number): string {
  return `Key ${keyCount + 1}`;
}
