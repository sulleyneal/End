import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * No web font: the system stack renders instantly, matches the device the
 * player is holding, and keeps the app feeling like an app (house rule 7).
 */

export const metadata: Metadata = {
  title: "AI Dungeon Master",
  description: "A multiplayer D&D 5e table with an AI DM. The app is the referee.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0f" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
