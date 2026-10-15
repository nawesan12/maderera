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
import { PlanoImpreso } from "@/components/cortes/plano-impreso";

export const metadata: Metadata = {
  title: "Plano de corte",
  robots: { index: false, follow: false },
};

/**
 * El plano de corte de un trabajo.
 *
 * **Es una propuesta, no una orden.** El patrón que corta la máquina lo sigue
 * armando el optimizador del taller; esto contesta antes, en el mostrador, las
 * tres preguntas que hoy hay que ir a buscar: cuántas placas entran, cuántas
 * pasadas son —de las que sale el precio— y cuánto se desperdicia.
 *
 * La medida de la placa sale de la variante del catálogo. Cuando el corte es
 * sobre material del cliente y no hay variante, se usa la medida de plaza más
 * común: es un supuesto y la pantalla lo dice.
 */
export async function generateStaticParams() {
  return MUESTRA_DEL_BUILD;
}

export default function PlanoDeCortePage({
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

async function Contenido({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();

  const { id } = await params;
  const corte = await obtenerCorte(id);
  if (!corte) notFound();

  const plano = await calcularPlanoDeCorteSinTrabar({
    piezas: corte.piezas,
    placaLargo: corte.medida.largo,
    placaAncho: corte.medida.ancho,
    // El mismo espesor de disco con el que se presupuestó, guardado en el
    // trabajo: si la hoja del taller usara otro, el patrón dibujado no sería
    // el que se cobró.
    anchoSierra: corte.anchoSierraMm,
    // Lo que alguien corrigió a mano cuando cargó el trabajo.
    fijadas: leerAcomodoManual(corte.acomodoManual),
    // Con el motor con que nació el trabajo (ver `cutting_orders.motorPlano`).
    busqueda: corte.motorPlano >= 2,
  });

  return (
    <PlanoImpreso
      plano={plano}
      corte={{
        id: corte.id,
        numero: corte.numero,
        cliente: corte.cliente,
        material: corte.material,
        cantoDescripcion: corte.cantoDescripcion,
        createdAt: corte.createdAt,
        // De qué sale: placa entera o media, y en qué sentido partida. En el
        // taller es lo primero que hay que saber antes de bajar la placa.
        deQueSale: nombreDeLaMitad(corte.medida.mitad),
      }}
    />
  );
}
