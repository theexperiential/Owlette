import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Footer } from "@/components/Footer";
import { validateEnvironmentOrThrow } from "@/lib/validateEnv";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Owlette - Always Watching",
  description: "Remote fleet management and deployment monitoring - Always Watching your systems",
  icons: {
    icon: '/owlette-icon.png',
    shortcut: '/owlette-icon.png',
    apple: '/owlette-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Validate Firebase environment variables
  // In development: logs warnings
  // In production: throws error if misconfigured
  // TEMPORARILY DISABLED for initial Railway deployment
  // validateEnvironmentOrThrow();

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          <AuthProvider>
            {children}
            <Footer />
            <Toaster />
          </AuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
