import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import "./marker-cluster.css";
import { LanguageProvider } from "@/lib/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Paketstationen Deutschland — alle Paketabholstellen auf der Karte",
  description: "Interaktive Karte der Paketstationen und Paketshops in Deutschland, Gemeinde für Gemeinde: Deutsche Post / DHL, Hermes, DPD, GLS, UPS, Amazon, FedEx, myflexbox, DeinFach, Mail Boxes Etc. und Nova Post, mit Abdeckung, Dichte und Verlauf. Auf Deutsch, Italienisch und Englisch.",
  openGraph: {
    title: "Paketstationen Deutschland",
    description: "Paketstationen und Paketshops in Deutschland, Gemeinde für Gemeinde, auf einer interaktiven Karte.",
    type: "website",
    locale: "fr_FR",
    alternateLocale: ["it_IT", "en_GB"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Paketstationen",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <LanguageProvider>{children}</LanguageProvider>
        <Analytics />
      </body>
    </html>
  );
}
