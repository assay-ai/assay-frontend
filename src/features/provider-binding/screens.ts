import { routes } from "@/libs/routes";

/** Every screen one binding has, in the order a provider walks them. */
export function bindingScreens(bindingId: string): { label: string; href: string }[] {
  const at = (sub?: string) => routes.binding(bindingId, sub);
  return [
    { label: "Overview", href: at() },
    { label: "Configuration", href: at("configuration") },
    { label: "Pricing", href: at("configuration/pricing") },
    { label: "Free tier", href: at("configuration/free-tier") },
    { label: "Declared SLA", href: at("configuration/sla") },
    { label: "Test", href: at("test") },
    { label: "Publish", href: at("publish") },
    { label: "Live SLA", href: at("sla") },
    { label: "Verdicts", href: at("verdicts") },
  ];
}
