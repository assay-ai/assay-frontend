"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: registration lives in the setup stepper. */
export default function RetiredPage() {
  return <ClientRedirect to="/provider/setup" />;
}
