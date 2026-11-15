import type { Metadata } from "next";
import { InstallExtension } from "@/components/extension/install";
import { CHROME_STORE_URL } from "@/lib/config";

export const metadata: Metadata = { title: "Get the extension · Unnepo" };

export default function Page() {
  return <InstallExtension storeUrl={CHROME_STORE_URL} />;
}
