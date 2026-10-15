/**
 * Shared UX patterns — the guide. Import from the file, not from here
 * (`@/components/patterns/sign-action`), so a page only bundles what it uses;
 * this index exists so there is one place that says which to reach for.
 *
 * | Need                                   | Use                                           | Not                                        |
 * |----------------------------------------|-----------------------------------------------|--------------------------------------------|
 * | Multi-step goal (Get started, listed)  | `SetupChecklist`, `ChecklistPill`             | ad-hoc step lists                          |
 * | Anything that opens a wallet           | `SignAction` / `WalletActionSheet`            | "Build" then "Sign" button pairs           |
 * | Destructive/important, no signature    | `ConfirmSheet`                                | `window.confirm`, unconfirmed buttons      |
 * | Lifecycle with dates                   | `StatusTimeline`                              | `ui/timeline` (that is a call's event log) |
 * | Where money went / how it divides      | `MoneyFlow`, `MoneySplit`                     | prose                                      |
 * | A cap or budget                        | `CapMeter`                                    | `ui/meter` (no sentence, no refill)        |
 * | "What can this agent spend?"           | `EffectiveLimit` (`resolveLimit`)             | three separate limit panels                |
 * | A tx that must survive a reload        | `usePendingTransactions` (hooks)              | state held only in the signing sheet       |
 * | Loading / empty / error / blocked      | `PageState`, `Skeleton`                       | "Loading…", `ui/empty-state`, `common/Empty` |
 * | A record's state                       | `StatusChip`                                  | raw API status text, `ui/badge` for new UI |
 * | An amount                              | `PresetChips` + `parseAmountInput` (utils/money) | free text + `Number()`                  |
 * | Choosing a tool/agent/org/wallet       | `EntityPicker`                                | uuid / CAIP text inputs                    |
 * | Naming an id                           | `EntityName`, `useEntityNames` (hooks)        | printing the uuid; `shortToolId`           |
 * | Showing an id                          | `CopyChip` (`shortId`)                        | ids as labels                              |
 * | A term of art                          | `Term` (`libs/glossary.ts`)                   | inline explanations                        |
 * | A timestamp                            | `LocalTime`, `libs/local-time.ts`             | `g31/format` `timestamp` (UTC) in new UI   |
 * | A raw key / error code                 | `libs/plain-language.ts`                      | `${code} · ${message}`                     |
 * | A chain                                | `useChainName()` / `chainName` (utils/chain)  | CAIP-2 ids as labels                       |
 *
 * Breakpoints: the buyer shell switches chrome at `md` (768); page layouts
 * and these patterns switch at `tablet` (834). Between 768 and 833 the desktop
 * top bar sits over single-column content, which is intended.
 */
export {};
