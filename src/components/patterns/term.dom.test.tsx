import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { GLOSSARY } from "@/libs/glossary";

import { Term } from "./term";

/*
  The definition sat in an sr-only span inside the sentence, so a screen
  reader and a copy of the page read "Free tier Calls a provider serves ...
  calls need no funds" (review 2026-10-17 sync 2, P3-5). It is `hidden` now:
  still the trigger's description, never part of the sentence.
*/
describe("Term", () => {
  it("keeps the definition out of the sentence but still describes the term", () => {
    const html = renderToStaticMarkup(
      <p>
        <Term k="free-tier">Free tier</Term> calls need no funds.
      </p>,
    );
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<span id="${id}" hidden="">${GLOSSARY["free-tier"].definition}</span>`);
    expect(html).not.toContain("sr-only");
  });
});
