import { Suspense } from "react";
import { SignupForm } from "@/components/auth/auth-forms";
import { oauthReady } from "@/lib/services/oauth";

export default function Page() {
  const ready = oauthReady();
  return (
    <Suspense>
      <SignupForm google={ready.google} microsoft={ready.microsoft} />
    </Suspense>
  );
}
