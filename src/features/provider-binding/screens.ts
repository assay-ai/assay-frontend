/** Every screen one binding has, in the order a provider walks them. */
export function bindingScreens(bindingId: string): { label: string; href: string }[] {
  const base = `/provider/bindings/${bindingId}`;
  return [
    { label: "Overview", href: base },
    { label: "Configuration", href: `${base}/configuration` },
    { label: "Pricing", href: `${base}/configuration/pricing` },
    { label: "Free tier", href: `${base}/configuration/free-tier` },
    { label: "Declared SLA", href: `${base}/configuration/sla` },
    { label: "Test", href: `${base}/test` },
    { label: "Publish", href: `${base}/publish` },
    { label: "Live SLA", href: `${base}/sla` },
    { label: "Verdicts", href: `${base}/verdicts` },
  ];
}
