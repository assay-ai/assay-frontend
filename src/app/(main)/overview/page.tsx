import { redirect } from "next/navigation";

/**
 * The shared Top Bar links "Overview" at `/overview`, but the buyer home lives at `/`. Rather
 * than edit the shared nav, `/overview` sends you to the one screen. One of
 * the two should eventually go.
 */
export default function OverviewRedirect(): never {
  redirect("/");
}
