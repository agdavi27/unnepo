import type { Metadata } from "next";
import { ConnectExtension } from "@/components/extension/connect";

export const metadata: Metadata = { title: "Connect the extension · Unnepo" };

export default function Page() {
  return <ConnectExtension />;
}
