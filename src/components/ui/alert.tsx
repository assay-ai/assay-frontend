import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import {
  AlertFill,
  CheckCircle,
  CloseLine,
  WarningFill,
} from "@/components/icons";
import { cn } from "@/utils";

const alertVariants = cva(
  "relative flex gap-3 w-full rounded-xl border px-4 py-3",
  {
    variants: {
      variant: {
        neutral:
          "bg-03 text-01 border-transparent",
        success:
          "bg-success-10 text-01 border-transparent",
        danger:
          "bg-danger-10 text-01 border-transparent",
        warning:
          "bg-warning-10 text-01 border-transparent",
        info: "bg-info-10 text-01 border-transparent",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

// Icon mapping for each variant
const variantIcons = {
  neutral: <AlertFill />,
  success: <CheckCircle />,
  danger: <AlertFill />,
  warning: <WarningFill />,
  info: <WarningFill />,
} as const;

// Icon colors for each variant
const variantIconColors = {
  default: "text-02",
  neutral: "text-02",
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  info: "text-info",
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  onClose?: () => void;
  showClose?: boolean;
  showIcon?: boolean;
}

const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  (
    {
      className,
      variant = "neutral",
      title,
      description,
      actions,
      onClose,
      showClose = true,
      showIcon = true,
      children,
      ...props
    },
    ref
  ) => {
    const [isVisible, setIsVisible] = React.useState(true);
    const iconColor = variantIconColors[variant || "neutral"];
    const icon = variantIcons[variant || "neutral"];

    const handleClose = () => {
      setIsVisible(false);
      onClose?.();
    };

    if (!isVisible) {
      return null;
    }

    return (
      <div
        ref={ref}
        role="alert"
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {/* Icon */}
        {showIcon && (
          <div
            className={cn(
              "flex h-5 w-5 items-center justify-center mt-0.5 flex-shrink-0",
              iconColor
            )}
          >
            {icon}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {title && (
            <AlertTitle className="mb-1 font-medium leading-none tracking-tight text-01">
              {title}
            </AlertTitle>
          )}
          {description && (
            <AlertDescription className="text-sm text-overlay leading-relaxed">
              {description}
            </AlertDescription>
          )}
          {children}
          {actions && (
            <AlertActions className="flex gap-2 mt-4">{actions}</AlertActions>
          )}
        </div>

        {/* Close Button */}
        {showClose && (
          <AlertClose
            onClick={handleClose}
            className="absolute top-3 right-3 rounded-sm opacity-70 hover:opacity-100 transition-opacity p-1 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-primary-500 cursor-pointer"
          >
            <CloseLine className="h-4 w-4 text-overlay" />
            <span className="sr-only">Close</span>
          </AlertClose>
        )}
      </div>
    );
  }
);
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn(className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

const AlertActions = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props} />
));
AlertActions.displayName = "AlertActions";

const AlertClose = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>(({ className, ...props }, ref) => (
  <button ref={ref} className={cn(className)} {...props} />
));
AlertClose.displayName = "AlertClose";

export { Alert, AlertActions, AlertClose, AlertDescription, AlertTitle };
