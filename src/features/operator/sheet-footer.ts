/**
 * The footer of every operator sheet. It stays put at the bottom of the
 * sheet while the person types (sticky, its own border), and on a phone the
 * two buttons sit side by side — Cancel left, the action right — rather than
 * stacked: when the keyboard closes and the sheet moves, a tap meant for the
 * action can no longer land on the button under it (round 2: "Keep it
 * blocked" hit instead of "Send for approval").
 */
export const OPERATOR_SHEET_FOOTER =
  "sticky bottom-0 z-10 border-t border-01 bg-01 pb-[max(1.25rem,env(safe-area-inset-bottom))]";

export const OPERATOR_SHEET_BUTTONS =
  "grid w-full grid-cols-2 gap-2 [&>*]:min-w-0 [&>*]:!whitespace-normal [&>*]:text-center tablet:flex tablet:justify-end";
