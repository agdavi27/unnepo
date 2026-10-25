import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";
import { oauthReady } from "@/lib/services/oauth";

export default function Page() {
  const ready = oauthReady();
  return (
    <Suspense>
      <LoginForm google={ready.google} microsoft={ready.microsoft} />
    </Suspense>
  );
}
