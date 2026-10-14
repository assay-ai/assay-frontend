"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
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
