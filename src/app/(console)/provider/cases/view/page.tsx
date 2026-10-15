"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/**
 * Retired: a case is the "Why?" drawer on the Penalties page, and its Dispute
 * is the on-chain one. `?id=<case id>` becomes `?case=<case id>`.
 */
export default function CaseRedirect() {
  return <ClientRedirect to="/provider/penalties" rename={{ id: "case" }} />;
}
