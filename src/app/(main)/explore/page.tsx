import { redirect } from "next/navigation";

/** Explore has two tabs; Providers is the one the design shows selected. */
export default function ExplorePage() {
  redirect("/explore/providers");
}
