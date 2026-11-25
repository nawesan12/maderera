import type { Metadata } from "next";
import { Suspense } from "react";
import { Marca } from "@/components/marca";
import { BotonEntrar } from "./boton";

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
  // El token va en la dirección: que no viaje como referer a ningún lado.
  referrer: "no-referrer",
};

/**
 * El link mágico. Abrirlo no gasta nada: se entra con el botón (ver
 * `entrarConEnlace`).
 */
export default function EntrarPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-sitio-alt px-4 py-12">
      <div className="w-full max-w-[400px] rounded-2xl border border-linea bg-card px-8 py-9 text-center">
        <div className="flex justify-center">
          <Marca />
        </div>
        <h1 className="mt-7 text-2xl font-bold tracking-[-0.025em]">Entrá a tu cuenta</h1>
        <Suspense fallback={<div className="mt-6 h-[52px]" />}>
          <ConToken params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function ConToken({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BotonEntrar token={token} />;
}
