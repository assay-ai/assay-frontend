/**
 * Why a call earned nothing, in the provider's words. Keyed on the call class
 * of the per-call export; the buyer's "Not charged" uses the same classes, so
 * the two sides describe one call the same way.
 */
export interface NotCreditedReason {
  title: string;
  detail: string;
}

const REASONS: Record<string, NotCreditedReason> = {
  PAID_UNCREDITED: {
    title: "The answer failed Assay's check",
    detail: "Your API answered, but the result did not pass the tool's checks (a value out of range, a missing field, stale data). The buyer was not charged.",
  },
  SYSTEM_ERROR: {
    title: "Your API errored or timed out",
    detail: "It answered with a server error (5xx) or did not answer within your timeout.",
  },
  REQUEST_ERROR: {
    title: "Your API refused the request",
    detail: "It answered with a 4xx error. Usually the agent sent input your API does not accept; check your request mapping.",
  },
  EXCLUDED: {
    title: "Excluded by Assay",
    detail: "Assay's team took these calls out of the count, for example during an incident on our side.",
  },
};

export function notCreditedReason(className: string): NotCreditedReason {
  return (
    REASONS[className] ?? {
      title: "Not credited",
      detail: "These calls did not settle to you.",
    }
  );
}
