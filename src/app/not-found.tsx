import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-16 w-full gap-8 flex-1 h-full">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-display-lg text-01 text-center">
          404 <br />
          Page Not Found
        </h1>
        <p className="text-body-md text-03 text-center max-w-md">
          We couldn't find the page you're looking for. The page may have been
          moved, deleted, or never existed.{" "}
        </p>
      </div>

      <Button asChild>
        <Link href="/">Return to Home</Link>
      </Button>
    </div>
  );
}
