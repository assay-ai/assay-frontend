import "@/styles/index.scss";
import { Inter, JetBrains_Mono } from "next/font/google";
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
        <title>GoAssay.AI</title>
        <link rel="icon" href="/images/favicon.png" sizes="any" />
        <link rel="apple-touch-icon" href="/images/apple-touch-icon.png" />
        <meta name="robots" content="index, follow" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta
          name="description"
          content="GoAssay.AI — verified payments for AI agents. Pay per call, get proof the work was real."
        />
        <meta
          name="image"
          content={`${process.env.NEXT_PUBLIC_BASE_URL}/thumbnail.png`}
        />
        <meta
          name="keywords"
          content="GoAssay.AI, x402, AI agents, verified payments, Solana, USDC"
        />
        <meta name="author" content="GoAssay.AI" />
        <meta property="og:type" content="website" />
        <meta property="og:url" content={process.env.NEXT_PUBLIC_BASE_URL} />
        <meta property="og:title" content="GoAssay.AI" />
        <meta
          property="og:description"
          content="GoAssay.AI — verified payments for AI agents. Pay per call, get proof the work was real."
        />
        <meta
          property="og:image"
          content={`${process.env.NEXT_PUBLIC_BASE_URL}/thumbnail.png`}
        />

        <meta property="twitter:card" content="summary_large_image" />
        <meta
          property="twitter:url"
          content={process.env.NEXT_PUBLIC_BASE_URL}
        />
        <meta property="twitter:title" content="GoAssay.AI" />
        <meta
          property="twitter:description"
          content="GoAssay.AI — verified payments for AI agents. Pay per call, get proof the work was real."
        />
        <meta
          property="twitter:image"
          content={`${process.env.NEXT_PUBLIC_BASE_URL}/thumbnail.png`}
        />
        <meta name="version" content={process.env.buildId || "unknown"} />
      </head>
      <body className={inter.className}>
        <Providers chains={chains}>{children}</Providers>
      </body>
    </html>
  );
}
