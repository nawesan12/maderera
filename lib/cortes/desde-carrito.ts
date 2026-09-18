import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cartCortes } from "@/lib/db/schema";
import { placaCortable, type PlacaCortable } from "@/lib/dal/cortes-publico";
import { parametrosDeCalculo } from "@/lib/dal/calculadora-parametros";
import { calcularPlanoDeCorte, type PiezaAcortar } from "@/lib/cortes/plano";
import {
  presupuestarCorte,
  type PresupuestoDeCorte,
} from "@/lib/cortes/presupuesto";
import { fraccionDePlaca, medidaDePlaca, nombreDeLaMitad } from "@/lib/cortes/placa";

/**
 * Los cortes del carrito, listos para convertirse en pedido.
 *
 * **Se recalcula todo.** El carrito guarda el precio que se le mostró a la
 * persona cuando armó el corte, y eso sirve para enseñárselo de vuelta y para
 * avisarle si cambió —igual que con los productos—, pero lo que se cobra sale de
 * volver a buscar la placa con la lista de quien compra, volver a acomodar las
 * piezas con el espesor de sierra configurado y volver a presupuestar. Entre que
 * alguien arma el corte y confirma la compra pueden pasar días, y en el medio
 * puede haber cambiado el precio de la placa o la tarifa de la pasada.
 *
 * Devuelve, por cada corte, las líneas que se cobran y lo que hace falta para
 * abrir la orden en la cola del taller.
 */
export interface LineaDeCorte {
  variantId: string | null;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
}

export interface CorteResuelto {
  id: string;
  placa: PlacaCortable;
  piezas: PiezaAcortar[];
  mitad: "largo" | "ancho" | null;
  cantoDescripcion: string | null;
  placaLargoMm: number;
  placaAnchoMm: number;
  placas: number;
  pasadas: number;
  cuenta: PresupuestoDeCorte;
  lineas: LineaDeCorte[];
}

export async function resolverCortesDelCarrito(
  cartId: string,
): Promise<{ resueltos: CorteResuelto[]; error?: string }> {
  // El despiece se lee de la base y no del carrito que ya viajó al navegador:
  // es lo que se va a fabricar, y tiene que salir de la misma fuente que lo
  // que se cobra.
  const cortes = await db
    .select()
    .from(cartCortes)
    .where(eq(cartCortes.cartId, cartId))
    .orderBy(asc(cartCortes.createdAt));

  if (cortes.length === 0) return { resueltos: [] };

  const parametros = await parametrosDeCalculo();
  const resueltos: CorteResuelto[] = [];

  for (const corte of cortes) {
    if (!corte.variantId) {
      return {
        resueltos: [],
        error: `El corte de ${corte.materialDescripcion} quedó sin placa. Sacalo del carrito y armalo de nuevo.`,
      };
    }

    const placa = await placaCortable(corte.variantId);

    if (!placa) {
      return {
        resueltos: [],
        error: `La placa del corte de ${corte.materialDescripcion} ya no está disponible. Sacalo del carrito y elegí otra.`,
      };
    }

    const piezas = leerPiezas(corte.piezas);

    if (piezas.length === 0) {
      return {
        resueltos: [],
        error: `El corte de ${corte.materialDescripcion} no tiene medidas. Sacalo del carrito y armalo de nuevo.`,
      };
    }

    const mitad = (corte.mitad as "largo" | "ancho" | null) ?? null;

    const medida = medidaDePlaca({
      varianteLargo: placa.largoMm,
      varianteAncho: placa.anchoMm,
      mitad,
    });

    const plano = calcularPlanoDeCorte({
      piezas,
      placaLargo: medida.largo,
      placaAncho: medida.ancho,
      anchoSierra: parametros.anchoSierraMm,
    });

    if (plano.noEntran.length > 0) {
      return {
        resueltos: [],
        error: `En el corte de ${corte.materialDescripcion} hay medidas que no entran en la placa. Revisalo antes de comprar.`,
      };
    }

    const fraccion = fraccionDePlaca(mitad);
    const cuenta = presupuestarCorte({
      plano,
      tarifa: {
        material: placa.descripcion,
        priceListId: null,
        precioPorPasada: placa.precioPorPasada,
        precioPorMetroCanto: placa.precioPorMetroCanto,
      },
      precioPorPlaca: placa.precio,
      piezas,
      fraccion,
    });

    const lineas: LineaDeCorte[] = [];

    /*
     * El material va con su variante: es lo que descuenta stock del estante.
     * Media placa se cobra a mitad de precio pero saca **una placa entera** del
     * depósito, que es lo que pasa físicamente; el pedazo que queda vuelve como
     * retal.
     */
    if (cuenta.placasEnteras > 0) {
      lineas.push({
        variantId: placa.variantId,
        descripcion: mitad
          ? `${placa.descripcion} — ${nombreDeLaMitad(mitad).toLowerCase()}`
          : placa.descripcion,
        unidad: "unidad",
        cantidad: cuenta.placasEnteras,
        precioUnitario: placa.precio * fraccion,
      });
    }

    // El corte y el tapacanto van sin variante: no son mercadería y no
    // descuentan nada del stock.
    if (cuenta.subtotalCorte > 0) {
      lineas.push({
        variantId: null,
        descripcion: `Corte a medida — ${cuenta.pasadasCobrables} ${
          cuenta.pasadasCobrables === 1 ? "pasada" : "pasadas"
        }`,
        unidad: "pasada",
        cantidad: cuenta.pasadasCobrables,
        precioUnitario: cuenta.precioPorPasada,
      });
    }

    if (cuenta.subtotalCanto > 0) {
      lineas.push({
        variantId: null,
        descripcion: `Tapacanto pegado${
          corte.cantoDescripcion ? ` — ${corte.cantoDescripcion}` : ""
        }`,
        unidad: "m",
        cantidad: cuenta.metrosCanto,
        precioUnitario: placa.precioPorMetroCanto,
      });
    }

    resueltos.push({
      id: corte.id,
      placa,
      piezas,
      mitad,
      cantoDescripcion: corte.cantoDescripcion,
      placaLargoMm: medida.largo,
      placaAnchoMm: medida.ancho,
      placas: plano.placas.length,
      pasadas: plano.pasadasCobrables,
      cuenta,
      lineas,
    });
  }

  return { resueltos };
}

/**
 * El despiece guardado como JSON, validado.
 *
 * Tolera basura devolviendo una lista vacía: el que llama lo trata como un
 * corte que hay que rehacer, en vez de romper la compra entera.
 */
function leerPiezas(crudo: string): PiezaAcortar[] {
  try {
    const leidas = JSON.parse(crudo);
    if (!Array.isArray(leidas)) return [];

    return leidas
      .map((p) => ({
        largoMm: Math.round(Number(p?.largoMm) || 0),
        anchoMm: Math.round(Number(p?.anchoMm) || 0),
        cantidad: Math.round(Number(p?.cantidad) || 0),
        respetaVeta: Number(p?.respetaVeta) === 1 ? 1 : 0,
        cantoLargo: Math.min(2, Math.max(0, Math.round(Number(p?.cantoLargo) || 0))),
        cantoAncho: Math.min(2, Math.max(0, Math.round(Number(p?.cantoAncho) || 0))),
        etiqueta: typeof p?.etiqueta === "string" ? p.etiqueta : null,
      }))
      .filter((p) => p.largoMm > 0 && p.anchoMm > 0 && p.cantidad > 0);
  } catch {
    return [];
  }
}
