import { Suspense } from "react";
import { ResetForm } from "@/components/auth/auth-forms";

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
