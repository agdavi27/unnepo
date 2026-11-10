import { redirect } from "next/navigation";

// The applications list moved into the extension's dashboard.
export default function Page() {
  redirect("/home");
}
