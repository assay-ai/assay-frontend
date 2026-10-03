import * as React from "react";

import { Avatar, type AvatarColor } from "@/components/ui/avatar";
import { cn } from "@/utils";

/**
 * Minimal Bar — the provider console's 56px chrome for screens that carry no
 * sidebar.
 *
 * The design never made this reusable. It exists as **six local copies**, one
 * per screen, byte-identical apart from the two text slots:
 *
 * | Screen               | Left slot                               | Right slot           |
 * |----------------------|-----------------------------------------|----------------------|
 * | Provider view        | `Provider view · provider.example`      | `as of 12:41 UTC`    |
 * | Provider setup       | `Provider setup · provider.example`     | `step 2 of 4`        |
 * | Binding and traffic  | `provider.example · binding ais_lookup` | `as of 12:41 UTC`    |
 * | Verdicts and flags   | `provider.example · verdicts`           | `612 in the last 24h`|
 * | Shadow mode          | `provider.example · shadow mode`        | `August 2026`        |
 *
 * The sixth 56px "Bar" in the design, on the operator console,
 * is **not** this component: it fills `$bg-inverse`, has no Mark and no Avatar,
 * and ends in a Badge instead. Do not route it here.
 *
 * Geometry is verbatim from the five copies: `height 56`, `fill $bg-01`,
 * `stroke $border-01` at `strokeWidth {bottom: 1}` inner, `gap 14`,
 * `padding [0, 26]`, `alignItems center`. Children in order: Mark (22×22,
 * `$text-01`, `$radius-md`), the fixed word mark "GoAssay.AI" (mono 15/600,
 * `$text-01`), the left slot (sans 13.5, `$text-03`, `fill_container`), the
 * right slot (mono 12.5, `$text-03`) and an Avatar instance (indigo,
 * initials "MT" in all five).
 *
 * The Mark is a plain filled square in the design — no glyph inside it — so it
 * is a decorative div here, exactly as `top-bar.tsx` and `public-top-bar.tsx`
 * already render the same node.
 */

export interface MinimalBarProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * Left slot, verbatim from the screen's own bar copy — e.g.
   * "Provider view · provider.example". Grows to fill and truncates.
   */
  context: string;
  /**
   * Right slot, verbatim from the screen's own bar copy — e.g.
   * "as of 12:41 UTC", "step 2 of 4", "612 in the last 24h".
   */
  status?: string;
  /** Seeds the avatar's initials and its accessible name. */
  avatarName?: string;
  /** Overrides the initials derived from `avatarName`. The design shows "MT". */
  avatarInitials?: string;
  avatarSrc?: string;
  /** The design fills the Avatar `$indigo-500` on every copy. */
  avatarColor?: AvatarColor;
}

const MinimalBar = React.forwardRef<HTMLElement, MinimalBarProps>(
  (
    {
      className,
      context,
      status,
      avatarName = "",
      avatarInitials,
      avatarSrc,
      avatarColor = "indigo",
      ...props
    },
    ref
  ) => {
    return (
      <header
        ref={ref}
        className={cn(
          "flex h-14 w-full items-center gap-3.5 border-b border-01 bg-01 px-[26px]",
          className
        )}
        {...props}
      >
        <img src="/images/logo.png" alt="" aria-hidden="true" className="h-[22px] w-[22px] shrink-0 rounded-md object-cover" />
        <span className="shrink-0 text-mono-sm font-mono font-semibold text-01">GoAssay.AI</span>

        <span className="min-w-0 flex-1 truncate font-sans text-body-13 text-03">{context}</span>

        {status ? (
          <span className="shrink-0 whitespace-nowrap font-mono text-mono-12 text-03">{status}</span>
        ) : null}

        <Avatar name={avatarName} initials={avatarInitials} src={avatarSrc} color={avatarColor} size="md" />
      </header>
    );
  }
);
MinimalBar.displayName = "MinimalBar";

export { MinimalBar };
