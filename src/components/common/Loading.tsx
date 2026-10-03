import { ReactNode } from "react";
import { Loading } from "../icons";

interface CardLoadingProps {
  children: ReactNode;
  isLoading?: boolean;
  className?: string;
}

export const Spinner = ({
  children,
  isLoading = false,
  className = "",
}: CardLoadingProps) => {
  return (
    <div className={`relative ${className}`}>
      {children}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-overlay-light-60 backdrop-blur-[16px] rounded-lg text-02 text-xs flex-col gap-4">
          <Loading className="w-8 h-8 animate-spin text-primary" />
          loading data
        </div>
      )}
    </div>
  );
};
