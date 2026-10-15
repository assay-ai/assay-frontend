import type {
  AddOperatorBody,
  ChangeOperatorBody,
  OperatorDirectoryEntry,
  OperatorIdentity,
  OperatorRole,
  RemoveOperatorBody,
} from "@/interfaces/operator";
import { ApiError } from "@/libs/ApiClient";
import { checkEvmAddress } from "@/libs/chains/evm/operator-wallet";

/**
 * The operator directory's forms (`A-12` add, `A-13` change, `A-14` remove)
 * and who may use them. Validation mirrors assay-backend
 * `operator-directory.dto.ts`, so a form the backend would refuse is refused
 * here first, next to the field that is wrong.
 */

/** Every role, in the order the console lists them, with what each one is for. */
export const ROLE_OPTIONS: readonly { role: OperatorRole; label: string }[] = Object.freeze([
  { role: "ADJ", label: "Adjudicator" },
  { role: "ADJL", label: "Lead adjudicator" },
  { role: "SRE", label: "On-call (SRE)" },
  { role: "TRE", label: "Treasury" },
  { role: "TREA", label: "Treasury approver" },
  { role: "POL", label: "Policy author" },
  { role: "POLA", label: "Policy approver" },
  { role: "BD", label: "Provider success" },
  { role: "SUP", label: "Support" },
  { role: "CMP", label: "Compliance" },
  { role: "SEC", label: "Security" },
  { role: "OPS_ADMIN", label: "Admin" },
]);

export const DIRECTORY_NOTE_MIN = 10;
export const DIRECTORY_NOTE_MAX = 2048;
export const REASON_CODE_MAX = 64;
export const SUBJECT_MAX = 256;
export const DISPLAY_NAME_MAX = 128;

const MINOR_UNITS = /^(0|[1-9][0-9]{0,77})$/;

/** `OPS_ADMIN` is the one role that manages the directory. */
export function mayManageOperators(roles: readonly OperatorRole[]): boolean {
  return roles.includes("OPS_ADMIN");
}

/** Edit and remove are hidden on your own row: the backend refuses both. */
export function mayEditRow(me: Pick<OperatorIdentity, "id" | "roles">, row: Pick<OperatorDirectoryEntry, "id" | "status">): boolean {
  return mayManageOperators(me.roles) && row.id !== me.id && row.status !== "REMOVED";
}

/** How the authority limit is chosen in a form. */
export type LimitMode = "zero" | "amount" | "unbounded";

export interface LimitInput {
  mode: LimitMode;
  /** Minor units, digits only. Read only when `mode` is `amount`. */
  amount: string;
}

export interface AddOperatorInput {
  walletAddress: string;
  subject: string;
  displayName: string;
  roles: OperatorRole[];
  limit: LimitInput;
  reasonCode: string;
  note: string;
}

export interface ChangeOperatorInput {
  roles: OperatorRole[];
  limit: LimitInput;
  reasonCode: string;
  note: string;
}

export interface RemoveOperatorInput {
  reasonCode: string;
  note: string;
}

export type FormErrors<K extends string> = Partial<Record<K, string>>;

export type Validated<B, K extends string> =
  | { readonly ok: true; readonly body: B }
  | { readonly ok: false; readonly errors: FormErrors<K> };

function compact<K extends string>(errors: FormErrors<K>): FormErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([, v]) => v !== undefined)) as FormErrors<K>;
}

function reasonError(value: string): string | undefined {
  if (value.length === 0) return "A reason code is required.";
  if (value.length > REASON_CODE_MAX) return `At most ${REASON_CODE_MAX} characters.`;
  return undefined;
}

function noteError(value: string): string | undefined {
  if (value.length < DIRECTORY_NOTE_MIN) {
    return `At least ${DIRECTORY_NOTE_MIN} characters (${value.length} so far).`;
  }
  if (value.length > DIRECTORY_NOTE_MAX) return `At most ${DIRECTORY_NOTE_MAX} characters.`;
  return undefined;
}

function limitOf(input: LimitInput): { value: string | null } | { error: string } {
  if (input.mode === "unbounded") return { value: null };
  if (input.mode === "zero") return { value: "0" };
  const amount = input.amount.trim();
  if (!MINOR_UNITS.test(amount)) {
    return { error: "A whole number of minor units: digits only, no decimal point, no leading zero." };
  }
  return { value: amount };
}

/** The form's limit as the directory row holds it. */
export function limitInputOf(row: Pick<OperatorDirectoryEntry, "authorityLimit">): LimitInput {
  if (row.authorityLimit === null) return { mode: "unbounded", amount: "" };
  if (row.authorityLimit.amount === "0") return { mode: "zero", amount: "" };
  return { mode: "amount", amount: row.authorityLimit.amount };
}

export function validateAddOperator(
  input: AddOperatorInput,
): Validated<AddOperatorBody, keyof AddOperatorInput> {
  const wallet = checkEvmAddress(input.walletAddress);
  const subject = input.subject.trim();
  const displayName = input.displayName.trim();
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const limit = limitOf(input.limit);

  const errors = compact<keyof AddOperatorInput>({
    walletAddress: wallet.ok ? undefined : wallet.error,
    subject:
      subject.length === 0
        ? "A subject is required, e.g. dan@."
        : subject.length > SUBJECT_MAX
          ? `At most ${SUBJECT_MAX} characters.`
          : undefined,
    displayName: displayName.length > DISPLAY_NAME_MAX ? `At most ${DISPLAY_NAME_MAX} characters.` : undefined,
    roles: input.roles.length === 0 ? "Choose at least one role." : undefined,
    limit: "error" in limit ? limit.error : undefined,
    reasonCode: reasonError(reasonCode),
    note: noteError(note),
  });
  if (!wallet.ok || "error" in limit || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    body: {
      walletAddress: wallet.checksummed,
      subject,
      ...(displayName ? { displayName } : {}),
      roles: [...new Set(input.roles)],
      authorityLimitMinor: limit.value,
      reasonCode,
      note,
    },
  };
}

function sameRoles(a: readonly OperatorRole[], b: readonly OperatorRole[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((role) => right.has(role));
}

/**
 * Only what changed is sent: the backend applies a lowering at once and
 * queues anything that adds a role or raises the limit.
 */
export function validateChangeOperator(
  row: Pick<OperatorDirectoryEntry, "roles" | "authorityLimit">,
  input: ChangeOperatorInput,
): Validated<ChangeOperatorBody, keyof ChangeOperatorInput | "change"> {
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const limit = limitOf(input.limit);
  const currentLimit = row.authorityLimit === null ? null : row.authorityLimit.amount;

  const rolesChanged = !sameRoles(row.roles, input.roles);
  const limitChanged = !("error" in limit) && limit.value !== currentLimit;

  const errors = compact<keyof ChangeOperatorInput | "change">({
    roles: input.roles.length === 0 ? "Keep at least one role, or remove the operator instead." : undefined,
    limit: "error" in limit ? limit.error : undefined,
    reasonCode: reasonError(reasonCode),
    note: noteError(note),
    change:
      !("error" in limit) && !rolesChanged && !limitChanged
        ? "Nothing changed: pick different roles or a different limit."
        : undefined,
  });
  if ("error" in limit || Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    body: {
      ...(rolesChanged ? { roles: [...new Set(input.roles)] } : {}),
      ...(limitChanged ? { authorityLimitMinor: limit.value } : {}),
      reasonCode,
      note,
    },
  };
}

export function validateRemoveOperator(
  input: RemoveOperatorInput,
): Validated<RemoveOperatorBody, keyof RemoveOperatorInput> {
  const reasonCode = input.reasonCode.trim();
  const note = input.note.trim();
  const errors = compact<keyof RemoveOperatorInput>({
    reasonCode: reasonError(reasonCode),
    note: noteError(note),
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, body: { reasonCode, note } };
}

export function directoryErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return "The request could not be completed.";
  const tail = ` (${error.code})`;
  switch (error.code) {
    case "OPERATOR_ALREADY_EXISTS":
      return `An operator with this wallet or subject already exists.${tail}`;
    case "OPERATOR_SELF_CHANGE_REFUSED":
      return `Nobody may change or remove their own access.${tail}`;
    case "OPERATOR_CHANGE_EMPTY":
      return `The change does not alter the roles or the limit.${tail}`;
    case "OPERATOR_WALLET_INVALID":
      return `The wallet address was not accepted.${tail}`;
    case "OPERATOR_ROLE_REQUIRED":
      return `Managing operators needs the OPS_ADMIN role.${tail}`;
    case "OPERATOR_NOT_FOUND":
      return `That operator no longer exists. Reload the list.${tail}`;
    default:
      return `${error.message}${tail}`;
  }
}

// ── Plain-language form helpers ─────────────────────────────────────────────

/** "Noor Hassan" → "noor@", the short handle the register names people by. */
export function deriveSubject(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const handle = first
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\u0111/g, "d")
    .replace(/[^a-z0-9._-]/g, "");
  return handle ? `${handle}@` : "";
}

/**
 * The limit chosen in dollars ("0", "100", "1000", "unlimited" or a typed
 * amount already converted to minor units) as the form's `LimitInput`.
 */
export function limitInputFromChoice(choice: string, atomic: string | null): LimitInput {
  if (choice === "unlimited") return { mode: "unbounded", amount: "" };
  if (choice === "0" || atomic === "0") return { mode: "zero", amount: "" };
  return { mode: "amount", amount: atomic ?? "" };
}
