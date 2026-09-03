"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath, updateTag } from "next/cache";
import { ETIQUETAS } from "@/lib/cache-publico";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  categories,
  priceHistory,
  priceListItems,
  priceLists,
  productVariants,
  products,
} from "@/lib/db/schema";
import { requireStaff } from "@/lib/dal/session";
import { registrarEnBitacora } from "@/lib/dal/admin/auditoria";
import { leerCsv, type FilaImportada } from "@/lib/precios-csv";

export interface EstadoPrecios {
  error?: string;
  ok?: string;
}

/** Deja registrado el cambio junto con lo que había antes. */
async function registrar(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  datos: {
    variantId: string;
    priceListId: string;
    anterior: string | null;
    nuevo: string;
    origen: "manual" | "ajuste_masivo" | "importacion";
    motivo?: string;
    loteId?: string;
    userId: string;
  },
) {
  await tx.insert(priceHistory).values({
    variantId: datos.variantId,
    priceListId: datos.priceListId,
    precioAnterior: datos.anterior,
    precioNuevo: datos.nuevo,
    origen: datos.origen,
    motivo: datos.motivo,
    loteId: datos.loteId,
    createdByUserId: datos.userId,
  });
}

/** Escribe un precio y devuelve el que había, o null si no cambió nada. */
async function aplicarPrecio(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  variantId: string,
  priceListId: string,
  nuevo: string,
): Promise<{ anterior: string | null; cambio: boolean }> {
  const [previo] = await tx
    .select({ price: priceListItems.price })
    .from(priceListItems)
    .where(
      and(
        eq(priceListItems.variantId, variantId),
        eq(priceListItems.priceListId, priceListId),
      ),
    )
    .limit(1);

  const anterior = previo?.price ?? null;
  if (anterior !== null && Number(anterior) === Number(nuevo)) {
    return { anterior, cambio: false };
  }

  await tx
    .insert(priceListItems)
    .values({ variantId, priceListId, price: nuevo, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [priceListItems.priceListId, priceListItems.variantId],
      set: { price: nuevo, updatedAt: new Date() },
    });

  return { anterior, cambio: true };
}

function refrescar() {
  revalidatePath("/admin/precios");
  // El catálogo está cacheado entre visitas, con la lista de precios en la
  // clave. `updateTag` —y no `revalidateTag`— porque quien acaba de tocar esto
  // tiene que verlo aplicado al volver al sitio, no en la visita siguiente:
  // sin esto, el cambio tardaría hasta cinco minutos en salir.
  updateTag(ETIQUETAS.catalogo);
  revalidatePath("/catalogo");
}

/* -------------------------------------------------------------------------- */
/* Edición de un precio                                                        */
/* -------------------------------------------------------------------------- */

const edicionSchema = z.object({
  variantId: z.string().uuid(),
  priceListId: z.string().uuid(),
  precio: z.string().refine((v) => Number.isFinite(Number(v)) && Number(v) >= 0, {
    message: "El precio tiene que ser un número positivo.",
  }),
});

export async function editarPrecio(
  _previo: EstadoPrecios,
  formData: FormData,
): Promise<EstadoPrecios> {
  const usuario = await requireStaff();

  const parsed = edicionSchema.safeParse({
    variantId: formData.get("variantId"),
    priceListId: formData.get("priceListId"),
    precio: formData.get("precio"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá el precio." };
  }

  const { variantId, priceListId, precio } = parsed.data;
  const valor = Number(precio).toFixed(2);

  await db.transaction(async (tx) => {
    const { anterior, cambio } = await aplicarPrecio(
      tx,
      variantId,
      priceListId,
      valor,
    );
    if (cambio) {
      await registrar(tx, {
        variantId,
        priceListId,
        anterior,
        nuevo: valor,
        origen: "manual",
        userId: usuario.userId,
      });
    }
  });

  refrescar();
  return { ok: "Precio actualizado." };
}

/* -------------------------------------------------------------------------- */
/* Ajuste masivo                                                               */
/* -------------------------------------------------------------------------- */

const ajusteSchema = z.object({
  porcentaje: z.coerce
    .number()
    .min(-90, "No se puede bajar más de 90%.")
    .max(500, "Un aumento mayor a 500% seguramente sea un error de tipeo.")
    .refine((v) => v !== 0, "Poné un porcentaje distinto de cero."),
  categoria: z.string().optional(),
  listaSlug: z.enum(["ambas", "general", "profesional"]).default("ambas"),
  redondeo: z.enum(["ninguno", "decena", "centena", "mil"]).default("ninguno"),
  motivo: z.string().trim().max(200).optional(),
});

/**
 * Aplica el porcentaje y redondea hacia arriba, que es como se arman las listas.
 *
 * El producto se recorta a dos decimales antes de redondear porque en punto
 * flotante `100000 * 1.1` da `110000.00000000001`, y redondear ese sobrante
 * hacia arriba convertía un aumento del 10% sobre $100.000 en $110.100. Un peso
 * de más por acá pasa desapercibido; cien, no.
 */
function ajustar(base: number, factor: number, modo: string): number {
  const conAjuste = Math.round(base * factor * 100) / 100;

  if (modo === "decena") return Math.ceil(conAjuste / 10) * 10;
  if (modo === "centena") return Math.ceil(conAjuste / 100) * 100;
  if (modo === "mil") return Math.ceil(conAjuste / 1000) * 1000;
  return conAjuste;
}

export async function ajustarPrecios(
  _previo: EstadoPrecios,
  formData: FormData,
): Promise<EstadoPrecios> {
  const usuario = await requireStaff();

  const parsed = ajusteSchema.safeParse({
    porcentaje: formData.get("porcentaje"),
    categoria: (formData.get("categoria") as string) || undefined,
    listaSlug: formData.get("listaSlug") ?? "ambas",
    redondeo: formData.get("redondeo") ?? "ninguno",
    motivo: (formData.get("motivo") as string) || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Revisá los datos." };
  }

  const { porcentaje, categoria, listaSlug, redondeo, motivo } = parsed.data;
  const factor = 1 + porcentaje / 100;
  const loteId = randomUUID();

  let tocados = 0;

  await db.transaction(async (tx) => {
    const listas = await tx.select().from(priceLists);
    const objetivo =
      listaSlug === "ambas"
        ? listas
        : listas.filter((l) =>
            listaSlug === "general" ? l.isDefault : l.slug === "profesional",
          );

    const condiciones = [
      eq(products.active, true),
      eq(productVariants.active, true),
    ];
    if (categoria && categoria !== "todos") {
      condiciones.push(eq(categories.slug, categoria));
    }

    const variantes = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .innerJoin(categories, eq(categories.id, products.categoryId))
      .where(and(...condiciones));

    if (variantes.length === 0) return;

    const ids = variantes.map((v) => v.id);

    for (const lista of objetivo) {
      const actuales = await tx
        .select({
          variantId: priceListItems.variantId,
          price: priceListItems.price,
        })
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.priceListId, lista.id),
            inArray(priceListItems.variantId, ids),
          ),
        );

      for (const actual of actuales) {
        const base = Number(actual.price);
        // Un producto sin precio cargado no se ajusta: multiplicar cero por
        // cualquier porcentaje sigue dando cero y solo ensucia el historial.
        if (!Number.isFinite(base) || base <= 0) continue;

        const nuevo = ajustar(base, factor, redondeo).toFixed(2);
        const { anterior, cambio } = await aplicarPrecio(
          tx,
          actual.variantId,
          lista.id,
          nuevo,
        );

        if (cambio) {
          tocados++;
          await registrar(tx, {
            variantId: actual.variantId,
            priceListId: lista.id,
            anterior,
            nuevo,
            origen: "ajuste_masivo",
            motivo:
              motivo ??
              `${porcentaje > 0 ? "Aumento" : "Baja"} del ${Math.abs(porcentaje)}%`,
            loteId,
            userId: usuario.userId,
          });
        }
      }
    }
  });

  // El precio individual no se registra acá: `price_history` ya guarda cada
  // cambio con su valor anterior, que es más detalle del que cabe en la
  // bitácora. Lo que sí va son las operaciones masivas, porque son las que
  // mueven cientos de precios de un saque y las que después nadie recuerda.
  await registrarEnBitacora({
    sesion: usuario,
    accion: "editar",
    entidad: "precio",
    descripcion: `Ajuste masivo del ${porcentaje > 0 ? "+" : ""}${porcentaje}% sobre ${tocados} precio${tocados === 1 ? "" : "s"}`,
    detalle: { porcentaje, categoria, listaSlug, redondeo, motivo, loteId, tocados },
  });

  refrescar();

  if (tocados === 0) {
    return { error: "No se encontraron precios para ajustar con ese filtro." };
  }

  return {
    ok: `Se actualizaron ${tocados} precio${tocados === 1 ? "" : "s"}.`,
  };
}

/* -------------------------------------------------------------------------- */
/* Importación desde planilla                                                  */
/* -------------------------------------------------------------------------- */

export interface FilaPrevia {
  linea: number;
  sku: string;
  producto?: string;
  medida?: string;
  generalActual?: string;
  generalNuevo?: string;
  profesionalActual?: string;
  profesionalNuevo?: string;
  estado: "cambia" | "igual" | "sin-sku" | "error";
  detalle?: string;
}

export interface VistaPreviaImportacion {
  filas: FilaPrevia[];
  cambian: number;
  iguales: number;
  problemas: number;
  error?: string;
}

/**
 * Lee la planilla y muestra qué pasaría, sin escribir nada.
 *
 * Importar precios a ciegas es la forma más rápida de arruinar una lista: basta
 * una columna corrida o un archivo viejo. Primero se ve la comparación, después
 * se confirma.
 */
export async function previsualizarImportacion(
  formData: FormData,
): Promise<VistaPreviaImportacion> {
  await requireStaff();

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { filas: [], cambian: 0, iguales: 0, problemas: 0, error: "Elegí un archivo." };
  }

  if (archivo.size > 5 * 1024 * 1024) {
    return {
      filas: [],
      cambian: 0,
      iguales: 0,
      problemas: 0,
      error: "El archivo supera los 5 MB.",
    };
  }

  const leidas = leerCsv(await archivo.text());
  if (leidas.length === 0) {
    return {
      filas: [],
      cambian: 0,
      iguales: 0,
      problemas: 0,
      error: "La planilla está vacía.",
    };
  }

  return compararConLaBase(leidas);
}

async function compararConLaBase(
  leidas: FilaImportada[],
): Promise<VistaPreviaImportacion> {
  const listas = await db.select().from(priceLists);
  const general = listas.find((l) => l.isDefault);
  const profesional = listas.find((l) => l.slug === "profesional");

  const skus = leidas.map((f) => f.sku).filter(Boolean);

  const variantes =
    skus.length > 0
      ? await db
          .select({
            id: productVariants.id,
            sku: productVariants.sku,
            producto: products.name,
            medida: productVariants.label,
          })
          .from(productVariants)
          .innerJoin(products, eq(products.id, productVariants.productId))
          .where(inArray(productVariants.sku, skus))
      : [];

  const precios =
    variantes.length > 0
      ? await db
          .select({
            variantId: priceListItems.variantId,
            priceListId: priceListItems.priceListId,
            price: priceListItems.price,
          })
          .from(priceListItems)
          .where(
            inArray(
              priceListItems.variantId,
              variantes.map((v) => v.id),
            ),
          )
      : [];

  const filas: FilaPrevia[] = leidas.map((leida) => {
    if (leida.error) {
      return {
        linea: leida.linea,
        sku: leida.sku,
        estado: "error",
        detalle: leida.error,
      };
    }

    const variante = variantes.find((v) => v.sku === leida.sku);
    if (!variante) {
      return {
        linea: leida.linea,
        sku: leida.sku,
        estado: "sin-sku",
        detalle: "No hay ningún producto con ese código.",
      };
    }

    const actual = (listaId?: string) =>
      precios.find(
        (p) => p.variantId === variante.id && p.priceListId === listaId,
      )?.price;

    const generalActual = actual(general?.id);
    const profesionalActual = actual(profesional?.id);

    const cambiaGeneral =
      leida.precioGeneral !== null &&
      Number(leida.precioGeneral) !== Number(generalActual ?? -1);
    const cambiaProfesional =
      leida.precioProfesional !== null &&
      Number(leida.precioProfesional) !== Number(profesionalActual ?? -1);

    return {
      linea: leida.linea,
      sku: leida.sku,
      producto: variante.producto,
      medida: variante.medida,
      generalActual,
      generalNuevo: cambiaGeneral ? leida.precioGeneral! : undefined,
      profesionalActual,
      profesionalNuevo: cambiaProfesional ? leida.precioProfesional! : undefined,
      estado: cambiaGeneral || cambiaProfesional ? "cambia" : "igual",
    };
  });

  return {
    filas,
    cambian: filas.filter((f) => f.estado === "cambia").length,
    iguales: filas.filter((f) => f.estado === "igual").length,
    problemas: filas.filter((f) => f.estado === "error" || f.estado === "sin-sku")
      .length,
  };
}

/** Aplica lo que mostró la vista previa. */
export async function confirmarImportacion(
  _previo: EstadoPrecios,
  formData: FormData,
): Promise<EstadoPrecios> {
  const usuario = await requireStaff();

  const crudo = formData.get("cambios");
  if (typeof crudo !== "string" || crudo.length === 0) {
    return { error: "No hay cambios para aplicar." };
  }

  const cambios = z
    .array(
      z.object({
        sku: z.string(),
        generalNuevo: z.string().optional(),
        profesionalNuevo: z.string().optional(),
      }),
    )
    .safeParse(JSON.parse(crudo));

  if (!cambios.success || cambios.data.length === 0) {
    return { error: "No hay cambios para aplicar." };
  }

  const loteId = randomUUID();
  let aplicados = 0;

  await db.transaction(async (tx) => {
    const listas = await tx.select().from(priceLists);
    const general = listas.find((l) => l.isDefault);
    const profesional = listas.find((l) => l.slug === "profesional");

    const variantes = await tx
      .select({ id: productVariants.id, sku: productVariants.sku })
      .from(productVariants)
      .where(
        inArray(
          productVariants.sku,
          cambios.data.map((c) => c.sku),
        ),
      );

    for (const cambio of cambios.data) {
      const variante = variantes.find((v) => v.sku === cambio.sku);
      if (!variante) continue;

      for (const [lista, valor] of [
        [general, cambio.generalNuevo],
        [profesional, cambio.profesionalNuevo],
      ] as const) {
        if (!lista || !valor) continue;

        const { anterior, cambio: hubo } = await aplicarPrecio(
          tx,
          variante.id,
          lista.id,
          valor,
        );

        if (hubo) {
          aplicados++;
          await registrar(tx, {
            variantId: variante.id,
            priceListId: lista.id,
            anterior,
            nuevo: valor,
            origen: "importacion",
            motivo: "Importación de planilla",
            loteId,
            userId: usuario.userId,
          });
        }
      }
    }
  });

  await registrarEnBitacora({
    sesion: usuario,
    accion: "importar",
    entidad: "precio",
    descripcion: `Importó una planilla: ${aplicados} precio${aplicados === 1 ? "" : "s"} cambiado${aplicados === 1 ? "" : "s"}`,
    detalle: { loteId, aplicados, filas: cambios.data.length },
  });

  refrescar();

  return {
    ok: `Se aplicaron ${aplicados} cambio${aplicados === 1 ? "" : "s"} de precio.`,
  };
}
