import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  accountMovements,
  cashMovements,
  cashSessions,
  inventory,
  inventoryMovements,
  orderItems,
  orders,
  payments,
} from "@/lib/db/schema";
import {
  aCentavos,
  aplicarDescuento,
  revisarVenta,
  totalDeLaVenta,
  type LineaDeVenta,
  type MedioDeMostrador,
} from "./importes";

export type { LineaDeVenta, MedioDeMostrador };

/**
 * La única función que registra una venta de mostrador.
 *
 * Es hermana de `acreditarPago` y no la misma por una razón concreta: aquella
 * atiende cobros remotos, donde el que avisa es un proveedor y el riesgo es que
 * mienta o repita el aviso. Acá la plata está en la mano de quien atiende, no
 * hay proveedor que verificar, y el riesgo es otro y muy físico: **la doble
 * mano**. Se toca "Cobrar", la pantalla tarda, se vuelve a tocar, y salen dos
 * pedidos, se descuenta dos veces el stock y se le cobra dos veces a alguien
 * que está parado del otro lado del mostrador.
 *
 * De ahí que todo lo demás cuelgue de una idea: **una venta es una sola cosa, o
 * pasa entera o no pasa.** Todo va en una transacción, y la clave que trae la
 * pantalla la hace repetible sin consecuencias.
 *
 * Tres decisiones que no son obvias:
 *
 * 1. **El stock puede quedar negativo y la venta igual se hace.** La mercadería
 *    está ahí, sobre el mostrador; si el sistema dice que no hay, el que está
 *    mal es el sistema. Trabar la venta para cuidar un número mandaría al
 *    cliente a la competencia y dejaría el número igual de mal. Queda el
 *    movimiento de stock, que es lo que después permite encontrar el error.
 *
 * 2. **Efectivo exige turno de caja abierto.** Sin turno no hay dónde anotar la
 *    plata, y una venta en efectivo que no cae en ninguna caja es exactamente
 *    el agujero que la caja existe para tapar.
 *
 * 3. **Cuenta corriente no es un cobro.** La mercadería sale, la plata no
 *    entró: va como deuda al libro del cliente y el pedido queda con el pago
 *    pendiente. Anotarla como cobrada mostraría plata que no está.
 */

export interface VentaDeMostrador {
  /** La genera el navegador al empezar la venta. Es lo que la hace repetible. */
  clave: string;
  branchId: string;
  lineas: LineaDeVenta[];
  customerId: string | null;
  contactoNombre: string;
  contactoTelefono?: string | null;
  medioPago: MedioDeMostrador;
  /** Descuento pedido, en plata. Lo que se aplica puede diferir por centavos. */
  descuento?: number;
  descuentoMotivo?: string | null;
  notas?: string | null;
  usuarioId: string;
}

export interface ResultadoVenta {
  ok: true;
  orderId: string;
  numero: string;
  total: number;
  /** Falso cuando la clave ya existía: se devuelve la venta que ya se hizo. */
  nueva: boolean;
  /**
   * Las líneas tal como quedaron, con el descuento ya repartido. El comprobante
   * tiene que emitirse con estas y no con las de entrada: si no, la factura
   * diría el precio de lista sobre una venta que se cobró con rebaja.
   */
  lineas: LineaDeVenta[];
}

export interface FalloVenta {
  ok: false;
  error: string;
}

export async function registrarVentaDeMostrador(
  venta: VentaDeMostrador,
): Promise<ResultadoVenta | FalloVenta> {
  // Las reglas y la aritmética viven en `importes.ts`, sin base de datos, que
  // es lo que permite probarlas. Se revisan igual acá y no solo en la pantalla:
  // una acción de servidor es una dirección pública, y confiar en que el
  // formulario ya validó es confiar en el navegador de otro.
  const problema = revisarVenta(venta.lineas, venta.medioPago, venta.customerId);
  if (problema) return { ok: false, error: problema };

  /*
   * El descuento se reparte entre las líneas y no va como renglón aparte: la
   * base imponible de la factura tiene que reflejar lo que se cobró por cada
   * cosa. Las líneas que se guardan ya son las rebajadas, así que el pedido, el
   * comprobante y el ticket parten todos del mismo número.
   *
   * `subtotal` guarda lo que valía antes del descuento, que es lo que el ticket
   * necesita para poder mostrarlo.
   */
  const subtotal = totalDeLaVenta(venta.lineas);
  const { lineas, descuento } = aplicarDescuento(
    venta.lineas,
    venta.descuento ?? 0,
  );
  const total = totalDeLaVenta(lineas);

  return db.transaction(async (tx) => {
    /*
     * El lock serializa los envíos repetidos de la misma venta. Sin él, dos
     * toques simultáneos leen los dos que la clave no existe y los dos siguen;
     * el índice único frenaría al segundo, pero recién al insertar, después de
     * haber descontado stock. Se libera al cerrar la transacción.
     */
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${venta.clave}))`,
    );

    const [yaHecha] = await tx
      .select({
        id: orders.id,
        numero: orders.numero,
        total: orders.total,
      })
      .from(orders)
      .where(eq(orders.claveMostrador, venta.clave))
      .limit(1);

    if (yaHecha) {
      return {
        ok: true as const,
        orderId: yaHecha.id,
        numero: yaHecha.numero,
        total: Number(yaHecha.total),
        nueva: false,
        lineas,
      };
    }

    let sesionId: string | null = null;

    if (venta.medioPago === "efectivo") {
      const [turno] = await tx
        .select({ id: cashSessions.id })
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.branchId, venta.branchId),
            eq(cashSessions.estado, "abierta"),
          ),
        )
        .limit(1);

      if (!turno) {
        return {
          ok: false as const,
          error: "No hay caja abierta en esta sucursal. Abrila antes de cobrar en efectivo.",
        };
      }
      sesionId = turno.id;
    }

    const [{ maximo }] = await tx
      .select({
        maximo: sql<number>`coalesce(max(nullif(regexp_replace(${orders.numero}, '\\D', '', 'g'), '')::bigint), 999)::int`,
      })
      .from(orders);

    const numero = `PED-${maximo + 1}`;
    const aCuenta = venta.medioPago === "cuenta_corriente";

    const [pedido] = await tx
      .insert(orders)
      .values({
        numero,
        claveMostrador: venta.clave,
        customerId: venta.customerId,
        contactoNombre: venta.contactoNombre,
        contactoTelefono: venta.contactoTelefono ?? null,
        branchId: venta.branchId,
        // Se cobra y se lleva: el pedido nace entregado. Pasarlo por "pendiente"
        // y "listo" sería inventar un recorrido que en el mostrador no existe.
        estado: "entregado",
        origen: "mostrador",
        tipoEntrega: "retiro",
        subtotal: subtotal.toFixed(2),
        descuento: descuento.toFixed(2),
        descuentoMotivo: descuento > 0 ? (venta.descuentoMotivo ?? null) : null,
        total: total.toFixed(2),
        medioPago: venta.medioPago,
        estadoPago: aCuenta ? "pendiente" : "pagado",
        notas: venta.notas ?? null,
        createdByUserId: venta.usuarioId,
      })
      .returning({ id: orders.id });

    await tx.insert(orderItems).values(
      lineas.map((l, i) => ({
        orderId: pedido.id,
        variantId: l.variantId,
        descripcion: l.descripcion,
        unidad: l.unidad,
        cantidad: l.cantidad.toFixed(2),
        precioUnitario: l.precioUnitario.toFixed(2),
        subtotal: aCentavos(l.cantidad * l.precioUnitario).toFixed(2),
        orden: i,
      })),
    );

    // Stock: solo las líneas que apuntan a una variante. Un flete o una
    // diferencia de precio no descuentan nada de ningún estante.
    for (const l of lineas) {
      if (!l.variantId) continue;
      const unidades = Math.round(l.cantidad);
      if (unidades <= 0) continue;

      await tx
        .update(inventory)
        .set({ qty: sql`${inventory.qty} - ${unidades}`, updatedAt: new Date() })
        .where(
          and(
            eq(inventory.variantId, l.variantId),
            eq(inventory.branchId, venta.branchId),
          ),
        );

      await tx.insert(inventoryMovements).values({
        variantId: l.variantId,
        branchId: venta.branchId,
        type: "venta",
        qty: -unidades,
        note: `Mostrador ${numero}`,
        createdByUserId: venta.usuarioId,
      });
    }

    if (sesionId) {
      await tx.insert(cashMovements).values({
        sessionId: sesionId,
        tipo: "venta",
        monto: total.toFixed(2),
        motivo: numero,
        orderId: pedido.id,
        creadoPor: venta.usuarioId,
      });
    }

    if (aCuenta && venta.customerId) {
      // Positivo es lo que el cliente debe, igual que en el resto del libro.
      await tx.insert(accountMovements).values({
        customerId: venta.customerId,
        tipo: "compra",
        monto: total.toFixed(2),
        detalle: `Venta de mostrador ${numero}`,
        referencia: numero,
        createdByUserId: venta.usuarioId,
      });
    } else {
      // La plata entró: queda anotada donde se mira la plata que entró, sin
      // importar por qué canal.
      await tx.insert(payments).values({
        orderId: pedido.id,
        customerId: venta.customerId,
        tipo: "pedido",
        proveedor: "mostrador",
        medio: venta.medioPago,
        monto: total.toFixed(2),
        estado: "aprobado",
        conciliadoPor: venta.usuarioId,
        conciliadoAt: new Date(),
        createdByUserId: venta.usuarioId,
      });
    }

    return {
      ok: true as const,
      orderId: pedido.id,
      numero,
      total,
      nueva: true,
      lineas,
    };
  });
}
