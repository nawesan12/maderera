import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hoja, MUESTRA_DEL_BUILD } from "../../preparando";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import {
  calcularPlanoDeCorteSinTrabar,
  leerAcomodoManual,
} from "@/lib/cortes/plano";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { armarHojaDeCorte } from "@/lib/cortes/secuencia";
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
 * se cobró. Ver `lib/cortes/secuencia.ts`.
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
  const corte = await obtenerCorte(id);
  if (!corte) notFound();

  const plano = await calcularPlanoDeCorteSinTrabar({
    piezas: corte.piezas,
    placaLargo: corte.medida.largo,
    placaAncho: corte.medida.ancho,
    // El disco de este trabajo: con otro, las medidas de la hoja no serían
    // las del patrón que se cobró.
    anchoSierra: corte.anchoSierraMm,
    fijadas: leerAcomodoManual(corte.acomodoManual),
    busqueda: corte.motorPlano >= 2,
  });

  return (
    <HojaDeCorteImpresa
      hoja={armarHojaDeCorte(plano)}
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
