import type { Metadata, Viewport } from "next";
import { JetBrains_Mono } from "next/font/google";
import { RESTORE_PANES } from "@/components/mail/panes";

import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "superfer",
  description: "Personal mail client",
  applicationName: "superfer",
  appleWebApp: { capable: true, title: "superfer", statusBarStyle: "black" },
};

// themeColor is DESIGN.md --bg; metadata cannot read CSS variables.
export const viewport: Viewport = {
  themeColor: "#0A0E12",
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
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
