import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth/auth-forms";
import { oauthReady } from "@/lib/services/oauth";
import { integrations } from "@/lib/integrations/flags";

export default async function Page() {
  // Whether Google sign-in is set up is read on each request, so adding its keys needs no rebuild.
  await connection();
  return (
    <Suspense>
      <LoginForm google={integrations.googleSignIn && oauthReady().google} />
    </Suspense>
  );
}
