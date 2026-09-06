import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  branches,
  categories,
  customers,
  inventory,
  inventoryMovements,
  priceHistory,
  priceListItems,
  priceLists,
  productVariants,
  products,
  suppliers,
  supplierMovements,
  historicalSales,
  historicalInvoices,
  type RechazoMigracion,
} from "@/lib/db/schema";
import { generarSlug } from "@/lib/validation/product";
import type { ClaveEntidad, FilaNormalizada } from "./entidades";

/**
 * Escritura de la migración.
 *
 * Dos decisiones que gobiernan todo el archivo:
 *
 * **Se aplica por lotes, cada lote en su transacción.** Una sola transacción
 * para veinte mil filas mantiene bloqueada media base durante minutos y, si se
 * corta, no deja nada —ni siquiera saber por dónde iba—. Con lotes, un corte
 * deja la mitad adentro, que es exactamente lo que la segunda decisión vuelve
 * inofensivo.
 *
 * **Todo es repetible.** Cada entidad se identifica por una clave natural —el
 * código del sistema viejo, el SKU, la sucursal— y volver a correr el mismo
 * archivo actualiza en vez de duplicar. Es lo que permite corregir cuarenta
 * filas y volver a subir el archivo entero sin pensarlo dos veces, que es como
 * termina saliendo una migración de verdad.
 */

/** Detalle con el que se reconoce un saldo ya migrado. No cambiarlo. */
const REFERENCIA_SALDO = "SALDO-INICIAL";

/** Lo mismo, del lado de los proveedores. */
const REFERENCIA_SALDO_PROVEEDOR = "SALDO-INICIAL-PROV";

export interface ResultadoLote {
  creados: number;
  actualizados: number;
  omitidos: number;
  conError: number;
  rechazos: RechazoMigracion[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const vacio = (): ResultadoLote => ({
  creados: 0,
  actualizados: 0,
  omitidos: 0,
  conError: 0,
  rechazos: [],
});

/** Deja el texto comparable: sin tildes, sin espacios de más, en minúsculas. */
function comparable(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Busca un slug libre agregando un sufijo.
 *
 * Dos productos distintos pueden llamarse igual en categorías distintas
 * —"Tabla" en Maderas y en Deck—, y el slug es único porque es la dirección
 * web. Antes que rechazar la fila, se numera.
 */
async function slugLibre(tx: Tx, base: string): Promise<string> {
  const raiz = base || "producto";

  for (let intento = 0; intento < 50; intento++) {
    const candidato = intento === 0 ? raiz : `${raiz}-${intento + 1}`;
    const [existe] = await tx
      .select({ id: products.id })
      .from(products)
      .where(eq(products.slug, candidato))
      .limit(1);

    if (!existe) return candidato;
  }

  return `${raiz}-${Date.now()}`;
}

/* -------------------------------------------------------------------------- */
/* Clientes                                                                    */
/* -------------------------------------------------------------------------- */

async function aplicarClientes(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
) {
  for (const fila of filas) {
    const d = fila.datos;

    // El orden de búsqueda es el orden de confianza: el código del sistema
    // viejo identifica sin ambigüedad, el CUIT casi siempre, y el nombre solo
    // cuando no hay nada mejor.
    let existente: { id: string } | undefined;

    if (d.codigo) {
      [existente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.codigoLegacy, d.codigo))
        .limit(1);
    }

    if (!existente && d.cuit) {
      [existente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.cuit, d.cuit))
        .limit(1);
    }

    if (!existente) {
      [existente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(sql`lower(${customers.nombre}) = ${comparable(d.nombre)}`)
        .limit(1);
    }

    const valores = {
      nombre: d.nombre,
      razonSocial: d.razonSocial || null,
      cuit: d.cuit || null,
      condicionIva: d.condicionIva as "consumidor_final",
      email: d.email || null,
      telefono: d.telefono || null,
      direccion: d.direccion || null,
      tipo: d.tipo as "particular",
      limiteCredito: d.limiteCredito || "0",
      asesor: d.asesor || null,
      notas: d.notas || null,
      codigoLegacy: d.codigo || null,
      updatedAt: new Date(),
    };

    if (existente) {
      await tx
        .update(customers)
        .set(valores)
        .where(eq(customers.id, existente.id));
      resultado.actualizados++;
    } else {
      await tx.insert(customers).values(valores);
      resultado.creados++;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Productos y medidas                                                         */
/* -------------------------------------------------------------------------- */

async function aplicarProductos(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
  loteId: string,
  userId: string,
) {
  const [listaGeneral] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.isDefault, true))
    .limit(1);

  const [listaProfesional] = await tx
    .select({ id: priceLists.id })
    .from(priceLists)
    .where(eq(priceLists.slug, "profesional"))
    .limit(1);

  for (const fila of filas) {
    const d = fila.datos;

    // Categoría: se busca por slug y si no está, se crea. Rechazar la fila
    // porque falta una categoría obligaría a cargarlas todas a mano antes de
    // migrar, y son las mismas que trae el archivo.
    const slugCategoria = generarSlug(d.categoria);
    let [categoria] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, slugCategoria))
      .limit(1);

    if (!categoria) {
      [categoria] = await tx
        .insert(categories)
        .values({ slug: slugCategoria, name: d.categoria })
        .returning({ id: categories.id });
    }

    // Producto: los renglones con el mismo nombre y la misma categoría son
    // medidas de un mismo producto. Es la forma del archivo de un sistema de
    // escritorio, donde cada medida es un artículo suelto.
    let [producto] = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          sql`lower(${products.name}) = ${comparable(d.nombre)}`,
          eq(products.categoryId, categoria.id),
        ),
      )
      .limit(1);

    if (!producto) {
      [producto] = await tx
        .insert(products)
        .values({
          slug: await slugLibre(tx, generarSlug(d.nombre)),
          name: d.nombre,
          categoryId: categoria.id,
          description: d.descripcion || "",
          brand: d.marca || null,
          unit: d.unidad as "unidad",
          alicuotaIva: d.alicuotaIva || "21",
        })
        .returning({ id: products.id });
    }

    const [variante] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.sku, d.sku))
      .limit(1);

    const medida = {
      productId: producto.id,
      sku: d.sku,
      label: d.medida || d.sku,
      largoMm: d.largoMm ? Number(d.largoMm) : null,
      anchoMm: d.anchoMm ? Number(d.anchoMm) : null,
      espesorMm: d.espesorMm ? Number(d.espesorMm) : null,
      updatedAt: new Date(),
    };

    let varianteId: string;

    if (variante) {
      await tx
        .update(productVariants)
        .set(medida)
        .where(eq(productVariants.id, variante.id));
      varianteId = variante.id;
      resultado.actualizados++;
    } else {
      const [creada] = await tx
        .insert(productVariants)
        .values(medida)
        .returning({ id: productVariants.id });
      varianteId = creada.id;
      resultado.creados++;
    }

    // Los precios entran por el mismo camino que la importación de planillas,
    // con su registro en el historial: el día que alguien pregunte de dónde
    // salió un precio, la respuesta tiene que decir "de la migración".
    for (const [listaId, precio] of [
      [listaGeneral?.id, d.precioGeneral],
      [listaProfesional?.id, d.precioProfesional],
    ] as const) {
      if (!listaId || !precio || Number(precio) <= 0) continue;

      const [previo] = await tx
        .select({ price: priceListItems.price })
        .from(priceListItems)
        .where(
          and(
            eq(priceListItems.variantId, varianteId),
            eq(priceListItems.priceListId, listaId),
          ),
        )
        .limit(1);

      if (previo && Number(previo.price) === Number(precio)) continue;

      await tx
        .insert(priceListItems)
        .values({
          variantId: varianteId,
          priceListId: listaId,
          price: precio,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [priceListItems.priceListId, priceListItems.variantId],
          set: { price: precio, updatedAt: new Date() },
        });

      await tx.insert(priceHistory).values({
        variantId: varianteId,
        priceListId: listaId,
        precioAnterior: previo?.price ?? null,
        precioNuevo: precio,
        origen: "importacion",
        motivo: "Migración desde el sistema anterior",
        loteId,
        createdByUserId: userId,
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Existencias                                                                 */
/* -------------------------------------------------------------------------- */

async function aplicarStock(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
  userId: string,
) {
  const sucursales = await tx
    .select({ id: branches.id, name: branches.name, slug: branches.slug })
    .from(branches);

  for (const fila of filas) {
    const d = fila.datos;

    const [variante] = await tx
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.sku, d.sku))
      .limit(1);

    if (!variante) {
      resultado.conError++;
      resultado.rechazos.push({
        linea: fila.linea,
        identificador: d.sku,
        motivo: "No hay ninguna medida con ese código. Migrá primero los productos.",
      });
      continue;
    }

    const buscada = comparable(d.sucursal);
    const sucursal = sucursales.find(
      (s) =>
        comparable(s.name) === buscada ||
        s.slug === generarSlug(d.sucursal) ||
        comparable(s.name).includes(buscada),
    );

    if (!sucursal) {
      resultado.conError++;
      resultado.rechazos.push({
        linea: fila.linea,
        identificador: `${d.sku} · ${d.sucursal}`,
        motivo: `No existe la sucursal "${d.sucursal}". Creala en Sucursales o corregí el archivo.`,
      });
      continue;
    }

    const cantidad = Number(d.cantidad);
    const minimo = d.minimo ? Number(d.minimo) : null;

    const [actual] = await tx
      .select({ qty: inventory.qty })
      .from(inventory)
      .where(
        and(
          eq(inventory.variantId, variante.id),
          eq(inventory.branchId, sucursal.id),
        ),
      )
      .limit(1);

    const anterior = actual?.qty ?? 0;

    if (actual && anterior === cantidad && minimo === null) {
      resultado.omitidos++;
      continue;
    }

    // El archivo dice cuánto hay, no cuánto entró: la existencia queda en el
    // número del archivo. Por eso volver a correrlo no duplica el stock.
    await tx
      .insert(inventory)
      .values({
        variantId: variante.id,
        branchId: sucursal.id,
        qty: cantidad,
        minQty: minimo ?? 0,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [inventory.variantId, inventory.branchId],
        set: {
          qty: cantidad,
          ...(minimo === null ? {} : { minQty: minimo }),
          updatedAt: new Date(),
        },
      });

    const diferencia = cantidad - anterior;

    if (diferencia !== 0) {
      await tx.insert(inventoryMovements).values({
        variantId: variante.id,
        branchId: sucursal.id,
        type: "ajuste",
        qty: diferencia,
        note: "Existencia inicial migrada del sistema anterior",
        createdByUserId: userId,
      });
    }

    if (actual) resultado.actualizados++;
    else resultado.creados++;
  }
}

/* -------------------------------------------------------------------------- */
/* Saldos de cuenta corriente                                                  */
/* -------------------------------------------------------------------------- */

async function aplicarSaldos(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
  userId: string,
) {
  for (const fila of filas) {
    const d = fila.datos;

    let cliente: { id: string } | undefined;

    if (d.codigo) {
      [cliente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.codigoLegacy, d.codigo))
        .limit(1);
    }

    if (!cliente && d.cuit) {
      [cliente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.cuit, d.cuit))
        .limit(1);
    }

    if (!cliente && d.email) {
      [cliente] = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(sql`lower(${customers.email}) = ${d.email}`)
        .limit(1);
    }

    if (!cliente) {
      resultado.conError++;
      resultado.rechazos.push({
        linea: fila.linea,
        identificador: d.nombre || d.codigo || d.cuit || d.email,
        motivo: "No se encontró la ficha del cliente. Migrá primero los clientes.",
      });
      continue;
    }

    // Idempotencia, y acá es lo que más importa: un saldo cargado dos veces
    // duplica la deuda de una persona real. La corrida se puede repetir; el
    // movimiento, no.
    const [yaMigrado] = await tx
      .select({ id: accountMovements.id })
      .from(accountMovements)
      .where(
        and(
          eq(accountMovements.customerId, cliente.id),
          eq(accountMovements.referencia, REFERENCIA_SALDO),
        ),
      )
      .limit(1);

    if (yaMigrado) {
      resultado.omitidos++;
      continue;
    }

    // Saldo cero: no hay nada que registrar y un movimiento en cero solo
    // ensucia el resumen de cuenta.
    if (Number(d.saldo) === 0) {
      resultado.omitidos++;
      continue;
    }

    await tx.insert(accountMovements).values({
      customerId: cliente.id,
      tipo: "ajuste",
      monto: d.saldo,
      detalle: d.detalle || "Saldo inicial migrado del sistema anterior",
      referencia: REFERENCIA_SALDO,
      createdByUserId: userId,
    });

    resultado.creados++;
  }
}


/* -------------------------------------------------------------------------- */
/* Proveedores                                                                 */
/* -------------------------------------------------------------------------- */

async function aplicarProveedores(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
  userId: string,
) {
  for (const fila of filas) {
    const d = fila.datos;

    // Misma cascada que en clientes: código del sistema viejo, después CUIT,
    // y recién al final el nombre. El código es lo único que sobrevive a que
    // alguien corrija una razón social.
    let proveedor: { id: string } | undefined;

    if (d.codigo) {
      [proveedor] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.codigoLegacy, d.codigo))
        .limit(1);
    }

    if (!proveedor && d.cuit) {
      [proveedor] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.cuit, d.cuit))
        .limit(1);
    }

    if (!proveedor) {
      [proveedor] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(sql`lower(${suppliers.nombre}) = ${comparable(d.nombre)}`)
        .limit(1);
    }

    const campos = {
      nombre: d.nombre,
      razonSocial: d.nombre,
      cuit: d.cuit || null,
      condicionIva: (d.condicionIva ||
        "responsable_inscripto") as "responsable_inscripto",
      email: d.email || null,
      telefono: d.telefono || null,
      direccion: d.direccion || null,
      notas: d.notas || null,
      codigoLegacy: d.codigo || null,
    };

    if (proveedor) {
      await tx.update(suppliers).set(campos).where(eq(suppliers.id, proveedor.id));
      resultado.actualizados++;
    } else {
      const [creado] = await tx
        .insert(suppliers)
        .values(campos)
        .returning({ id: suppliers.id });
      proveedor = creado;
      resultado.creados++;
    }

    // El saldo es opcional y va aparte: la ficha se actualiza siempre, el
    // movimiento se carga una sola vez. Es la misma protección que en los
    // saldos de clientes, y por el mismo motivo —cargarlo dos veces duplica
    // una deuda real—.
    const saldo = Number(d.saldo || "0");
    if (!proveedor || saldo === 0) continue;

    const [yaMigrado] = await tx
      .select({ id: supplierMovements.id })
      .from(supplierMovements)
      .where(
        and(
          eq(supplierMovements.supplierId, proveedor.id),
          eq(supplierMovements.referencia, REFERENCIA_SALDO_PROVEEDOR),
        ),
      )
      .limit(1);

    if (yaMigrado) continue;

    await tx.insert(supplierMovements).values({
      supplierId: proveedor.id,
      tipo: "ajuste",
      monto: d.saldo,
      detalle: "Saldo inicial migrado del sistema anterior",
      referencia: REFERENCIA_SALDO_PROVEEDOR,
      createdByUserId: userId,
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Archivo histórico                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Busca la ficha del cliente sin frenar la fila si no aparece.
 *
 * En el histórico, a diferencia de los saldos, que un cliente no exista no es
 * motivo para rechazar la venta: el sistema viejo tiene bajas y fusiones que
 * la cartera actual ya no refleja. La venta se guarda igual con el nombre y el
 * código, que es lo que después permite reconciliarla a mano.
 */
async function fichaDelCliente(
  tx: Tx,
  codigo: string,
  cuit: string,
): Promise<string | null> {
  if (codigo) {
    const [porCodigo] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.codigoLegacy, codigo))
      .limit(1);
    if (porCodigo) return porCodigo.id;
  }

  if (cuit) {
    const [porCuit] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.cuit, cuit))
      .limit(1);
    if (porCuit) return porCuit.id;
  }

  return null;
}

async function aplicarVentasHistoricas(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
) {
  for (const fila of filas) {
    const d = fila.datos;
    const customerId = await fichaDelCliente(tx, d.codigoCliente, "");

    if (!customerId && d.codigoCliente) {
      fila.avisos.push("No se encontró la ficha del cliente: la venta queda sin asociar.");
    }

    const valores = {
      comprobanteLegacy: d.comprobante,
      codigoClienteLegacy: d.codigoCliente || null,
      customerId,
      clienteNombre: d.clienteNombre || "",
      fecha: new Date(d.fecha),
      total: d.total,
      detalle: d.detalle || "",
      sucursal: d.sucursal || null,
      vendedor: d.vendedor || null,
    };

    const [{ inserted } = { inserted: false }] = await tx
      .insert(historicalSales)
      .values(valores)
      .onConflictDoUpdate({
        target: historicalSales.comprobanteLegacy,
        set: valores,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    if (inserted) resultado.creados++;
    else resultado.actualizados++;
  }
}

async function aplicarComprobantesHistoricos(
  tx: Tx,
  filas: FilaNormalizada[],
  resultado: ResultadoLote,
) {
  for (const fila of filas) {
    const d = fila.datos;
    const customerId = await fichaDelCliente(tx, d.codigoCliente, d.clienteCuit);

    const valores = {
      puntoVenta: Number(d.puntoVenta),
      tipo: d.tipo,
      numero: Number(d.numero),
      codigoClienteLegacy: d.codigoCliente || null,
      customerId,
      clienteNombre: d.clienteNombre || "",
      clienteCuit: d.clienteCuit || null,
      fecha: new Date(d.fecha),
      neto: d.neto || "0",
      iva: d.iva || "0",
      total: d.total,
      cae: d.cae || null,
      caeVence: d.caeVence ? new Date(d.caeVence) : null,
    };

    const [{ inserted } = { inserted: false }] = await tx
      .insert(historicalInvoices)
      .values(valores)
      .onConflictDoUpdate({
        target: [
          historicalInvoices.puntoVenta,
          historicalInvoices.tipo,
          historicalInvoices.numero,
        ],
        set: valores,
      })
      .returning({ inserted: sql<boolean>`(xmax = 0)` });

    if (inserted) resultado.creados++;
    else resultado.actualizados++;
  }
}

/* -------------------------------------------------------------------------- */
/* Entrada                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Aplica un lote. Las filas con error de lectura ni siquiera llegan a la base:
 * se cuentan y se listan.
 */
export async function aplicarLote(
  entidad: ClaveEntidad,
  filas: FilaNormalizada[],
  opciones: { loteId: string; userId: string },
): Promise<ResultadoLote> {
  const resultado = vacio();

  const validas = filas.filter((fila) => {
    if (fila.errores.length === 0) return true;
    resultado.conError++;
    resultado.rechazos.push({
      linea: fila.linea,
      identificador:
        fila.datos.sku || fila.datos.codigo || fila.datos.nombre || "—",
      motivo: fila.errores.join(" "),
    });
    return false;
  });

  if (validas.length === 0) return resultado;

  await db.transaction(async (tx) => {
    switch (entidad) {
      case "clientes":
        return aplicarClientes(tx, validas, resultado);
      case "productos":
        return aplicarProductos(tx, validas, resultado, opciones.loteId, opciones.userId);
      case "stock":
        return aplicarStock(tx, validas, resultado, opciones.userId);
      case "saldos":
        return aplicarSaldos(tx, validas, resultado, opciones.userId);
      case "proveedores":
        return aplicarProveedores(tx, validas, resultado, opciones.userId);
      case "ventas_historicas":
        return aplicarVentasHistoricas(tx, validas, resultado);
      case "comprobantes_historicos":
        return aplicarComprobantesHistoricos(tx, validas, resultado);
    }
  });

  return resultado;
}

/* -------------------------------------------------------------------------- */
/* Informe de integridad                                                       */
/* -------------------------------------------------------------------------- */

export interface Control {
  titulo: string;
  detalle: string;
  segunElArchivo: string;
  enElSistema: string;
  ok: boolean;
}

/**
 * Contrasta lo que decía el archivo contra lo que quedó en la base.
 *
 * Es el control que importa y el que no hace ninguna barra de progreso: los
 * contadores de la corrida dicen cuántas filas se procesaron, pero no si el
 * total cierra. En saldos de cuenta corriente esa diferencia es plata de
 * alguien.
 */
export async function informeDeIntegridad(
  entidad: ClaveEntidad,
  filas: FilaNormalizada[],
): Promise<Control[]> {
  const validas = filas.filter((f) => f.errores.length === 0);

  if (entidad === "saldos") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.saldo), 0);

    const [{ total = "0", cuantos = 0 } = {}] = await db
      .select({
        total: sql<string>`coalesce(sum(${accountMovements.monto}), 0)`,
        cuantos: sql<number>`count(*)::int`,
      })
      .from(accountMovements)
      .where(eq(accountMovements.referencia, REFERENCIA_SALDO));

    // El total del archivo se cuenta entero, incluidas las filas que no
    // encontraron ficha. Descontarlas haría que el control diga "cuadra"
    // justo cuando falta plata, que es lo único que este control existe para
    // no dejar pasar.
    const conSaldo = validas.filter((f) => Number(f.datos.saldo) !== 0).length;

    return [
      {
        titulo: "Suma de los saldos",
        detalle:
          "El archivo entero contra todo lo migrado hasta ahora. Si no da igual, hay filas que no entraron y la diferencia es deuda de alguien: está en el listado de abajo. Migrando en varias partes, el número del sistema va a ser mayor.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) + 0.01 >= esperado,
      },
      {
        titulo: "Clientes con saldo inicial",
        detalle:
          "Sin contar los que venían en cero, que no generan movimiento porque un movimiento en cero solo ensucia el resumen de cuenta.",
        segunElArchivo: String(conSaldo),
        enElSistema: String(cuantos),
        ok: cuantos >= conSaldo,
      },
    ];
  }

  if (entidad === "clientes") {
    const codigos = new Set(
      validas.map((f) => f.datos.codigo).filter((c) => c !== ""),
    );

    const [{ cuantos = 0 } = {}] = await db
      .select({ cuantos: sql<number>`count(*)::int` })
      .from(customers)
      .where(isNotNull(customers.codigoLegacy));

    const sinCuit = validas.filter((f) => !f.datos.cuit).length;

    return [
      {
        titulo: "Fichas con código del sistema anterior",
        detalle:
          "Si el archivo trae códigos repetidos, este número va a ser menor: dos filas con el mismo código son la misma ficha.",
        segunElArchivo: String(codigos.size),
        enElSistema: String(cuantos),
        ok: cuantos >= codigos.size,
      },
      {
        titulo: "Fichas sin CUIT",
        detalle:
          "No es un error —media cartera son consumidores finales—, pero a esos no se les puede emitir factura A.",
        segunElArchivo: String(sinCuit),
        enElSistema: "—",
        ok: true,
      },
    ];
  }

  if (entidad === "proveedores") {
    const conSaldo = validas.filter((f) => Number(f.datos.saldo || 0) !== 0);
    const esperado = conSaldo.reduce((suma, f) => suma + Number(f.datos.saldo), 0);

    const [{ fichas = 0 } = {}] = await db
      .select({ fichas: sql<number>`count(*)::int` })
      .from(suppliers)
      .where(isNotNull(suppliers.codigoLegacy));

    const [{ total = "0" } = {}] = await db
      .select({ total: sql<string>`coalesce(sum(${supplierMovements.monto}), 0)` })
      .from(supplierMovements)
      .where(eq(supplierMovements.referencia, REFERENCIA_SALDO_PROVEEDOR));

    return [
      {
        titulo: "Proveedores con código del sistema anterior",
        detalle: "Los que se pueden volver a actualizar subiendo el archivo de nuevo.",
        segunElArchivo: String(validas.filter((f) => f.datos.codigo).length),
        enElSistema: String(fichas),
        ok: fichas >= validas.filter((f) => f.datos.codigo).length,
      },
      {
        titulo: "Suma de los saldos",
        detalle:
          "Tiene que dar igual. Una diferencia es un proveedor cuyo saldo no se cargó, y eso no lo muestra ningún contador de filas.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Math.abs(esperado - Number(total)) < 0.01,
      },
    ];
  }

  if (entidad === "ventas_historicas") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.total), 0);
    const sinFicha = validas.filter((f) => !f.datos.codigoCliente).length;

    const [{ cuantas = 0, total = "0" } = {}] = await db
      .select({
        cuantas: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${historicalSales.total}), 0)`,
      })
      .from(historicalSales);

    return [
      {
        titulo: "Ventas en el archivo histórico",
        detalle: "Puede ser mayor si ya se subieron otros años.",
        segunElArchivo: String(validas.length),
        enElSistema: String(cuantas),
        ok: cuantas >= validas.length,
      },
      {
        titulo: "Suma de los totales",
        detalle:
          "El del sistema incluye las corridas anteriores; el del archivo, solo esta.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) >= esperado - 0.01,
      },
      {
        titulo: "Ventas sin código de cliente",
        detalle:
          "Quedan en el histórico pero no aparecen en la ficha de nadie. Se reconcilian a mano.",
        segunElArchivo: String(sinFicha),
        enElSistema: "—",
        ok: sinFicha === 0,
      },
    ];
  }

  if (entidad === "comprobantes_historicos") {
    const esperado = validas.reduce((suma, f) => suma + Number(f.datos.total), 0);
    const sinCae = validas.filter((f) => !f.datos.cae).length;

    const [{ cuantos = 0, total = "0" } = {}] = await db
      .select({
        cuantos: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${historicalInvoices.total}), 0)`,
      })
      .from(historicalInvoices);

    return [
      {
        titulo: "Comprobantes en el archivo histórico",
        detalle: "Puede ser mayor si ya se subieron otros períodos.",
        segunElArchivo: String(validas.length),
        enElSistema: String(cuantos),
        ok: cuantos >= validas.length,
      },
      {
        titulo: "Suma de los totales",
        detalle: "Es la cifra que el estudio contable va a querer cruzar.",
        segunElArchivo: esperado.toFixed(2),
        enElSistema: Number(total).toFixed(2),
        ok: Number(total) >= esperado - 0.01,
      },
      {
        titulo: "Comprobantes sin CAE",
        detalle:
          "Se guardan igual, pero un comprobante autorizado que llegó sin CAE es una columna que faltó mapear.",
        segunElArchivo: String(sinCae),
        enElSistema: "—",
        ok: sinCae === 0,
      },
    ];
  }

  if (entidad === "productos") {
    const skus = new Set(validas.map((f) => f.datos.sku));

    const [{ cuantos = 0 } = {}] = await db
      .select({ cuantos: sql<number>`count(*)::int` })
      .from(productVariants);

    const sinPrecio = validas.filter(
      (f) => Number(f.datos.precioGeneral || 0) <= 0,
    ).length;

    return [
      {
        titulo: "Códigos distintos en el archivo",
        detalle: "Contra el total de medidas cargadas en el catálogo.",
        segunElArchivo: String(skus.size),
        enElSistema: String(cuantos),
        ok: cuantos >= skus.size,
      },
      {
        titulo: "Medidas sin precio de lista",
        detalle: "No se pueden vender por la tienda hasta que tengan precio.",
        segunElArchivo: String(sinPrecio),
        enElSistema: "—",
        ok: sinPrecio === 0,
      },
    ];
  }

  const unidades = validas.reduce((suma, f) => suma + Number(f.datos.cantidad), 0);

  const [{ total = 0 } = {}] = await db
    .select({ total: sql<number>`coalesce(sum(${inventory.qty}), 0)::int` })
    .from(inventory);

  return [
    {
      titulo: "Unidades en existencia",
      detalle:
        "El total del sistema puede ser mayor: incluye lo que ya estaba cargado en medidas que el archivo no menciona.",
      segunElArchivo: String(unidades),
      enElSistema: String(total),
      ok: total >= unidades,
    },
  ];
}
