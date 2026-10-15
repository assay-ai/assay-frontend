import { redirect } from "next/navigation";

/** The tool list moved to `/explore` itself. */
export default function ExploreToolsRedirect(): never {
  redirect("/explore");
}
