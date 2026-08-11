import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { OfflineReady } from "./components/OfflineReady";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

/**
 * viewportFit "cover" is not cosmetic here.
 *
 * The bottom nav and the save button already reserve space with
 * env(safe-area-inset-bottom), and without this that value is zero, so on any
 * phone with a home indicator the primary action sits underneath it. The one
 * button this app exists for was the hardest one to press.
 */
export const viewport: Viewport = {
  themeColor: "#01030a",
  colorScheme: "dark",
  // viewport-fit rides along inside width on purpose.
  //
  // The framework builds this meta by joining a fixed list of fields, and that
  // list has no entry for viewportFit (see vinext/dist/shims/metadata.js). It
  // also emits a default viewport meta when the fields are absent, so rendering
  // a second tag leaves two competing ones. width is interpolated raw, the
  // viewport meta is an unordered comma separated list, and this produces
  // exactly one correct tag.
  width: "device-width, viewport-fit=cover",
  initialScale: 1,
};

export function generateMetadata(): Metadata {
  return {
    title: "FightIQ. Train with direction.",
    description: "FightIQ learns your game and tells you what to work on next.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icon-192.png" },
    // Installable, so it opens from the home screen rather than as a tab that a
    // phone can evict while somebody is halfway through a note.
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "FightIQ", statusBarStyle: "black-translucent" },
    openGraph: { title: "FightIQ", description: "Train with direction." },
    twitter: { card: "summary", title: "FightIQ", description: "Train with direction." },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}<OfflineReady /></body>
    </html>
  );
}
