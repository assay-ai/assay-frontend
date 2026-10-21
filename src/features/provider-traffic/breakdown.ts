/**
 * How a provider sees a buyer's agent on the traffic-by-agent view (a
 * listing's Quality tab, "Who calls this tool"): no name is shared, only the
 * agent id.
 */

/**
 * `payment_intents.agent_id`, shortened for display — there is no `ag_7K2`
 * short-ref form on the wire (the design's is a placeholder, same situation
 * `shortBindingId` documents for bindings). Always pair with the full id.
 */
export function shortAgentId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/** "Agent a1b2" — a buyer's agent as a provider sees it: no name is shared, so a short tag of its id. */
export function agentLabel(id: string): string {
  return `Agent ${id.replace(/[^0-9a-z]/gi, "").slice(0, 4).toLowerCase()}`;
}
