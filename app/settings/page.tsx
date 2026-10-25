import { Suspense } from "react";
import { Shell } from "@/components/product/shell";
import { SettingsView } from "@/components/product/settings-view";

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; error?: string }> }) {
  const params = await searchParams;
  return (
    <Shell>
      <Suspense>
        <SettingsView initialTab={params.tab || "profile"} initialMessage={params.error || ""} />
      </Suspense>
    </Shell>
  );
}
