import { redirect } from "next/navigation";

/** The calculator now lives on the provider page, next to the terms it depends on. */
export default function CalculatorRedirect(): never {
  redirect("/why-list-here#calculator");
}
