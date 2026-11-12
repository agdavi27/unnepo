import type { Metadata } from "next";
import { InstallExtension } from "@/components/extension/install";
import manifest from "@/extension/manifest.json";

export const metadata: Metadata = { title: "Get the extension · Unnepo" };

export default function Page() {
  return <InstallExtension storeUrl={process.env.NEXT_PUBLIC_CHROME_EXTENSION_URL || null} version={manifest.version_name ?? manifest.version} />;
}
