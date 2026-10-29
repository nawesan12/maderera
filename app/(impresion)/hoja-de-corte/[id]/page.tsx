import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hoja, MUESTRA_DEL_BUILD } from "../../preparando";
import { requireStaff } from "@/lib/dal/session";
import { hojaDelCorte } from "@/lib/dal/admin/cortes";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { HojaDeCorteImpresa } from "@/components/cortes/hoja-de-corte";

export const metadata: Metadata = {
  title: "Hoja de corte",
  robots: { index: false, follow: false },
};

/**
 * La hoja de corte para la seccionadora: qué medida tipear, cuántas veces y
 * qué sale, placa por placa.
 *
 * Es lo que le daba Cutty al operario del semiautomático de WinCut, y Cutty no
 * anda. Sale del mismo plano que la ficha, el PDF y el plano del taller —con el
 * disco y el motor con que nació el trabajo—, así que lo que se corta es lo que
 * se cobró. Ver `backend/internal/cortes/secuencia.go`.
 *
 * La abre todo el personal, aserradero incluido: es su hoja de trabajo.
 */
export async function generateStaticParams() {
  return MUESTRA_DEL_BUILD;
}

export default function HojaDeCortePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Hoja que="corte" params={params}>
      <Contenido params={params} />
    </Hoja>
  );
}

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();

  const { id } = await params;
  // La hoja la arma Go (backend/internal/cortes/secuencia.go) del plano del
  // trabajo, con su disco y su motor.
  const datos = await hojaDelCorte(id);
  if (!datos) notFound();
  const { corte, hoja } = datos;

  return (
    <HojaDeCorteImpresa
      hoja={hoja}
      corte={{
        id: corte.id,
        numero: corte.numero,
        cliente: corte.cliente,
        material: corte.material,
        createdAt: corte.createdAt,
        deQueSale: nombreDeLaMitad(corte.medida.mitad),
        notas: corte.notas,
      }}
    />
  );
}
