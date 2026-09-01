import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
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
    "Maderera líder en Mar del Plata desde 1981. Techos, placas, pisos, molduras Moldava, ferretería, decks, construcción en seco y más. Presupuestos sin cargo. Dos sucursales: Casa Central y Aserradero.",
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
  metadataBase: new URL("https://mjbj.ar"),
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: "https://mjbj.ar",
    siteName: "Maderera Juan B. Justo",
    title: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
    description:
      "Más de 40 años proveyendo madera de calidad. Techos, placas, pisos, molduras, ferretería y más. Presupuestos sin cargo.",
    // La imagen la genera `app/opengraph-image.tsx`: Next la resuelve sola y
    // declararla acá a mano la pisaría con el favicon.
  },
  twitter: {
    card: "summary_large_image",
    title: "Maderera Juan B. Justo | Desde 1981 en Mar del Plata",
    description: "Más de 40 años proveyendo madera de calidad en Mar del Plata. Presupuestos sin cargo.",
  },
  robots: { index: true, follow: true },
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
      lang="es"
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
