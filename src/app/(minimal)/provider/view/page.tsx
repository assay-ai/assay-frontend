"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: a copy of the console home. */
export default function RetiredPage() {
  return <ClientRedirect to="/provider" keepQuery={false} />;
}
