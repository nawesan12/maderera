import "server-only";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { valorDeRegla } from "@/lib/reglas";
import type { NombreDelCircuito } from "@/lib/circuito";

/** La regla `etiqueta_del_circuito`, para las pantallas de servidor. */
export async function nombreDelCircuito(): Promise<NombreDelCircuito> {
  return valorDeRegla(await ajustesDelSitio(), "etiqueta_del_circuito");
}
