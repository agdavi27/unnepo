import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "@/components/auth/auth-forms";
import { oauthReady } from "@/lib/services/oauth";

export default async function Page() {
  // Whether Google sign-in is set up is read on each request, so adding its keys needs no rebuild.
  await connection();
  return (
    <Suspense>
      <LoginForm google={oauthReady().google} />
    </Suspense>
  );
}
