import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Hoja, MUESTRA_DEL_BUILD } from "../../preparando";
import { requireStaff } from "@/lib/dal/session";
import { hojaDelCorte } from "@/lib/dal/admin/cortes";
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
  // El plano lo arma Go con el disco, lo fijado a mano y el motor con que
  // nació el trabajo: el mismo que se presupuestó.
  const datos = await hojaDelCorte(id);
  if (!datos) notFound();
  const { corte, plano } = datos;

  return (
    <PlanoImpreso
      plano={plano}
      superficieSierra={datos.superficies.reduce((t, x) => t + x, 0)}
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
