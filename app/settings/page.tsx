import { Suspense } from "react";
import { Shell } from "@/components/product/shell";
import { SettingsView } from "@/components/product/settings-view";

export default function Page() {
  return (
    <Shell>
      <Suspense>
        <SettingsView />
      </Suspense>
    </Shell>
  );
}
