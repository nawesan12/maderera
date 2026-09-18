"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { cartCortes } from "@/lib/db/schema";
import { obtenerOCrearCarrito } from "@/lib/dal/carrito";
import { placaCortable } from "@/lib/dal/cortes-publico";
import { parametrosDeCalculo } from "@/lib/dal/calculadora-parametros";
import { calcularPlanoDeCorte } from "@/lib/cortes/plano";
import { presupuestarCorte } from "@/lib/cortes/presupuesto";
import { fraccionDePlaca, medidaDePlaca } from "@/lib/cortes/placa";
import { avisoDeEspera, ipDelPedido, permitido } from "@/lib/limites";

export interface EstadoCorte {
  error?: string;
  ok?: string;
}

const piezaSchema = z.object({
  largoMm: z.coerce.number().int().positive().max(10_000),
  anchoMm: z.coerce.number().int().positive().max(10_000),
  cantidad: z.coerce.number().int().positive().max(200),
  respetaVeta: z.coerce.number().int().min(0).max(1),
  cantoLargo: z.coerce.number().int().min(0).max(2),
  cantoAncho: z.coerce.number().int().min(0).max(2),
  etiqueta: z.string().trim().max(120).nullable().optional(),
});

/**
 * El tope real: piezas totales, no renglones.
 *
 * Contar renglones no alcanza. Cien medidas distintas de doscientas unidades
 * cada una son veinte mil piezas, y lo que el motor acomoda —una por una,
 * probando varios órdenes— son piezas, no renglones. Mil es holgado para el
 * despiece más grande que puede pedir un carpintero desde el sitio y deja el
 * cálculo dentro de lo que una función puede hacer sin que se note.
 */
const MAXIMO_DE_PIEZAS = 1_000;

const esquema = z
  .object({
    variantId: z.string().uuid(),
    mitad: z.enum(["largo", "ancho"]).nullable().optional(),
    cantoDescripcion: z.string().trim().max(120).nullable().optional(),
    piezas: z.array(piezaSchema).min(1).max(100),
  })
  .refine(
    (datos) =>
      datos.piezas.reduce((total, p) => total + Number(p.cantidad), 0) <=
      MAXIMO_DE_PIEZAS,
    {
      message: `Son demasiadas piezas para calcular acá (el máximo es ${MAXIMO_DE_PIEZAS}). Pedinos el despiece por WhatsApp y lo armamos nosotros.`,
      path: ["piezas"],
    },
  );

/**
 * Guarda en el carrito un corte armado en el sitio.
 *
 * **Todo se vuelve a calcular acá.** El navegador dibuja el plano y muestra un
 * precio para que la persona decida, pero lo que se guarda sale de volver a
 * buscar la placa con la lista de quien compra, volver a acomodar las piezas con
 * el espesor de sierra configurado y volver a presupuestar. Una acción de
 * servidor es una dirección pública: si el precio viajara en el formulario,
 * cualquiera podría mandar el suyo.
 *
 * El tope de 100 medidas distintas no es una limitación del motor: es lo que
 * separa un despiece de un intento de tirar abajo el servidor desde una pestaña.
 */
export async function agregarCorteAlCarrito(
  datos: z.input<typeof esquema>,
): Promise<EstadoCorte> {
  const parsed = esquema.safeParse(datos);

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ??
        "Revisá las medidas: tienen que ser números en milímetros.",
    };
  }

  const { variantId, mitad, cantoDescripcion, piezas } = parsed.data;

  /*
   * El freno, antes de acomodar.
   *
   * `calcularPlanoDeCorte` prueba varios órdenes de entrada por dos formas de
   * partir cada sobrante: es el trabajo de CPU más caro que se puede pedir desde
   * afuera sin siquiera tener cuenta. El tope por llamada ya está en el esquema;
   * esto es el tope por rato.
   */
  const puede = await permitido("corte", `ip:${await ipDelPedido()}`);

  if (!puede.permitido) return { error: avisoDeEspera(puede) };

  const [placa, parametros] = await Promise.all([
    placaCortable(variantId),
    parametrosDeCalculo(),
  ]);

  if (!placa) {
    return {
      error: "Esa placa ya no está disponible para cortar. Elegí otra.",
    };
  }

  const medida = medidaDePlaca({
    varianteLargo: placa.largoMm,
    varianteAncho: placa.anchoMm,
    mitad: mitad ?? null,
  });

  const plano = calcularPlanoDeCorte({
    piezas,
    placaLargo: medida.largo,
    placaAncho: medida.ancho,
    anchoSierra: parametros.anchoSierraMm,
  });

  if (plano.noEntran.length > 0) {
    return {
      error:
        plano.noEntran.length === 1
          ? "Hay una pieza que no entra en la placa. Revisá esa medida."
          : `Hay ${plano.noEntran.length} piezas que no entran en la placa. Revisá esas medidas.`,
    };
  }

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
    fraccion: fraccionDePlaca(mitad ?? null),
  });

  const cartId = await obtenerOCrearCarrito();

  await db.insert(cartCortes).values({
    cartId,
    variantId,
    materialDescripcion: placa.descripcion,
    placaLargoMm: medida.largo,
    placaAnchoMm: medida.ancho,
    mitad: mitad ?? null,
    cantoDescripcion: cantoDescripcion || null,
    piezas: JSON.stringify(piezas),
    placas: plano.placas.length,
    pasadas: plano.pasadasCobrables,
    total: cuenta.total.toFixed(2),
  });

  // Solo las dos pantallas que muestran el carrito, que además son dinámicas.
  // Con `revalidatePath("/", "layout")` —como estaba— cada corte agregado
  // dejaba sin caché el sitio entero. Ver `app/(public)/carrito-actions.ts`.
  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");

  return { ok: "El corte quedó en tu carrito." };
}

/** Saca un corte del carrito. */
export async function quitarCorteDelCarrito(id: string): Promise<EstadoCorte> {
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { error: "No se pudo quitar." };

  // Del carrito de quien está pidiendo y de ningún otro: el id de un renglón
  // es un uuid que viaja al navegador, así que por sí solo no puede autorizar
  // a borrar el corte de otra persona.
  const cartId = await obtenerOCrearCarrito();

  await db
    .delete(cartCortes)
    .where(and(eq(cartCortes.id, parsed.data), eq(cartCortes.cartId, cartId)));

  revalidatePath("/carrito");
  revalidatePath("/carrito/confirmar");
  return { ok: "Corte quitado." };
}
