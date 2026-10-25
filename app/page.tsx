import { Suspense } from "react";
import { Landing } from "@/components/marketing/landing";

export default function Page() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  );
}
