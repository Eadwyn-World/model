import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/jetbrains-mono";
import "@eadwyn/ui/styles/tokens.css";
import "@eadwyn/ui/styles/base.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eadwyn AI Model · An open, federated mind",
  description:
    "A digital mind grown by everyone. Open weights, code and training recipes; nodes learn locally, learning travels, merges are reviewed through governance.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  openGraph: {
    title: "Eadwyn AI Model · An open, federated mind",
    description: "No single center. Nodes learn locally. Learning travels. The mind rebalances.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#060a0e",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
