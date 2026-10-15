"use client";

import { ClientRedirect } from "@/components/layout/client-redirect";

/** Retired: traffic is part of each tool's Quality tab, reached from Tools. */
export default function RetiredPage() {
  return <ClientRedirect to="/provider/bindings" keepQuery={false} />;
}
