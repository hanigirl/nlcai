import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "sonner";
import { HookGenerationProvider } from "@/components/hook-generation-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin", "hebrew"],
});

export const metadata: Metadata = {
  title: "Content AI",
  description: "יצירת תוכן ברמה הבאה עם AI",
  // Paired with translate="no" below — see the comment on <html>. Chrome
  // reads the attribute, older Edge builds only read this meta tag, so both
  // are here on purpose.
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // lang was "en" while every word rendered is Hebrew, so Chrome and Edge read
  // the app as an English page full of foreign text and offered — or on some
  // Windows/Edge setups just ran — a translation. The translator rewrites text
  // nodes underneath React, React can no longer find the nodes it is holding,
  // and the page dies with "Failed to execute 'removeChild' on 'Node'". That
  // was 42 crashes from one student in 24h on 2026-09-01, all Edge/Windows,
  // and it is what put the "אויש.. לעזאזל" screen in front of her.
  //
  // lang="he" is the honest declaration; translate="no" is what actually stops
  // it, since a correct lang alone makes an English-locale browser MORE eager
  // to offer the translation, not less. The app is Hebrew-only — translating
  // its UI was never a supported thing to do.
  return (
    <html lang="he" translate="no" suppressHydrationWarning>
      <body className={`${rubik.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delayDuration={150}>
            <HookGenerationProvider>
              {children}
            </HookGenerationProvider>
          </TooltipProvider>
          <Toaster
            position="bottom-center"
            dir="rtl"
            expand
            gap={10}
            toastOptions={{
              style: {
                background: "#1a1a1a",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                fontSize: "14px",
              },
              className: "silky-toast",
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
