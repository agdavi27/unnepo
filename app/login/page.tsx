import { Suspense } from "react";
import { LoginForm } from "@/components/auth/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
