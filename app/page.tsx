import { Suspense } from "react";
import { Landing } from "@/components/marketing/landing";
import { oauthReady } from "@/lib/services/oauth";

export default function Page() {
  const ready = oauthReady();
  return (
    <Suspense>
      <Landing google={ready.google} microsoft={ready.microsoft} />
    </Suspense>
  );
}
