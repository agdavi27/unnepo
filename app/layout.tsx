import type { Metadata } from "next";
import { Caveat, Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/config";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"] });
// The landing page's retro dialogue box, name tag, and button only.
const pixel = Press_Start_2P({ variable: "--font-pixel", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  // Makes canonical, Open Graph and share-image URLs absolute.
  metadataBase: new URL(SITE_URL),
  title: "Unnepo — Apply in minutes. Then actually hear back.",
  description: "A free Chrome extension that fills internship and job applications, then finds the right people at each company and writes each one a short, tailored email.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${pixel.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
