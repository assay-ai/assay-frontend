"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: a penalty is disputed on chain from its row on the Penalties page. */
export default function NewDisputeRedirect() {
  return <ClientRedirect to="/provider/penalties" keepQuery={false} />;
}
