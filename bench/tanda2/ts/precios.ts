// listaGeneral como estaba en lib/dal/precios-sesion.ts (git c575c73^). El
// benchmark mide lo público, que no mira la sesión: listaVigente no se usa.
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { priceLists } from "@/lib/db/schema";

export interface ListaVigente {
  id: string | null;
  generalId: string | null;
  nombre: string | null;
  esDiferenciada: boolean;
  factorDerivado: number;
}

export async function listaGeneral() {
  const [fila] = await db
    .select({ id: priceLists.id, nombre: priceLists.name })
    .from(priceLists)
    .where(and(eq(priceLists.isDefault, true), eq(priceLists.active, true)))
    .limit(1);
  return fila ?? null;
}

export async function listaVigente(): Promise<ListaVigente> {
  throw new Error("el benchmark no mide la lista de la sesión");
}
