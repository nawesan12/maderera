// estadoProfesional de lib/dal/profesionales.ts (go-cuentas 56ef2a1), sin el cache() de React.

import { desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { customers, priceLists, professionalApplications } from "@/lib/db/schema";
import { getSession } from "./sesion";
import { clienteDeLaSesion } from "./sesion";

/**
 * Lecturas del portal de profesionales, del lado público.
 *
 * La pregunta central —"¿esta persona es profesional aprobado?"— se responde
 * acá y en un solo lugar, porque de ella dependen los precios que ve, la
 * documentación que puede bajar y a qué eventos se puede anotar. Repetir el
 * criterio en cada pantalla es cómo se filtran precios mayoristas al público.
 */

export interface EstadoProfesional {
  /** Aprobado: ficha de cliente marcada como profesional y activa. */
  aprobado: boolean;
  customerId: string | null;
  nombre: string | null;
  /** Lista de precios asignada, si tiene una propia. */
  priceListId: string | null;
  nombreLista: string | null;
  limiteCredito: number;
  /** Solicitud en curso, si mandó una y todavía no se resolvió. */
  solicitud: {
    id: string;
    estado: "pendiente" | "aprobada" | "rechazada";
    motivoRechazo: string | null;
    createdAt: Date;
  } | null;
}

/**
 * En qué situación está quien mira la página.
 *
 * Memoizado con `cache()` para toda la request: lo consultan la página, el
 * catálogo y el carrito, y sería la misma consulta tres veces.
 */
export const estadoProfesional = (async (): Promise<EstadoProfesional> => {
  const vacio: EstadoProfesional = {
    aprobado: false,
    customerId: null,
    nombre: null,
    priceListId: null,
    nombreLista: null,
    limiteCredito: 0,
    solicitud: null,
  };

  const sesion = await getSession();
  if (!sesion) return vacio;

  const cliente = await clienteDeLaSesion();

  const [solicitud] = await db
    .select({
      id: professionalApplications.id,
      estado: professionalApplications.estado,
      motivoRechazo: professionalApplications.motivoRechazo,
      createdAt: professionalApplications.createdAt,
    })
    .from(professionalApplications)
    .where(
      or(
        eq(professionalApplications.userId, sesion.userId),
        cliente ? eq(professionalApplications.customerId, cliente.id) : undefined,
      ),
    )
    .orderBy(desc(professionalApplications.createdAt))
    .limit(1);

  if (!cliente) return { ...vacio, solicitud: solicitud ?? null };

  // La verdad sobre si es profesional está en la ficha, no en la solicitud: un
  // vendedor puede marcar a alguien como profesional desde el mostrador sin que
  // haya pasado nunca por el formulario.
  // El mismo criterio está en Go (db/consultas/sitio.sql, EsProfesionalAprobado)
  // para los documentos; se juntan cuando estadoProfesional se mude (tanda 10).
  const aprobado = cliente.tipo === "profesional" && cliente.estado !== "inactivo";

  const [lista] = cliente
    ? await db
        .select({
          id: priceLists.id,
          nombre: priceLists.name,
          priceListId: customers.priceListId,
        })
        .from(customers)
        .leftJoin(priceLists, eq(priceLists.id, customers.priceListId))
        .where(eq(customers.id, cliente.id))
        .limit(1)
    : [];

  return {
    aprobado,
    customerId: cliente.id,
    nombre: cliente.nombre,
    priceListId: lista?.priceListId ?? null,
    nombreLista: lista?.nombre ?? null,
    limiteCredito: cliente.limiteCredito,
    solicitud: solicitud ?? null,
  };
});

