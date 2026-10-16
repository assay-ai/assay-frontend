import type { PricingMode } from "@/interfaces";

/**
 * Free first, then paid — what a provider choosing a free tier is told.
 *
 * When a tool has both free-tier and paid providers, an agent's call is served
 * free by a FREE or FREEMIUM binding while the agent's free calls for the day
 * last, and only then paid, by a PAID or FREEMIUM binding. A FREE binding never
 * takes a paid call; a PAID one never takes a free call. `null` for PAID (and
 * for no mode yet), which has no free tier to explain.
 */
export function freeFirstHint(mode: PricingMode | ""): string | null {
  if (mode === "FREE") {
    return (
      "Your free tier is used first, even when this tool has paid providers: an agent's calls " +
      "come here while its free calls for the day last. This binding never takes a paid call."
    );
  }
  if (mode === "FREEMIUM") {
    return (
      "Your free tier is used first, even when this tool has paid providers: an agent's calls " +
      "are free while its free calls for the day last, then paid calls at your price."
    );
  }
  return null;
}
