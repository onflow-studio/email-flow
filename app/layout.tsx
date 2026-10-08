import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { RESTORE_PANES } from "@/components/mail/panes";
import { Radio } from "@/components/radio";

import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "email-flow",
  description: "Personal mail client",
  applicationName: "email-flow",
  appleWebApp: { capable: true, title: "email-flow", statusBarStyle: "black" },
};

// themeColor is DESIGN.md --bg; metadata cannot read CSS variables.
export const viewport: Viewport = {
  themeColor: "#030507",
  colorScheme: "dark",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script sets stored pane widths on <html> before hydration.
    <html lang="en" className={`dark ${jetbrainsMono.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: RESTORE_PANES }} />
      </head>
      <body className="flex min-h-full flex-col">
        {children}
        <Radio />
      </body>
    </html>
  );
}
