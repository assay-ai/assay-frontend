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

