/** Every call-dispute (bad-result report) query key, the buyer's and the provider's. */
export const callDisputeKeys = {
  all: ["call-disputes"] as const,
  buyer: ["call-disputes", "buyer"] as const,
  forIntent: (intentId: string) => ["call-disputes", "buyer", "intent", intentId] as const,
  one: (id: string) => ["call-disputes", "buyer", "one", id] as const,
  provider: ["call-disputes", "provider"] as const,
  providerOne: (id: string) => ["call-disputes", "provider", "one", id] as const,
};
