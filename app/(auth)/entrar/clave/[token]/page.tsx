import type { Metadata } from "next";
import { Suspense } from "react";
import { Marca } from "@/components/marca";
import { ElegirClave } from "./formulario";

export const metadata: Metadata = {
  title: "Elegí tu contraseña",
  robots: { index: false, follow: false },
  // El token va en la dirección: que no viaje como referer a ningún lado.
  referrer: "no-referrer",
};

/**
 * El link del alta del personal (recorrido, M4-006): la persona elige su
 * contraseña y nadie más la conoce. Abrirlo no gasta nada; se gasta al
 * guardar la clave.
 */
export default function ElegirClavePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-sitio-alt px-4 py-12">
      <div className="w-full max-w-[400px] rounded-2xl border border-linea bg-card px-6 py-9 sm:px-8">
        <div className="flex justify-center">
          <Marca />
        </div>
        <h1 className="mt-7 text-center text-2xl font-bold tracking-[-0.025em]">Elegí tu contraseña</h1>
        <Suspense fallback={<div className="mt-6 h-[132px]" />}>
          <ConToken params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ConToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ElegirClave token={token} />;
}
