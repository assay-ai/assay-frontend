import { routes } from "@/libs/routes";

export type BindingTabId = "overview" | "settings" | "quality";

/** A listed tool's three pages. Everything a provider does to one listing lives in one of them. */
export function bindingScreens(bindingId: string): { id: BindingTabId; label: string; href: string }[] {
  return [
    { id: "overview", label: "Overview", href: routes.binding(bindingId) },
    { id: "settings", label: "Settings", href: routes.binding(bindingId, "settings") },
    { id: "quality", label: "Quality", href: routes.binding(bindingId, "quality") },
  ];
}

/**
 * The nine pages a binding used to have, and where each one lives now. Every
 * old path is a client redirect (static export: no server 301), keeping
 * `?binding=`. Wizard targets carry the stage to resume at.
 */
export const RETIRED_BINDING_PAGES: Record<string, string> = {
  configuration: "/provider/bindings/view/settings",
  "configuration/pricing": "/provider/bindings/view/settings?section=pricing",
  "configuration/free-tier": "/provider/bindings/view/settings?section=pricing",
  "configuration/sla": "/provider/bindings/view/settings?section=promise",
  test: "/provider/bindings/new?stage=connect",
  "test/backtest": "/provider/bindings/view/quality",
  publish: "/provider/bindings/new?stage=live",
  sla: "/provider/bindings/view/quality",
  verdicts: "/provider/bindings/view/quality?section=verdicts",
};
