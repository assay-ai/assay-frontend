"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Avatar.
 *
 * The design draws exactly one state: a 28px circle, `$indigo-500` fill,
 * white mono initials. Size and color are generalised into variants so the
 * component is usable anywhere an avatar is needed; `md` + `indigo` is the
 * default and reproduces the design node exactly.
 *
 * The design's initials are 11px/600/mono, i.e. `text-mono-xs` with the
 * weight overridden to 600 via `font-semibold` (only weight may be
 * overridden on top of a scale size — never the size or line-height).
 */

const avatarVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full",
  {
    variants: {
      size: {
        xs: "h-5 w-5",
        sm: "h-6 w-6",
        md: "h-7 w-7", // 28px — matches the design node exactly
        lg: "h-8 w-8",
        xl: "h-10 w-10",
      },
      color: {
        primary: "bg-primary-500",
        indigo: "bg-indigo-500", // design default
        pink: "bg-pink-500",
        teal: "bg-teal-500",
        yellow: "bg-yellow-500",
        lime: "bg-lime-500",
        success: "bg-success-500",
        danger: "bg-danger-500",
        warning: "bg-warning-500",
        info: "bg-info-500",
      },
    },
    defaultVariants: {
      size: "md",
      color: "indigo",
    },
  }
);

const initialsTextVariants = cva("font-mono font-semibold uppercase leading-none text-on-color", {
  variants: {
    size: {
      xs: "text-mono-2xs",
      sm: "text-mono-xs",
      md: "text-mono-xs", // exact match to the design's 11px/600/mono
      lg: "text-mono-13",
      xl: "text-mono-md",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

const AVATAR_COLORS = [
  "primary",
  "indigo",
  "pink",
  "teal",
  "yellow",
  "lime",
  "success",
  "danger",
  "warning",
  "info",
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Deterministic initials from a display name — first + last word initial. */
export function getInitials(name: string): string {
  if (!name) return "";
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return words[0]!.charAt(0).toUpperCase();
  return (words[0]!.charAt(0) + words[words.length - 1]!.charAt(0)).toUpperCase();
}

/** Deterministic color from a seed string, so the same identity always renders the same color. */
export function getColorFromString(seed: string): AvatarColor {
  if (!seed) return "indigo";
  const hash = seed.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]!;
}

export interface AvatarProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof avatarVariants> {
  /** Image source. Falls back to initials when absent or on load error. */
  src?: string;
  /** Accessible text for the image; also seeds initials/color when those aren't given explicitly. */
  name?: string;
  /** Overrides the initials computed from `name`. */
  initials?: string;
  /** Overrides the color computed from `name`. */
  color?: AvatarColor;
}

const Avatar = React.forwardRef<HTMLSpanElement, AvatarProps>(
  ({ className, size, color, src, name = "", initials, ...props }, ref) => {
    const [imageError, setImageError] = React.useState(false);
    const resolvedInitials = initials ?? getInitials(name);
    const resolvedColor = color ?? getColorFromString(name || initials || "");
    const showImage = Boolean(src) && !imageError;

    return (
      <span
        ref={ref}
        role="img"
        aria-label={name || undefined}
        className={cn(avatarVariants({ size, color: resolvedColor }), className)}
        {...props}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            /*
              onError alone is not enough. The <img> is server-rendered, so a
              404 fires its error event before React hydrates and attaches the
              handler — the avatar then sits there as a broken-image glyph
              forever. This ref runs on mount and asks the element what already
              happened: a finished load with no intrinsic width is a failure
              that we missed.
            */
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setImageError(true);
            }}
            onError={() => setImageError(true)}
          />
        ) : (
          <span className={cn(initialsTextVariants({ size }))} aria-hidden="true">
            {resolvedInitials || "?"}
          </span>
        )}
      </span>
    );
  }
);
Avatar.displayName = "Avatar";

export { Avatar, avatarVariants };
