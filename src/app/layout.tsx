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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
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
