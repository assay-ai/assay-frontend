import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/alerts",
  useSearchParams: () => new URLSearchParams(),
}));

import { AlertRowActions, AlertsView } from "./alerts-view";

function render(providerMe?: unknown): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (providerMe) client.setQueryData(["provider", "me"], providerMe);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <AlertsView />
    </QueryClientProvider>,
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("Where alerts go (D2)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("says plainly that email is not available yet, and where alerts do go", () => {
    vi.stubEnv("NEXT_PUBLIC_ALERT_CHANNELS", "");
    const out = render();
    expect(out).toContain("Email alerts are not available yet.");
    expect(out).toContain("the bell on every page and Needs attention on Overview");
    expect(out).not.toContain("More channels are coming");
  });
});

describe("See all alerts: Mark read on a row (R1-M1)", () => {
  const html = (unread: boolean, action: { label: string; href: string } | null = null) =>
    renderToStaticMarkup(<AlertRowActions action={action} unread={unread} marking={false} onMarkRead={() => undefined} />);

  it("offers Mark read on an unread row, an open risk with no action included", () => {
    expect(html(true)).toContain('data-testid="alert-mark-read"');
    expect(html(true, { label: "Top up", href: "/funding?action=deposit" })).toContain("Top up");
  });
  it("offers no Mark read once the row is read", () => {
    expect(html(false, { label: "Top up", href: "/funding?action=deposit" })).not.toContain("alert-mark-read");
    expect(html(false)).toBe("");
  });
});

describe("Customise: provider-side events only for a provider (review m9)", () => {
  it("a buyer-only organization sees none; a provider sees them", () => {
    const buyer = render();
    expect(buyer).toContain("Customise: every alert");
    expect(buyer).toContain("App stopped: sign-in used twice");
    expect(buyer).not.toContain("Penalty decided");
    expect(render({ id: "org-1" })).toContain("Penalty decided");
  });
});

describe("headings do not skip a level (BUG-DEV-NF-01)", () => {
  it("puts the panel titles at h2, straight under the page's h1", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const html = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <AlertsView />
      </QueryClientProvider>,
    );
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    expect(levels[0]).toBe(1);
    expect(html).toMatch(/<h2[^>]*>Where alerts go<\/h2>/);
    levels.forEach((level, i) => expect(level - (levels[i - 1] ?? 0)).toBeLessThanOrEqual(1));
  });
});
