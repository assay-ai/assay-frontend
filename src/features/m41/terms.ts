import type { ProviderTermsSummary } from "@/interfaces";

/**
 * The provider terms as the design prints them, used ONLY while the server's
 * own copy is unreadable.
 *
 * The whole point of provider setup step 4 is that the terms are on the page rather than
 * behind a link, and `provider-registration.service.ts` is explicit that the
 * versions must be read from `getProviderRegistration().terms` rather than
 * hardcoded. But `GET /providers/me/registration` answers
 * `404 PROVIDER_NOT_FOUND` for an organisation that has not registered — which
 * is precisely the audience that has to read the terms before accepting them,
 * and there is no other route that publishes them (checked: the backend's
 * `provider-terms.ts` is reachable from that one endpoint and nowhere else).
 *
 * So the table below is the design's own rows, verbatim, and it
 * is the fallback, never the preference: the moment the server publishes a
 * `terms` object — which it does for every registered org, and for this one
 * the instant `POST /providers` succeeds — {@link resolveTerms} returns the
 * server's copy and this constant stops being rendered.
 *
 * The failure mode is bounded and loud rather than silent. If the published
 * versions move while this fallback is in use, `POST /providers` refuses with
 * `PROVIDER_TERMS_VERSION_MISMATCH` and names both triples, and the screen
 * shows that refusal — nobody is recorded as having accepted a version they
 * were not shown.
 *
 * `stakeRequired` mirrors the wire ("$50.00 minimum"); the setup screen reads
 * the published value, never a literal.
 */
export const DESIGN_TERMS: ProviderTermsSummary = {
  providerAgreementVersion: "v1.0",
  payoutTermsVersion: "v1.0",
  slashPolicyVersion: "v1.0",
  acceptanceLine:
    "I accept the provider agreement v1.0, the payout terms v1.0 and the slash policy v1.0",
  commercialTerms: [
    { key: "takeRate", label: "Take rate", value: "10%", caption: "flat, no per-call fee floor" },
    { key: "payouts", label: "Payouts", value: "hourly above $10", caption: "on-chain and final" },
    {
      key: "reserveHeld",
      label: "Reserve held",
      value: "$0.00",
      caption: "we hold nothing back against your account",
    },
    { key: "clawback", label: "Clawback", value: "never", caption: "a paid payout stays paid" },
    {
      key: "stakeRequired",
      label: "Stake required",
      value: "$50.00 minimum",
      caption: "before paid traffic — the free path needs none",
    },
    {
      key: "slashedWhen",
      label: "Slashed when",
      value: "DATA_FAIL only",
      caption: "never for upstream failure or a bad request from the agent",
    },
    {
      key: "penaltySplit",
      label: "Where a penalty goes",
      value: "60 / 30 / 10",
      caption: "60% to the agent served the bad result, 30% platform, 10% stays yours",
    },
  ],
};

/** The server's published terms whenever there are any; the design's otherwise. */
export function resolveTerms(terms: ProviderTermsSummary | undefined): {
  terms: ProviderTermsSummary;
  /** True when nothing on the wire published these — the fallback is showing. */
  fromDesign: boolean;
} {
  return terms ? { terms, fromDesign: false } : { terms: DESIGN_TERMS, fromDesign: true };
}
