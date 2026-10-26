import { RouteLoading } from "@/components/patterns/route-loading";

/**
 * Shown at once while a provider console page loads, so a click (like
 * "Create your first tool listing" or "Publish your API") answers right
 * away instead of leaving the old page up for seconds (onboarding run 3).
 */
export default function ProviderLoading() {
  return <RouteLoading />;
}
