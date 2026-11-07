import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Satoshi for display headings, Poppins for body (both self-hosted, same files as the app).
const satoshi = localFont({ src: "./fonts/Satoshi-Variable.woff2", weight: "300 900", variable: "--font-satoshi", display: "swap" });
const poppins = localFont({
  src: [
    { path: "./fonts/poppins-400.woff2", weight: "400" },
    { path: "./fonts/poppins-500.woff2", weight: "500" },
    { path: "./fonts/poppins-600.woff2", weight: "600" },
  ],
  variable: "--font-poppins",
  display: "swap",
});

const TITLE = "Showit AI: Mobile-ready Showit sites";
const DESC =
  "A Windows helper that checks the mobile layout of your Showit site and fixes small text, spills and crowding inside the Showit editor. Desktop is never touched, and every change can be undone.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  openGraph: { title: TITLE, description: DESC, siteName: "Showit AI", type: "website", images: ["/shots/tour.jpg"] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/shots/tour.jpg"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${satoshi.variable} ${poppins.variable}`}>
      <body>{children}</body>
    </html>
  );
}
