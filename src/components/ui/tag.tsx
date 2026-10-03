import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/utils";
import { CloseLine } from "../icons";

const tagVariants = cva(
  "inline-flex items-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "",
        secondary: "",
      },
      type: {
        tonal: "",
        outline: "border",
      },
      state: {
        default: "",
        selected: "",
        disabled: "disabled:opacity-40",
      },
      size: {
        sm: "gap-1 px-3 py-1.5 text-xs",
        md: "gap-1 px-4 py-2 text-sm h-9",
      },
    },
    compoundVariants: [
      // Primary Tonal variants
      {
        variant: "primary",
        type: "tonal",
        state: "default",
        className:
          "bg-success-20 text-success hover:bg-success-10 active:bg-success-20",
      },
      {
        variant: "primary",
        type: "tonal",
        state: "selected",
        className: "bg-success text-on-color",
      },
      {
        variant: "primary",
        type: "tonal",
        state: "disabled",
        className: "bg-success-20 text-success opacity-40",
      },
      // Primary Outline variants
      {
        variant: "primary",
        type: "outline",
        state: "default",
        className:
          "border-success-20 text-success hover:bg-success-10 active:bg-success-20",
      },
      {
        variant: "primary",
        type: "outline",
        state: "selected",
        className: "border-success bg-success text-on-color",
      },
      {
        variant: "primary",
        type: "outline",
        state: "disabled",
        className: "border-success-20 text-success opacity-40",
      },
      // Secondary Tonal variants
      {
        variant: "secondary",
        type: "tonal",
        state: "default",
        className:
          "bg-02 text-02 hover:bg-02 active:bg-02",
      },
      {
        variant: "secondary",
        type: "tonal",
        state: "selected",
        className: "bg-03 text-inverse",
      },
      {
        variant: "secondary",
        type: "tonal",
        state: "disabled",
        className: "bg-secondary-20 text-02 opacity-40",
      },
      // Secondary Outline variants
      {
        variant: "secondary",
        type: "outline",
        state: "default",
        className: "border-02 bg-02 hover:bg-02",
      },
      {
        variant: "secondary",
        type: "outline",
        state: "selected",
        className: "border-secondary bg-03 text-inverse",
      },
      {
        variant: "secondary",
        type: "outline",
        state: "disabled",
        className: "border-02 text-02 opacity-40",
      },
    ],
    defaultVariants: {
      variant: "primary",
      type: "tonal",
      state: "default",
      size: "md",
    },
  }
);

export interface TagProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof tagVariants> {
  children?: React.ReactNode;
  icon?: React.ReactNode;
  dismissible?: boolean;
  onDismiss?: () => void;
  selected?: boolean;
  disabled?: boolean;
}

const Tag = React.forwardRef<HTMLDivElement, TagProps>(
  (
    {
      className,
      variant,
      type,
      state: stateProp,
      size,
      children,
      icon,
      dismissible,
      onDismiss,
      selected,
      disabled,
      onClick,
      ...props
    },
    ref
  ) => {
    // Determine the current state
    const currentState = React.useMemo(() => {
      if (disabled) return "disabled";
      if (selected) return "selected";
      if (stateProp) return stateProp;
      return "default";
    }, [disabled, selected, stateProp]);

    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!disabled && onClick) {
        onClick(event);
      }
    };

    const handleDismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!disabled && onDismiss) {
        onDismiss();
      }
    };

    // Render content based on configuration
    const renderContent = () => {
      const hasIcon = !!icon;
      const hasText = !!children;
      const hasDismiss = dismissible;

      // Icon only
      if (hasIcon && !hasText && !hasDismiss) {
        return (
          <div className="flex items-center justify-center p-0.5">{icon}</div>
        );
      }

      // Text only
      if (!hasIcon && hasText && !hasDismiss) {
        return children;
      }

      // Icon leading
      if (hasIcon && hasText && !hasDismiss) {
        return (
          <>
            <div className="flex items-center justify-center p-0.5">{icon}</div>
            {children}
          </>
        );
      }

      // Icon dismiss (text + dismiss)
      if (!hasIcon && hasText && hasDismiss) {
        return (
          <>
            {children}
            <button
              type="button"
              onClick={handleDismiss}
              className="flex items-center justify-center p-0.5 rounded-sm hover:bg-black/10 transition-colors"
              disabled={disabled}
            >
              <CloseLine className="h-3 w-3" />
            </button>
          </>
        );
      }

      // Icon leading dismiss (icon + text + dismiss)
      if (hasIcon && hasText && hasDismiss) {
        return (
          <>
            <div className="flex items-center justify-center p-0.5">{icon}</div>
            {children}
            <button
              type="button"
              onClick={handleDismiss}
              className="flex items-center justify-center p-0.5 rounded-sm hover:bg-black/10 transition-colors"
              disabled={disabled}
            >
              <CloseLine className="h-3 w-3" />
            </button>
          </>
        );
      }

      // Default: just children
      return children;
    };

    return (
      <div
        className={cn(
          tagVariants({ variant, type, state: currentState, size }),
          onClick && !disabled && "cursor-pointer",
          className
        )}
        ref={ref}
        onClick={handleClick}
        {...props}
      >
        {renderContent()}
      </div>
    );
  }
);
Tag.displayName = "Tag";

export { Tag, tagVariants };
