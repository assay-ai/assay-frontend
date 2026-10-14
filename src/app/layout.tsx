import "@/styles/index.scss";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { Chain } from "@/interfaces/chain";
import { THEME_STORAGE_KEY } from "@/providers/theme-storage";

import { Providers } from "../providers";

/**
 * `GET /chains`, fetched on the SERVER so `Providers` has it on the first
 * render.
 *
 * Privy reads `supportedChains` once when it mounts and an eip155 chain
 * missing from it makes the embedded wallet open no prompt at all — no modal,
 * no error, measured on the deposit screen. A client-side fetch is therefore
 * too late, and a `NEXT_PUBLIC_*` value would freeze the list at build time.
 *
 * `no-store`: the enabled chain list is a deployment fact that changes with a
 * configuration edit, and a cached list is one a page would render a chain from
 * after the API stopped offering it.
 *
 * Failure is an EMPTY LIST, never a thrown layout: the API being unreachable
 * must not take the login screen down with it. EVM signing then refuses by
 * name, which is what every other absent-chain path already does.
 */
async function fetchChains(): Promise<readonly Chain[]> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) return [];
  try {
    const response = await fetch(`${base}/chains`, { cache: "no-store" });
    if (!response.ok) return [];
    const body = (await response.json()) as { data?: { chains?: Chain[] } };
    return body?.data?.chains ?? [];
  } catch {
    return [];
  }
}

// Inter, as on the landing page, so the two read as one product.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
});

// Brand and wording follow the landing page (assay-landing-page/src/pages.mjs),
// so a shared link reads the same wherever it points.
const TITLE = "Assay — The credit layer for agentic payments";
const DESCRIPTION =
  "The credit layer for agentic payments. Assay measures what every paid endpoint actually delivers — then bonds it, so agents get recourse when it doesn’t.";
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL;

export const metadata: Metadata = {
  ...(BASE_URL ? { metadataBase: new URL(BASE_URL) } : {}),
  title: { default: TITLE, template: "%s — Assay" },
  description: DESCRIPTION,
  applicationName: "Assay",
  authors: [{ name: "Assay" }],
  keywords: ["Assay", "agentic payments", "AI agents", "x402", "delivery guarantee", "bonded endpoints", "USDC"],
  robots: { index: true, follow: true },
  icons: { icon: "/images/favicon.png", apple: "/images/apple-touch-icon.png" },
  openGraph: {
    type: "website",
    siteName: "Assay",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [{ url: "/thumbnail.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/thumbnail.png"],
  },
  other: { version: process.env.buildId || "unknown" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1c180d" },
  ],
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const chains = await fetchChains();
  // next/font's `variable` classes must sit on <html>, not <body>. theme.scss
  // composes --font-sans and --font-mono on :root, and a custom property whose
  // var() reference is undefined at that level becomes invalid at
  // computed-value time — it resolves to nothing. With the classes on <body>,
  // --font-mono was empty everywhere and every mono figure in the product
  // silently rendered in the sans face.
  return (
    <html
      lang="en"
      data-theme="light"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      // The pre-paint script below may change data-theme before hydration.
      suppressHydrationWarning
    >
      <head>
        {/*
          Pre-paint theme. The choice lives in localStorage (see ThemeProvider)
          and React cannot read it until after hydration, so without this the
          first paint of every navigation would use the wrong theme. A stored
          choice wins; otherwise the system setting decides.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <Providers chains={chains}>{children}</Providers>
      </body>
    </html>
  );
}
