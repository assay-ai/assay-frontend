"use client";

import * as React from "react";

import type { OperatorIdentity } from "@/interfaces/operator";

/**
 * The signed-in operator, supplied by `(operator)/layout.tsx` so the case
 * screen can gate on roles without refetching `/operator/me` per screen.
 *
 * Null only outside the provider — the layout does not render `children` until
 * the identity has loaded, so consumers inside it may rely on it.
 */
export const OperatorSessionContext = React.createContext<OperatorIdentity | null>(null);

export function useOperatorSession(): OperatorIdentity {
  const identity = React.useContext(OperatorSessionContext);
  if (!identity) {
    throw new Error("useOperatorSession must be used inside the (operator) layout");
  }
  return identity;
}
