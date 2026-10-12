import { cva, type VariantProps } from "class-variance-authority";
import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Banner, as drawn in the product design.
 *
 * The bench draws exactly four tones — warning (the base instance), danger,
 * teal and primary. It does NOT draw a `success` or `info` tone: the
 * "positive" banner binds to the `$teal` ramp, not `$success`, and the
 * "primary" tone's icon is literally named `info` in the lucide library but
 * is coloured with `$primary-600`, not an info ramp. Tones below are named
 * for the token ramp the design actually binds, not a semantic label.
 *
 * A banner tells; it never blocks and never asks (rule 4). Nothing here is
 * dismissible — the design draws no close affordance on any tone — and any
 * `action` is a single, low-emphasis link-style button, never a form of
 * confirmation.
 */

const toneIconClass: Record<BannerTone, string> = {
  warning: "text-warning-600",
  danger: "text-danger-600",
  teal: "text-teal-600",
  primary: "text-primary-600",
};

const toneIcon: Record<BannerTone, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  warning: TriangleAlert,
  danger: CircleX,
  teal: CircleCheck,
  primary: Info,
};

const bannerVariants = cva(
  "flex w-full items-center gap-3.5 rounded-lg border py-3.5 px-4",
  {
    variants: {
      tone: {
        warning: "bg-warning-10 border-warning-20",
        danger: "bg-danger-10 border-danger-20",
        teal: "bg-teal-10 border-teal-20",
        primary: "bg-primary-10 border-primary-20",
      },
    },
    defaultVariants: {
      tone: "warning",
    },
  }
);

export type BannerTone = "warning" | "danger" | "teal" | "primary";

export interface BannerProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof bannerVariants> {
  /** Required — a banner exists to tell you one thing. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Overrides the tone's default icon. Pass `null` to render no icon. */
  icon?: React.ReactNode | null;
  /**
   * A single low-emphasis action, e.g. `<BannerAction onClick={...}>Renew</BannerAction>`.
   * The design draws at most one action per banner and it never confirms or
   * blocks anything — it navigates or opens somewhere else.
   */
  action?: React.ReactNode;
}

const Banner = React.forwardRef<HTMLDivElement, BannerProps>(
  ({ className, tone = "warning", title, description, icon, action, ...props }, ref) => {
    const resolvedTone = tone ?? "warning";
    const ToneIcon = toneIcon[resolvedTone];

    return (
      <div ref={ref} role="status" className={cn(bannerVariants({ tone }), className)} {...props}>
        {icon !== null && (
          <div className={cn("flex h-[17px] w-[17px] shrink-0 items-center justify-center", toneIconClass[resolvedTone])}>
            {icon ?? <ToneIcon className="h-full w-full" />}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <p className="text-label-sm text-01">{title}</p>
          {description && (
            <p className="text-body-13 text-02 [overflow-wrap:anywhere]">{description}</p>
          )}
        </div>
        {action}
      </div>
    );
  }
);
Banner.displayName = "Banner";

export interface BannerActionProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {}

/**
 * The banner's action is always styled the same neutral way regardless of
 * tone — the design overrides only the label per instance, never the
 * action's own fill/border, so the button itself carries no tone.
 */
const BannerAction = React.forwardRef<HTMLButtonElement, BannerActionProps>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-md border border-02 bg-01 px-3 py-[7px] text-label-13 text-01 transition-colors hover:bg-02 focus-visible:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
);
BannerAction.displayName = "BannerAction";

export { Banner, BannerAction, bannerVariants };
