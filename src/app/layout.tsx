import type { Metadata } from "next";
import { Geist, Geist_Mono, Cormorant_Garamond } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Providers } from "@/components/providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "DreamWeaver — Your dreams, kept",
  description:
    "DreamWeaver turns fleeting dreams into persistent, evolving worlds you can return to. Capture, reflect, discover patterns, and re-enter your dreams as interactive experiences.",
  keywords: [
    "DreamWeaver",
    "dream journal",
    "AI dream analysis",
    "dream patterns",
    "interactive dream",
    "Gemini",
  ],
  authors: [{ name: "DreamWeaver" }],
  openGraph: {
    title: "DreamWeaver — Your dreams, kept",
    description:
      "Turn fleeting dreams into persistent, evolving worlds you can return to.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} antialiased font-body`}
      >
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
