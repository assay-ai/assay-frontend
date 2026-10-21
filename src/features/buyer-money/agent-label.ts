/**
 * An agent's label, checked the way `PATCH /agents/:id` checks it, so the
 * rename field says what is wrong before the request: trimmed, 1–64
 * characters (counted as the server counts them, by code point), no control,
 * format or line-separator characters, and at least one visible character.
 */
export const AGENT_LABEL_MAX = 64;

const FORBIDDEN = /[\p{C}\p{Zl}\p{Zp}]/u;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
/** Letters and symbols that draw nothing: Hangul fillers and the Braille blank. */
const BLANK_FILLERS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;

export function agentLabelError(raw: string): string | null {
  const label = raw.trim();
  if (!label) return "Give it a name.";
  if ([...label].length > AGENT_LABEL_MAX) return `At most ${AGENT_LABEL_MAX} characters.`;
  if (FORBIDDEN.test(label)) return "Use letters, numbers, spaces and punctuation only.";
  if (!VISIBLE.test(label.replace(BLANK_FILLERS, ""))) return "Give it a name people can see.";
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
