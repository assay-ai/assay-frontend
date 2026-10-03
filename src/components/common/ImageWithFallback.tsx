"use client";

import { cn } from "@/utils";
import { ImageProps } from "next/image";

import Image from "next/image";
import { useState } from "react";

const ImageWithFallback = ({ src, alt, className, ...props }: ImageProps) => {
  const [error, setError] = useState(false);
  return (
    <div
      className={cn(
        "flex justify-center items-center text-xl rounded-lg bg-shades-L5 overflow-hidden w-12 h-12",
        className
      )}
      {...props}
    >
      {!error && src ? (
        <Image
          src={(src as any) || null}
          alt="Logo"
          width={48}
          height={48}
          className="object-contain w-full h-full"
          onError={() => setError(true)}
          {...props}
        />
      ) : (
        <div
          className={cn(
            "w-full h-full bg-[#14B8A6] flex items-center justify-center font-medium",
            className
          )}
        >
          {alt}
        </div>
      )}
    </div>
  );
};

export default ImageWithFallback;
