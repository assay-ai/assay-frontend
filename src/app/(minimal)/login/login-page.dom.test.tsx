import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("@privy-io/react-auth", () => ({
  usePrivy: () => ({ ready: true, authenticated: false, login: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(search.value),
}));
vi.mock("@/components/patterns/testnet-chip", () => ({ TestnetChip: () => null }));

import { chainTerms } from "@/libs/chain-terms";
import { definitionOf } from "@/libs/glossary";
import { TEST_CHAIN, WithChains } from "@/test/chain-fixture";

import LoginPage from "./page";

function render(query: string) {
  search.value = query;
  const html = renderToStaticMarkup(
    <WithChains>
      <LoginPage />
    </WithChains>,
  );
  const aside = html.slice(html.indexOf("<aside"), html.indexOf("</aside>"));
  return { html, aside, text: html.replace(/<[^>]+>/g, "") };
}

/* A#5 / D (2026-10-18): "Sign in to start listing" showed the buyer pitch, and linked the buyer page. */
describe("login, sent from a provider page", () => {
  beforeEach(() => {
    search.value = "";
  });

  it("shows the provider pitch and no buyer pitch", () => {
    const { aside, text } = render("next=%2Fprovider%2Fsetup");
    expect(text).toContain("Sign in to start listing");
    expect(aside).toContain("Paid per call, on chain");
    expect(aside).toContain("Payouts are never clawed back");
    const plain = aside.replace(/&#x27;/g, "'");
    expect(plain).toContain(definitionOf("payout-final", chainTerms(TEST_CHAIN)));
    expect(plain).toContain("What your stake risks");
    expect(plain).toContain(definitionOf("stake-rule", chainTerms(TEST_CHAIN)));
    expect(aside).not.toContain("Only your stake is at risk");
    expect(aside).not.toContain("You don&#x27;t pay for results you can&#x27;t use");
    expect(aside).not.toContain("We hold, not charge");
    expect(aside).not.toContain("Not charged");
  });

  it("links Why list here, not the buyer explainer", () => {
    const { aside, html, text } = render("next=%2Fprovider");
    expect(aside).toContain('href="/why-list-here"');
    expect(text).toContain("New to listing? See why to list here");
    expect(text).not.toContain("New to Assay? See how it works");
    expect(html).toContain('href="/why-list-here"');
  });

  it("says one account serves both sides", () => {
    expect(render("next=%2Fprovider").text).toContain("One account for using and listing tools.");
    expect(render("").text).toContain("One account for using and listing tools.");
  });
});

describe("login, as a buyer", () => {
  it("keeps the buyer pitch and How it works", () => {
    const { aside, text } = render("next=%2Ffunding");
    expect(text).toContain("Sign in");
    expect(text).not.toContain("Sign in to start listing");
    expect(aside).toContain("We hold, not charge");
    expect(aside).not.toContain("Payouts are never clawed back");
    expect(text).toContain("New to Assay? See how it works");
  });

  it("names the sign-in methods, not the vendor", () => {
    const { text } = render("");
    expect(text).toContain("A sign-in window opens here: email code or wallet.");
    expect(text).not.toContain("Privy");
  });
});
