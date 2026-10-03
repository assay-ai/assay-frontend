"use client";

import { cn } from "@/utils";
import Image from "next/image";

interface HeaderProps {
  className?: string;
}

export const Header = ({ className }: HeaderProps) => {
  return (
    <header
      className={cn(
        "w-full border-b border-02 flex items-center justify-between px-6 py-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        <Image src="/images/logo.png" alt="logo" width={32} height={32} />
      </div>
    </header>
  );
};

export default Header;
