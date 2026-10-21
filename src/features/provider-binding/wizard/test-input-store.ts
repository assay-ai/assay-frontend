import { looksLikeSecretName } from "../authentication/rules";

/**
 * The last test input of a listing, kept for this browser tab only
 * (`sessionStorage`) so a reload does not empty the boxes.
 *
 * It holds tool arguments, never a key: a field whose name looks like a
 * secret (the rule the binding validator uses for secret header names) is
 * never written. Every entry is removed on logout.
 */

const PREFIX = "assay:binding-test-input:";

function store(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readTestInput(bindingId: string | null | undefined): Record<string, string> | null {
  if (!bindingId) return null;
  try {
    const raw = store()?.getItem(`${PREFIX}${bindingId}`);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && !looksLikeSecretName(entry[0]),
      ),
    );
  } catch {
    return null;
  }
}

export function writeTestInput(bindingId: string, values: Readonly<Record<string, string>>): void {
  const kept = Object.fromEntries(Object.entries(values).filter(([name]) => !looksLikeSecretName(name)));
  try {
    store()?.setItem(`${PREFIX}${bindingId}`, JSON.stringify(kept));
  } catch {
    // Blocked storage: the input is simply not kept.
  }
}

/** On logout: nothing of the last person's test inputs stays in the tab. */
export function clearKeptTestInputs(): void {
  const storage = store();
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
