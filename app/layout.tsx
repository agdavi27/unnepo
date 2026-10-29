import type { Metadata } from "next";
import { Caveat, Geist, Geist_Mono, Press_Start_2P } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"] });
// The landing page's retro dialogue box, name tag, and button only.
const pixel = Press_Start_2P({ variable: "--font-pixel", weight: "400", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Unnepo — You pick the jobs. We do the crawling.",
  description: "A Chrome extension that fills job and internship applications for you, then finds the recruiters behind the role. Free for students.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${caveat.variable} ${pixel.variable} h-full antialiased`}>
      <body className="min-h-full bg-bg text-ink">{children}</body>
    </html>
  );
}
