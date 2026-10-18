import type { EntityOption } from "@/components/patterns/entity-picker";
import type { AccountBlock, BlockSubjectKind } from "@/interfaces/operator";
import { toChecksumAddress } from "@/libs/chains/evm/operator-wallet";
import { shortAddress } from "@/libs/chains/format";

/**
 * The block form's one search box: whatever an operator has — a wallet, a
 * provider's name, an organization id — becomes a pickable target, and its
 * kind (wallet or organization) is inferred from it. No uuid or CAIP text
 * field, no kind dropdown.
 *
 * Organizations are found by name only among providers in the public
 * catalogue: there is no operator lookup of organizations by name or email
 * yet [backend]. An organization id pasted in still works, and shows its name
 * when the catalogue knows it.
 *
 * A picked option's id is `<KIND>:<subject as typed>`, e.g.
 * `WALLET:0xabc…` or `ORGANIZATION:3f2c…`; `pickedTarget` reads it back.
 */
export interface NamedProvider {
  providerId: string;
  legalName: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const CAIP10_RE = /^([-a-z0-9]{3,8}):([-_a-zA-Z0-9]{1,32}):([-.%a-zA-Z0-9]{1,128})$/;

export function targetId(kind: BlockSubjectKind, subject: string): string {
  return `${kind}:${subject}`;
}

export function pickedTarget(id: string | null): { kind: BlockSubjectKind; subject: string } | null {
  if (!id) return null;
  const colon = id.indexOf(":");
  const kind = id.slice(0, colon);
  if (kind !== "WALLET" && kind !== "ORGANIZATION") return null;
  return { kind, subject: id.slice(colon + 1) };
}

/** "Wallet 0x9f3C…F36c" for any wallet spelling (bare 0x, CAIP-10). */
export function walletLabel(subject: string): string {
  const match = CAIP10_RE.exec(subject);
  const [chain, address] = match ? [`${match[1]}:${match[2]}`, match[3]!] : ["eip155:1", subject];
  const shown = chain.startsWith("eip155") && EVM_RE.test(address) ? toChecksumAddress(address) : address;
  return `Wallet ${shortAddress(chain, shown)}`;
}

/** The plain address of a wallet subject, for the on-chain block (`0x…` only). */
export function evmAddressOf(subject: string): string | null {
  if (EVM_RE.test(subject)) return subject;
  const match = CAIP10_RE.exec(subject);
  if (match && match[1] === "eip155" && EVM_RE.test(match[3]!)) return match[3]!;
  return null;
}

/** Options for what was typed. Pure. */
export function searchBlockTargets(query: string, providers: readonly NamedProvider[]): EntityOption[] {
  const q = query.trim();
  if (!q) {
    return providers.slice(0, 8).map((p) => ({ id: targetId("ORGANIZATION", p.providerId), label: p.legalName, detail: "Provider organization" }));
  }
  if (EVM_RE.test(q) || CAIP10_RE.test(q)) {
    return [{ id: targetId("WALLET", q), label: walletLabel(q), detail: "Wallet · blocked on every EVM chain" }];
  }
  if (UUID_RE.test(q)) {
    const known = providers.find((p) => p.providerId.toLowerCase() === q.toLowerCase());
    return [
      {
        id: targetId("ORGANIZATION", q.toLowerCase()),
        label: known ? known.legalName : `Organization ${q.slice(0, 8)}…`,
        detail: known ? "Provider organization" : "Organization id · its name is not in the public catalogue",
      },
    ];
  }
  const lower = q.toLowerCase();
  return providers
    .filter((p) => p.legalName.toLowerCase().includes(lower))
    .sort((a, b) => Number(!a.legalName.toLowerCase().startsWith(lower)) - Number(!b.legalName.toLowerCase().startsWith(lower)))
    .slice(0, 8)
    .map((p) => ({ id: targetId("ORGANIZATION", p.providerId), label: p.legalName, detail: "Provider organization" }));
}

/** What the picker says when nothing matches. */
export function noTargetText(query: string): string {
  if (!query.trim()) return "Type a wallet (0x…), a provider's name or an organization id.";
  if (query.includes("@")) return "Searching by email is not available yet. Paste the organization id or the wallet instead.";
  if (/^0x/i.test(query.trim())) return "A wallet is 0x followed by 40 hex characters.";
  return `No provider called “${query}”. Paste a wallet, or the organization id.`;
}

/**
 * A block's subject in words: the organization's name (the server names every
 * one, listed or not), or the short wallet. The short id is only for a row
 * whose organization no longer exists.
 */
export function blockSubjectLabel(
  block: Pick<AccountBlock, "subjectKind" | "subject"> & { subjectName?: string | null },
  providerName: (id: string) => string | null,
): string {
  if (block.subjectKind === "ORGANIZATION") return block.subjectName ?? providerName(block.subject) ?? `Organization ${block.subject.slice(0, 8)}…`;
  return walletLabel(block.subject);
}
