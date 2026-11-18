import { headers } from "next/headers";
import { Landing } from "@/components/marketing/landing";
import { installView } from "@/lib/install-view";

/** The home page. A phone (or Safari/Firefox) can't add the extension, so it gets the "email me the link" form instead of Add to Chrome; decided on the server, so nothing swaps after load. */
export default async function Page() {
  return <Landing view={installView((await headers()).get("user-agent"))} />;
}
