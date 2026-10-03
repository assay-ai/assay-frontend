import * as React from "react";

import { cn } from "@/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-xl bg-shades-L5 px-3 py-2 text-sm ring-offset-01 placeholder:text-03 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-shades-L10 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm caret-primary",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
