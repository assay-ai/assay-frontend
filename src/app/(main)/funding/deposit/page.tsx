import { redirect } from "next/navigation";

/** Old address, kept as a deep link: this now happens in a drawer on Funding. */
export default function DepositPage() {
  redirect("/funding?action=deposit");
}
