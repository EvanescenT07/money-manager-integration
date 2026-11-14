import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MM-AutoSync | Telemetry & AutoSync Console",
  description:
    "Telemetry console for Money Manager auto-sync pipeline via Gemini AI, Telegram, and MacroDroid.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#090B0E",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html
      lang="id"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}
    >
      <body className="min-h-dvh bg-[#090B0E] font-sans text-[#F1F5F9] antialiased selection:bg-[#10B981]/30 selection:text-[#F1F5F9]">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:border-[#34D399] focus:bg-[#11151B] focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-[#F1F5F9]"
        >
          Langsung ke konten utama
        </a>
        {children}
      </body>
    </html>
  );
}
