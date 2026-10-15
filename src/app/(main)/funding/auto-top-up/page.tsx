import { redirect } from "next/navigation";

/** Old address: there is no auto top-up; adding funds happens on Funding. */
export default function AutoTopUpPage() {
  redirect("/funding");
}
