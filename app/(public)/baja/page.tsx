import type { Metadata } from "next";
import { Suspense } from "react";
import { MailX } from "lucide-react";
import { CargandoSitio } from "@/components/sitio/cargando";
import { apiPublica, datos } from "@/lib/api/servidor";
import { BotonDeBaja } from "./boton";

export const metadata: Metadata = {
  title: "Dejar de recibir novedades",
  robots: { index: false, follow: false },
};

/**
 * La página del enlace «date de baja» de las campañas.
 *
 * Pide confirmar con un botón en vez de dar de baja al abrirla: los programas
 * que revisan los enlaces de un correo los abren solos, y la gente se iría de
 * la lista sin haber tocado nada. La baja con un clic de verdad —el botón de
 * Gmail— va por `/api/baja`. Las dos las atiende Go (backend/internal/campanas).
 */
export default function BajaPage({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  return (
    <Suspense fallback={<CargandoSitio />}>
      <Baja searchParams={searchParams} />
    </Suspense>
  );
}

async function Baja({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  const { e = "", t = "" } = await searchParams;
  const { email, dadoDeBaja } = datos(await apiPublica.GET("/api/v1/bajas", { params: { query: { e, t } } }));

  return (
    <div className="contenedor flex min-h-[60vh] items-center py-16">
      <div className="mx-auto max-w-lg text-center">
        <MailX className="mx-auto h-12 w-12 text-acento-texto" />
        {email ? (
          <>
            <h1 className="mt-5 text-3xl font-bold tracking-tight">Novedades por correo</h1>
            <p className="mt-3 text-lg text-texto-2">
              Para <strong className="text-foreground">{email}</strong>
            </p>
            <BotonDeBaja e={e} t={t} dadoDeBaja={dadoDeBaja} />
          </>
        ) : (
          <>
            <h1 className="mt-5 text-3xl font-bold tracking-tight">Este enlace no es válido</h1>
            <p className="mt-3 text-lg text-texto-2">
              Puede que se haya cortado al copiarlo. Usá el enlace del final de cualquiera de nuestros
              correos, o escribinos y te damos de baja nosotros.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
