import type { Metadata } from "next";
import { Inter, Source_Serif_4 } from "next/font/google";

import "./globals.css";

/**
 * Two faces, each with a job.
 *
 * Inter for the application: it was drawn for interfaces at small sizes, and
 * its tabular figures matter on a screen full of token counts and dates.
 *
 * Source Serif for the client document only. The proposal a client reads
 * should not look like a dashboard — see the client view.
 */
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const serif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Koya Talent — Proposals",
  description:
    "Turn discovery-call notes into a client-ready proposal, reviewed and approved before it reaches the client.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
