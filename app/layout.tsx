import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { sitioIndexable, urlSitio } from "@/lib/seo";
import { masDeAnios } from "@/lib/empresa";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
    template: "%s | Maderera Juan B. Justo",
  },
  description:
    "Maderera en Mar del Plata desde 1981: techos, placas, pisos, molduras Moldava, ferretería, decks y construcción en seco. Presupuestos sin cargo. Casa Central y Aserradero.",
  keywords: [
    "maderera mar del plata",
    "madera mar del plata",
    "maderera juan b justo",
    "placas melamina mar del plata",
    "molduras moldava",
    "tirantes pino",
    "machimbre",
    "fenólicos",
    "construcción en seco",
    "decks mar del plata",
    "presupuesto madera",
  ],
  authors: [{ name: "Maderera Juan B. Justo" }],
  creator: "Maderera Juan B. Justo",
  /*
   * Sale de `urlSitio()` y no de una constante.
   *
   * Estaba fijo en `https://mjbj.ar`, que es el dominio al que el sitio va a
   * mudarse pero que todavía no está publicado. Mientras tanto, todo lo que
   * Next resuelve contra esta base —la tarjeta de vista previa al compartir el
   * enlace por WhatsApp, la URL canónica, la imagen de OpenGraph— apuntaba a un
   * dominio que no contesta. `lib/seo.ts` ya resolvía esto bien para el sitemap
   * y el marcado; acá quedaba la última copia escrita a mano.
   */
  metadataBase: new URL(urlSitio()),
  /*
   * **Sin canónica acá.** Estaba `alternates: { canonical: "/" }`, y Next la
   * hereda en toda página que no declare la suya: `/corte` y `/stock` le
   * decían a Google que eran copias de la portada. Cada página declara la suya
   * con `metadatosDePagina()` (`lib/seo.ts`); la de la portada está en su
   * página.
   */
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: urlSitio(),
    siteName: "Maderera Juan B. Justo",
    title: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
    description:
      `${masDeAnios()} proveyendo madera de calidad. Techos, placas, pisos, molduras, ferretería y más. Presupuestos sin cargo.`,
    // La imagen la genera `app/opengraph-image.tsx`: Next la resuelve sola y
    // declararla acá a mano la pisaría con el favicon.
  },
  twitter: {
    card: "summary_large_image",
    title: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
    description: `${masDeAnios()} proveyendo madera de calidad en Mar del Plata. Presupuestos sin cargo.`,
  },
  // Fuera de producción, `noindex` también en cada página y no solo en
  // `robots.txt`: una vista previa enlazada desde algún lado igual puede
  // terminar en el índice si solo se le prohíbe el rastreo.
  robots: sitioIndexable()
    ? { index: true, follow: true, "max-image-preview": "large" }
    : { index: false, follow: false },
  icons: { icon: "/cropped-icon-180x180.png", apple: "/cropped-icon-180x180.png" },
};

/**
 * Aplica el tema guardado antes del primer pintado.
 *
 * Va como script bloqueante en el `<head>` y no en un efecto de React a
 * propósito: un efecto corre después de que el navegador ya dibujó, así que
 * quien eligió modo oscuro veía un destello blanco en cada navegación. Es la
 * única excepción a "nada de scripts inline", y la paga bien.
 */
const APLICAR_TEMA = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es-AR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: APLICAR_TEMA }} />
      </head>
      <body className="min-h-full flex flex-col overflow-x-hidden">
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </body>
    </html>
  );
}
