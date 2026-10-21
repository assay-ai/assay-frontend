import type { ReasonOption } from "@/components/patterns/reason-chips";

/**
 * The fixed reason vocabularies the console offers as chips (`ReasonChips`).
 * The backend takes any reason code up to 64 characters; these are the codes
 * the override register will carry, so Activity can say them back in words.
 * "Other" always exists and leans on the note.
 */

const OTHER: ReasonOption = { value: "OTHER", label: "Other", hint: "Say what happened in the note." };

export const BLOCK_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "LEAKED_KEY", label: "Leaked key", hint: "A key or wallet was exposed; stop it being used." },
  { value: "FRAUD", label: "Fraud", hint: "Deliberate abuse of payments or refunds." },
  { value: "ABUSE", label: "Abuse", hint: "Harmful or malformed traffic." },
  { value: "LEGAL_HOLD", label: "Legal hold", hint: "Required by a legal or compliance request." },
  OTHER,
]);

export const UNBLOCK_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "KEY_ROTATED", label: "Key rotated", hint: "The exposed key was replaced." },
  { value: "RESOLVED", label: "Resolved", hint: "The incident is closed." },
  { value: "BLOCKED_IN_ERROR", label: "Blocked in error", hint: "The wrong account was blocked." },
  OTHER,
]);

export const OPERATOR_ADD_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "NEW_HIRE", label: "Joining the team" },
  { value: "ROLE_CHANGE", label: "Role change" },
  { value: "INCIDENT_COVER", label: "Incident cover" },
  OTHER,
]);

export const OPERATOR_CHANGE_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "ROLE_CHANGE", label: "Role change" },
  { value: "ACCESS_REVIEW", label: "Access review" },
  { value: "INCIDENT_COVER", label: "Incident cover" },
  OTHER,
]);

export const OPERATOR_REMOVE_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "OFFBOARDED", label: "Left the team" },
  { value: "ACCESS_REVIEW", label: "Access no longer needed" },
  { value: "SECURITY", label: "Security concern", hint: "Every session they hold ends at once." },
  OTHER,
]);

/** Publishing a contract version or making one current (P-10, P-11). */
export const CONTRACT_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "PLANNED_CHANGE", label: "Planned change", hint: "Part of the tool's roadmap." },
  { value: "PROVIDER_REQUEST", label: "Providers asked", hint: "Providers asked for this field or change." },
  { value: "BUYER_REQUEST", label: "Buyers asked", hint: "Agents need this field or change." },
  { value: "FIX_CONTRACT", label: "Fix a mistake", hint: "The published contract was wrong." },
  OTHER,
]);

/** Deprecating a contract major (P-12). */
export const DEPRECATE_REASONS: readonly ReasonOption[] = Object.freeze([
  { value: "REPLACED_BY_NEWER", label: "Newer version ready", hint: "Enough providers serve the newer version." },
  { value: "REPLACED_BY_TOOL", label: "Another tool replaces it" },
  { value: "UNSAFE_CONTRACT", label: "Unsafe to keep", hint: "The old version gives agents wrong or risky answers." },
  OTHER,
]);

/** A reason code in words, from any vocabulary above; unknown codes are humanised. */
export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "";
  for (const list of [BLOCK_REASONS, UNBLOCK_REASONS, OPERATOR_ADD_REASONS, OPERATOR_CHANGE_REASONS, OPERATOR_REMOVE_REASONS, CONTRACT_REASONS, DEPRECATE_REASONS]) {
    const found = list.find((option) => option.value === code);
    if (found && found.value !== "OTHER") return found.label;
  }
  const words = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
