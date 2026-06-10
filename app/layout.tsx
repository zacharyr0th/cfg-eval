import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SiteNav } from "@/components/site-nav";
import { SiteFooter } from "@/components/site-footer";
import { AppShell } from "@/components/app-shell";

// Geist for the whole app; Geist Mono drives `font-mono` (numbers, SQL, code).
const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  // Let content extend under the notch / home indicator so env(safe-area-inset-*)
  // resolves to nonzero and the safe-area padding on the nav + composer applies.
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "CFG Eval · GPT-5 grammar-constrained ClickHouse queries",
  description:
    "Type a natural-language question, get a syntactically-guaranteed ClickHouse query back. GPT-5's Context-Free Grammar feature constrains the output to a Lark-defined SQL subset over the NYC Taxi dataset.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <a href="#main-content" className="skip-link">
            Skip to content
          </a>
          <AppShell>
            <SiteNav />
            <main id="main-content" tabIndex={-1} className="flex min-h-0 flex-1 flex-col focus:outline-none">
              {children}
            </main>
            <SiteFooter />
          </AppShell>
          <Toaster richColors position="top-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}
