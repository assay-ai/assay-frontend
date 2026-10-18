import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => "/alerts",
  useSearchParams: () => new URLSearchParams(),
}));

import { AlertsView } from "./alerts-view";

function render(): string {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
