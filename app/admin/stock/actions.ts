"use server";

import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { api, mensajeDe, type Problema } from "@/lib/api/servidor";
import { listarStock } from "@/lib/dal/admin/inventory";

/*
 * El traslado entre sucursales. Lo hace la API de Go
 * (backend/internal/stock/traslados.go): toma el candado de cada medida en el
 * origen y controla contra lo disponible, sin mover lo reservado para
 * clientes.
 */

/** Un renglón del traslado: la medida y cuánto, como se escribió («2,5»). */
export interface RenglonDeTraslado {
  variantId: string;
  cantidad: string;
}

export interface EstadoTraslado {
  error?: string;
  /** El comprobante recién hecho. */
  id?: string;
  codigo?: string;
}

/**
 * Un traslado entre sucursales con todos sus renglones: sale del origen en
 * el acto y queda en camino hasta que lo reciben.
 */
export async function crearTraslado(datos: {
  origenId: string;
  destinoId: string;
  nota?: string;
  renglones: RenglonDeTraslado[];
}): Promise<EstadoTraslado> {
  const nota = datos.nota?.trim();
  const r = await (await api()).POST("/api/v1/admin/stock/traslados", {
    body: {
      origenId: datos.origenId,
      destinoId: datos.destinoId,
      renglones: datos.renglones.slice(0, 100),
      ...(nota ? { nota: nota.slice(0, 300) } : {}),
    },
  });
  if (!r.data) return { error: mensajeDe(r.error as Problema | undefined, "No se pudo registrar el traslado.") };
  revalidatePath("/admin/stock");
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/stock");
  revalidatePath("/catalogo");
  return { id: r.data.id, codigo: r.data.codigo };
}

/** Quien recibe confirma: el destino suma lo que llegó. */
export async function recibirTraslado(id: string): Promise<{ error?: string }> {
  const r = await (await api()).POST("/api/v1/admin/stock/traslados/{id}/recibir", { params: { path: { id } } });
  if (!r.response.ok) {
    return { error: mensajeDe(r.error as Problema | undefined, "No se pudo registrar la recepción.") };
  }
  revalidatePath("/admin/stock");
  revalidatePath(`/admin/stock/traslados/${id}`);
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/stock");
  revalidatePath("/catalogo");
  return {};
}

/** Una medida encontrada por nombre, medida o código. */
export interface MedidaEncontrada {
  id: string;
  producto: string;
  medida: string;
  sku: string;
  codigo: string;
  unidad: string;
  /** Lo disponible en cada sucursal (físico − reservado), por id. */
  disponible: Record<string, number>;
}

/**
 * Buscar medidas para elegirlas (la transferencia, las etiquetas). Antes la
 * pantalla mandaba al navegador el catálogo entero y filtraba ahí; con miles
 * de medidas, la búsqueda la hace Go y vuelve solo lo que coincide.
 */
export async function buscarMedidas(texto: string): Promise<MedidaEncontrada[]> {
  const busqueda = texto.trim().slice(0, 200);
  if (busqueda.length < 2) return [];
  const { filas } = await listarStock({ busqueda }, 12);
  return filas.map((f) => ({
    id: f.variantId,
    producto: f.productName,
    medida: f.label,
    sku: f.sku,
    codigo: f.codigoBarras ?? f.sku,
    unidad: f.unidad,
    disponible: Object.fromEntries(f.sucursales.map((s) => [s.id, s.disponible])),
  }));
}
