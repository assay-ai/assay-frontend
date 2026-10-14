"use client";

import { useTheme } from "@/providers/ThemeProvider";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { themeType } = useTheme();

  return (
    <Sonner
      theme={themeType}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-shades-L90 group-[.toaster]:text-pallete-950 group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-03",
          actionButton:
            "group-[.toast]:bg-primary-400 group-[.toast]:text-on-primary",
          cancelButton:
            "group-[.toast]:bg-03 group-[.toast]:text-03",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
