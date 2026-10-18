// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OperatorToolRequestRow } from "@/services/operator-contracts.service";

const service = vi.hoisted(() => ({ answerOperatorToolRequest: vi.fn() }));
vi.mock("@/services/operator-contracts.service", async (original) => ({ ...(await original<object>()), ...service }));

import { AnswerRequestSheet, type ToolRequestAnswer } from "./contract-sheets";

const REQUEST: OperatorToolRequestRow = {
  id: "req-1",
  organizationId: "org-1",
  title: "Patent search",
  expectedMonthlyCalls: null,
  status: "OPEN",
  ownerOperatorId: null,
  firstResponseDueAt: "2026-10-18T00:00:00.000Z",
  createdAt: "2026-10-15T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function open(answer: ToolRequestAnswer, onAnswered = vi.fn()) {
  service.answerOperatorToolRequest.mockResolvedValue({ ...REQUEST, status: answer === "decline" ? "DECLINED" : "ACKNOWLEDGED" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AnswerRequestSheet request={REQUEST} answer={answer} onClose={() => undefined} onAnswered={onAnswered} />
    </QueryClientProvider>,
  );
  return onAnswered;
}

describe("answering a tool request through the existing PATCH", () => {
  it("refuses an empty decline note and sends nothing", () => {
    open("decline");
    fireEvent.click(screen.getByRole("button", { name: "Decline request" }));
    expect(screen.getByText("Say why, for the person who asked.")).toBeTruthy();
    expect(service.answerOperatorToolRequest).not.toHaveBeenCalled();
  });

  it("declines with the note the person reads", async () => {
    const done = open("decline");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  It overlaps get_weather.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Decline request" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(service.answerOperatorToolRequest).toHaveBeenCalledWith("req-1", { status: "DECLINED", resolutionNote: "It overlaps get_weather." });
  });

  it("marks it being reviewed, with no note", async () => {
    const done = open("acknowledge");
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as being reviewed" }));
    await waitFor(() => expect(done).toHaveBeenCalled());
    expect(service.answerOperatorToolRequest).toHaveBeenCalledWith("req-1", { status: "ACKNOWLEDGED" });
  });
});
