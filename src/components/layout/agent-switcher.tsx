"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/utils";

/**
 * Agent Switcher.
 *
 * The design only draws the CLOSED trigger: a status dot, a mono
 * environment label ("prod"), and a chevron. There is no dropdown-open
 * state and no menu content anywhere in the design — the option list below
 * (prod / staging / development, with the same dot-plus-mono-label
 * vocabulary the trigger already uses) is this component's own invention
 * so the control supports keyboard navigation. It is an assumption, not a
 * design fact.
 *
 * Built on @radix-ui/react-dropdown-menu, which supplies correct roving-
 * focus keyboard navigation (Arrow/Home/End/typeahead/Escape) and ARIA
 * (role="menu", aria-expanded, aria-activedescendant-equivalent) for free.
 */

export type AgentEnvironmentStatus = "success" | "warning" | "danger" | "neutral";

export interface AgentEnvironment {
  id: string;
  label: string;
  /** Colors the status dot. Default "neutral". */
  status?: AgentEnvironmentStatus;
}

const STATUS_DOT_CLASS: Record<AgentEnvironmentStatus, string> = {
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  neutral: "bg-04",
};

const DEFAULT_ENVIRONMENTS: AgentEnvironment[] = [
  { id: "prod", label: "prod", status: "success" },
  { id: "staging", label: "staging", status: "warning" },
  { id: "development", label: "development", status: "neutral" },
];

export interface AgentSwitcherProps {
  /** Available environments. Defaults to prod / staging / development. */
  environments?: AgentEnvironment[];
  /** Currently selected environment id. */
  value: string;
  onValueChange?: (id: string) => void;
  className?: string;
}

const AgentSwitcher = React.forwardRef<HTMLButtonElement, AgentSwitcherProps>(
  ({ environments = DEFAULT_ENVIRONMENTS, value, onValueChange, className }, ref) => {
    const current = environments.find((env) => env.id === value) ?? environments[0];

    return (
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            ref={ref}
            type="button"
            aria-label={`Switch environment, currently ${current?.label ?? value}`}
            className={cn(
              "group inline-flex items-center gap-[7px] rounded-md border border-01 bg-02 px-2.5 py-1.5",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary-500",
              "data-[state=open]:bg-03",
              className
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                STATUS_DOT_CLASS[current?.status ?? "neutral"]
              )}
              aria-hidden="true"
            />
            <span className="text-mono-13 font-mono leading-none text-01">
              {current?.label ?? value}
            </span>
            <ChevronDown className="h-[13px] w-[13px] text-03 transition-transform group-data-[state=open]:rotate-180" />
          </button>
        </DropdownMenuPrimitive.Trigger>

        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={6}
            className={cn(
              "z-50 min-w-[176px] overflow-hidden rounded-lg border border-01 bg-01 p-1 shadow-soft",
              "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
              "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
            )}
          >
            {environments.map((env) => {
              const selected = env.id === value;
              return (
                <DropdownMenuPrimitive.Item
                  key={env.id}
                  onSelect={() => onValueChange?.(env.id)}
                  className={cn(
                    "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 outline-none",
                    "text-mono-13 font-mono text-01",
                    "data-[highlighted]:bg-02"
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT_CLASS[env.status ?? "neutral"])}
                    aria-hidden="true"
                  />
                  <span className="flex-1">{env.label}</span>
                  {selected && (
                    <Check strokeWidth={2.5} className="h-3.5 w-3.5 text-primary-500" />
                  )}
                </DropdownMenuPrimitive.Item>
              );
            })}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    );
  }
);
AgentSwitcher.displayName = "AgentSwitcher";

export { AgentSwitcher };
