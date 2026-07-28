import { redirect } from "next/navigation";

export default function LeadsIndex() {
  // The daily list is the landing view; /leads/companies stays available as
  // the "explore the whole database" tab.
  redirect("/leads/today");
}
