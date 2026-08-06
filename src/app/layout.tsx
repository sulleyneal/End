import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * No web font: the system stack renders instantly, matches the device the
 * player is holding, and keeps the app feeling like an app (house rule 7).
 */

export const metadata: Metadata = {
  title: "AI Dungeon Master",
  description: "A multiplayer D&D 5e table with an AI DM. The app is the referee.",
  // The manifest is what lets iOS add this to the Home Screen, which is in turn
  // the only way Safari will deliver a push notification.
  //
  // The Home Screen icon itself does *not* come from the manifest — Safari
  // ignores `icons` there and reads `apple-touch-icon`, falling back to a
  // screenshot of the page when it is missing. That tag comes from
  // `app/apple-icon.png`, and `app/icon.png` and `app/favicon.ico` cover the
  // tab, so there is nothing to declare here; setting `icons` would override
  // the file convention rather than add to it. Re-render all of them with
  // `node scripts/make-icons.mjs`.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "The Table", statusBarStyle: "default" },
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
