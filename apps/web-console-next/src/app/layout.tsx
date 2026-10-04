import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Lora, IBM_Plex_Mono } from "next/font/google";
import "../styles/globals.css";
import { Providers } from "./providers";
import { CONSOLE_TITLE, PRODUCT_DESCRIPTION, PRODUCT_NAME } from "@/lib/app-config";

export const metadata: Metadata = {
  title: CONSOLE_TITLE,
  description: PRODUCT_DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: PRODUCT_NAME,
    statusBarStyle: "black-translucent",
  },
};

// `viewport-fit=cover` enables `env(safe-area-inset-*)` on notched devices;
// theme-color tints the mobile browser chrome to match light/dark surfaces.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F2" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

// The whole console is session-authenticated and renders nothing of value
// statically — the root Providers tree (SessionProvider, theme, CommandPalette)
// is fully client-only and trips Next.js 15's static export with
// `TypeError: Cannot read properties of undefined (reading 'url')` inside
// useMemo on every route including /_not-found. Opt the entire app out of
// static prerender at the root; per-route fixes don't help because the
// failing code paths live in the layout's Providers.
export const dynamic = "force-dynamic";

// The design canvas's type: Hanken Grotesk for text, Lora for display headings,
// IBM Plex Mono for ids and code. Self-hosted by next/font at build time.
const hanken = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-hanken", display: "swap" });
const lora = Lora({ subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"], variable: "--font-lora", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${hanken.variable} ${lora.variable} ${plexMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/*
          esbuild's `keepNames` helper (`__name`) is referenced by the
          next-themes inline theme script in the @opennextjs/cloudflare build,
          but it isn't defined in the browser — so without this shim every page
          throws `ReferenceError: __name is not defined` and crashes before
          hydration. Define a no-op (returning the target) ahead of that script.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: "globalThis.__name=globalThis.__name||function(t){return t};",
          }}
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
