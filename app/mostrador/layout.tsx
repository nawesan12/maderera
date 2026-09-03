import type { Metadata, Viewport } from "next";
import { RegistroDelAyudante } from "@/components/mostrador/registro-sw";

/**
 * El punto de venta se instala como aplicación.
 *
 * El manifiesto se declara **acá y no en el layout raíz**: si estuviera arriba,
 * el sitio público le ofrecería a cualquier cliente instalarse el mostrador.
 */
export const metadata: Metadata = {
  manifest: "/mostrador/app.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mostrador",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/mostrador/apple-touch-180.png",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#b4530f",
  // Sin zoom: en una pantalla táctil de mostrador, el pinch accidental mientras
  // se carga una venta deja la interfaz corrida y hay que arreglarla a mano.
  maximumScale: 1,
  userScalable: false,
};

export default function MostradorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <RegistroDelAyudante />
    </>
  );
}
