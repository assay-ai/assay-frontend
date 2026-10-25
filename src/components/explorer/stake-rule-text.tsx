"use client";

import { useChainTerms } from "@/hooks/useChainTerms";
import { definitionOf } from "@/libs/glossary";

/** The glossary's stake rule with the chain's numbers: a client leaf, so server pages keep their metadata. */
export function StakeRuleText() {
  const { terms } = useChainTerms();
  return <>{definitionOf("stake-rule", terms)}</>;
}
