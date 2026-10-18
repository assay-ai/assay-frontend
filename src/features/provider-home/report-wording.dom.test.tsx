import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { InboxItem, inboxView, type NotificationItem } from "@/app/(console)/provider/inbox/_components/inbox-item";

import { needsActionItems } from "./needs-action";
import { NeedsActionStrip } from "./needs-action-strip";

/**
 * Owner rule: never promise a money outcome the backend does not guarantee.
 * The daily auto-uphold cap can hand a silent report to an operator, so a
 * report "can be upheld automatically from <time>" — never "the buyer wins"
 * or "is upheld automatically at <time>". Checked on the rendered markup of
 * the Needs-action strip and the Inbox notice.
 */
const FORBIDDEN = [/buyer wins/i, /is upheld automatically at/i, /will be upheld/i];

const NOW = Date.parse("2026-10-18T12:00:00Z");
const report = {
  id: "d1",
  bindingId: "b1",
  canRespond: true,
  replyDueAt: "2026-10-19T10:00:00Z",
  autoUpholdAt: "2026-10-21T10:00:00Z",
  reasonLabel: "Other",
};

function text(markup: string): string {
  return markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
}

describe("report wording promises no outcome", () => {
  it("in the Needs-action strip", () => {
    for (const autoUpholdAt of [report.autoUpholdAt, null]) {
      const items = needsActionItems({
        penalties: [],
        reports: [{ ...report, autoUpholdAt }],
        openWindows: [],
        bindings: [{ id: "b1", toolId: "t1", status: "ACTIVE", endpoint: "https://api.example" }],
        stake: { enough: true, shortfall: null },
        label: () => "get_weather",
        now: NOW,
      });
      const rendered = text(renderToStaticMarkup(<NeedsActionStrip items={items} onOpenStake={() => undefined} />));
      expect(rendered).toContain("A buyer reported a bad result on get_weather: reply needed");
      for (const phrase of FORBIDDEN) expect(rendered).not.toMatch(phrase);
    }
    const [withUphold] = needsActionItems({
      penalties: [],
      reports: [report],
      openWindows: [],
      bindings: [],
      stake: { enough: true, shortfall: null },
      label: () => "x",
      now: NOW,
    });
    expect(withUphold!.detail).toContain("can be upheld automatically");
  });

  it("in the Inbox notice, new and legacy rows", () => {
    const rows: NotificationItem[] = [
      { role: "provider", disputeId: "d1", reasonLabel: "Other", replyDueAt: report.replyDueAt, autoUpholdAt: report.autoUpholdAt },
      { role: "provider", disputeId: "d1", reasonLabel: "Other", replyDueAt: report.replyDueAt, autoUpholdAt: null },
      { role: "provider", disputeId: "d1" },
    ].map((payload, i) => ({
      id: `n${i}`,
      event: "call_dispute.opened",
      severity: "WARNING",
      title: "A buyer disputed a call you served",
      body: 'A buyer reported "Other" on a call you served. You may reply once before an operator decides.',
      subjectType: "call_dispute",
      subjectId: "d1",
      readAt: null,
      payload,
      createdAt: "2026-10-18T10:00:00Z",
    }));
    for (const item of rows) {
      const view = inboxView(item, { toolName: () => null, now: NOW });
      const rendered = text(renderToStaticMarkup(<InboxItem item={item} view={view} />));
      for (const phrase of FORBIDDEN) expect(rendered).not.toMatch(phrase);
    }
    expect(inboxView(rows[0]!, { toolName: () => null, now: NOW }).body).toContain("can be upheld automatically from");
  });
});
