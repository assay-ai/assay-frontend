"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: the listing-path choice offered an unstaked "cannot be slashed" option that does not exist (paid calls go only to staked tools). Listing starts in the wizard. */
export default function RetiredPage() {
  return <ClientRedirect to="/provider/bindings/new" keepQuery={false} />;
}
