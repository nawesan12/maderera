import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/dal/session";
import { obtenerCorte } from "@/lib/dal/admin/cortes";
import {
  calcularPlanoDeCorte,
  leerAcomodoManual,
} from "@/lib/cortes/plano";
import { MEDIDAS_DE_PLACA } from "@/lib/calculations";
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
export default async function PlanoDeCortePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireStaff();

  const { id } = await params;
  const corte = await obtenerCorte(id);
  if (!corte) notFound();

  const porDefecto = MEDIDAS_DE_PLACA[0]!;
  const placaLargo = corte.placaLargoMm ?? porDefecto.largo;
  const placaAncho = corte.placaAnchoMm ?? porDefecto.ancho;

  const plano = calcularPlanoDeCorte({
    piezas: corte.piezas,
    placaLargo,
    placaAncho,
    // Lo que alguien corrigió a mano cuando cargó el trabajo.
    fijadas: leerAcomodoManual(corte.acomodoManual),
  });

  return (
    <PlanoImpreso
      plano={plano}
      corte={{
        numero: corte.numero,
        cliente: corte.cliente,
        material: corte.material,
        cantoDescripcion: corte.cantoDescripcion,
        createdAt: corte.createdAt,
      }}
    />
  );
}
