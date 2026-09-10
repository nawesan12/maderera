import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { siguienteNumeroDePedido } from "@/lib/dal/numeracion-ventas";
import { fechaAcotada } from "@/lib/mostrador/offline/numero-provisorio";
import { turnoQueContiene } from "@/lib/mostrador/turno";
import { costosParaCongelar } from "@/lib/compras/congelar";
import {
  accountMovements,
  cashMovements,
  customers,
  inventory,
  inventoryMovements,
  orderItems,
  orderPayments,
  orders,
  payments,
} from "@/lib/db/schema";
import { reservarPedido } from "@/lib/inventario/reservas";
import {
  aCentavos,
  aplicarDescuento,
  importePorMedio,
  medioPrincipal,
  normalizarPagos,
  revisarPagos,
  revisarVenta,
  totalDeLaVenta,
  type LineaDeVenta,
  type MedioDeMostrador,
  type PagoDeVenta,
} from "./importes";
import { escalasDePago } from "@/lib/dal/descuentos-pago";
import { estadoDeCredito } from "@/lib/dal/credito";
import {
  descuentoPorMedioDePago,
  medioPermitido,
  montoDelDescuentoDePago,
} from "@/lib/precios/medio-pago";
import { listaDelCliente } from "@/lib/mostrador/buscar";

export type { LineaDeVenta, MedioDeMostrador, PagoDeVenta };

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
  /**
   * Cómo se pagó, renglón por renglón, con lote y cupón para las tarjetas.
   *
   * Vacío o ausente significa "todo por `medioPago`", que es como cobran las
   * ventas viejas y las de la cola sin conexión. Si viene, la suma tiene que
   * dar el total al centavo y `medioPago` pasa a ser el de mayor importe.
   */
  pagos?: PagoDeVenta[];
  /**
   * La venta queda en acopio: se cobra y la mercadería no se lleva.
   *
   * El pedido nace "listo" en vez de "entregado", el stock se **reserva** en
   * lugar de descontarse, y los retiros parciales salen después con sus
   * remitos, que es el circuito de acopio que ya existe.
   */
  acopio?: boolean;
  /** Descuento pedido, en plata. Lo que se aplica puede diferir por centavos. */
  descuento?: number;
  descuentoMotivo?: string | null;
  notas?: string | null;
  usuarioId: string;
  /**
   * El vendedor confirmó que va igual, pese al aviso de cuenta corriente.
   *
   * Llega del navegador y eso está bien: es la decisión de una persona que
   * está mirando la pantalla, no un dato que el sistema pueda deducir. Lo que
   * no puede hacer es saltear un bloqueo no autorizable —una cuenta que nunca
   * existió—, y eso se decide en el servidor.
   */
  autorizado?: boolean;

  /* ---- Solo para las ventas que se hicieron sin conexión ---- */

  /** El número que ya se llevó el cliente, del estilo `CAJA1-017`. */
  numeroProvisorio?: string | null;

  /**
   * La hora real del mostrador.
   *
   * Se acota antes de escribirla: de esta fecha salen las ventas del día y el
   * cierre de caja, y un reloj mal puesto mandaría la venta a un día donde
   * nadie la va a buscar.
   */
  cobradaAt?: Date | null;
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
  /**
   * El fallo se puede saltear con la confirmación de un vendedor.
   *
   * La pantalla lo usa para ofrecer "seguir igual" en vez de un callejón sin
   * salida. Va aparte del mensaje porque no todo bloqueo es autorizable: un
   * cliente sin cuenta corriente habilitada no se destraba confirmando.
   */
  requiereAutorizacion?: boolean;
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
   * El precio de profesional es de contado.
   *
   * De la clienta: con transferencia o débito, nunca en cuotas. Acá el chequeo
   * no se puede hacer en `importes.ts` porque depende de qué lista tiene el
   * cliente, que es una consulta.
   *
   * No hay válvula de autorización como en la cuenta corriente, y a propósito:
   * la salida existe y es más simple: se cobra a consumidor final, que es
   * precio de catálogo, que es exactamente lo que la regla dice que corresponde
   * cuando se paga de otra forma.
   */
  if (venta.customerId) {
    const lista = await listaDelCliente(venta.customerId);
    const diferenciada = lista.id !== null && lista.id !== lista.generalId;

    // Con pago partido, **cada** medio tiene que estar permitido: pagar la
    // mitad con crédito es pagar con crédito.
    const medios = [
      venta.medioPago,
      ...(venta.pagos ?? []).map((p) => p.medio),
    ];
    if (diferenciada && medios.some((m) => !medioPermitido(m, true))) {
      return {
        ok: false,
        error:
          "Este cliente tiene precio de profesional, que es de contado. Cobrá por " +
          "transferencia, débito o efectivo, o pasá la venta a consumidor final.",
      };
    }
  }

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

  /*
   * El descuento por forma de pago se resuelve acá, en el servidor, contra la
   * base. La pantalla ya lo mostró —y lo muestra igual sin conexión, con la
   * copia que baja `/api/mostrador/config`—, pero el número que vale es este:
   * una caja que estuvo tres días sin conectarse tiene la escala de hace tres
   * días.
   *
   * **Un descuento tipeado a mano gana sobre el automático.** Si el vendedor
   * escribió un número es porque negoció algo puntual, y pisárselo con la
   * escala general sería discutir con quien tiene al cliente enfrente. Lo que
   * no se hace nunca es sumar los dos: eso convierte un 10 % pactado en un
   * 20 % accidental.
   */
  const pedido = venta.descuento ?? 0;
  const escala = descuentoPorMedioDePago(
    await escalasDePago(),
    venta.medioPago,
    subtotal,
  );
  const automatico = escala
    ? montoDelDescuentoDePago(subtotal, escala.porcentaje)
    : 0;

  const aDescontar = pedido > 0 ? pedido : automatico;
  const motivoAutomatico =
    pedido > 0 ? null : (escala?.etiqueta || null);

  const { lineas, descuento } = aplicarDescuento(venta.lineas, aDescontar);
  const total = totalDeLaVenta(lineas);

  /*
   * Cómo se pagó, en su forma única. Una venta sin detalle de pagos —las
   * viejas, las de la cola sin conexión— es un solo pago por el total.
   */
  const pagos = normalizarPagos(venta.pagos, venta.medioPago, total);
  const problemaDePagos = revisarPagos(pagos, total, venta.customerId);
  if (problemaDePagos) return { ok: false, error: problemaDePagos };

  const medioPago = medioPrincipal(pagos);
  const parteEfectivo = importePorMedio(pagos, "efectivo");
  const parteCuenta = importePorMedio(pagos, "cuenta_corriente");

  /*
   * Cuenta corriente: límite y mora.
   *
   * Hasta acá el mostrador solo exigía que hubiera un cliente elegido. Un
   * cliente con la cuenta vencida podía seguir llevando mercadería a cuenta
   * indefinidamente, que es exactamente lo que el brief pide frenar.
   *
   * `autorizado` es la válvula: hay alguien esperando del otro lado del
   * mostrador y la decisión de vender igual es del negocio, no del sistema.
   * Lo que el sistema garantiza es que nadie lo haga **sin enterarse**.
   *
   * Con pago partido se evalúa solo la parte que va al libro: lo que se pagó
   * de contado no es deuda.
   */
  if (parteCuenta > 0 && venta.customerId) {
    const credito = await estadoDeCredito(venta.customerId, parteCuenta);

    if (!credito.puede && !(venta.autorizado && credito.autorizable)) {
      return {
        ok: false,
        error: credito.motivo ?? "No se puede cargar a cuenta corriente.",
        requiereAutorizacion: credito.autorizable,
      };
    }
  }

  // El vendedor asignado a la ficha: la venta del mostrador de un cliente de
  // cartera sigue siendo una venta de su vendedor.
  let sellerId: string | null = null;
  if (venta.customerId) {
    const [ficha] = await db
      .select({ sellerId: customers.sellerId })
      .from(customers)
      .where(eq(customers.id, venta.customerId))
      .limit(1);
    sellerId = ficha?.sellerId ?? null;
  }

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
    const diferida = Boolean(venta.cobradaAt);

    if (parteEfectivo > 0) {
      /*
       * El turno se busca por el momento del cobro, no por cuál está abierto
       * ahora: una venta hecha sin internet a las 19:40 pertenece al turno de
       * las 19:40, aunque llegue al servidor después del cierre.
       */
      const turno = await turnoQueContiene(
        tx,
        venta.branchId,
        venta.cobradaAt ? fechaAcotada(venta.cobradaAt) : new Date(),
      );

      if (!turno && !diferida) {
        return {
          ok: false as const,
          error: "No hay caja abierta en esta sucursal. Abrila antes de cobrar en efectivo.",
        };
      }

      /*
       * Una venta diferida sin turno donde caer **se guarda igual**. Rechazarla
       * sería perder plata que ya se cobró y mercadería que ya se llevaron, por
       * un turno que nadie abrió. Queda sin movimiento de caja y `/admin/caja`
       * la muestra aparte para asignarla a mano.
       */
      sesionId = turno?.id ?? null;
    }

    // Con lock sobre la serie: dos cajas cobrando a la vez leían el mismo
    // máximo y la segunda moría contra el índice único, con el cliente enfrente.
    const numero = await siguienteNumeroDePedido(tx);

    const [pedido] = await tx
      .insert(orders)
      .values({
        numero,
        claveMostrador: venta.clave,
        numeroProvisorio: venta.numeroProvisorio ?? null,
        cobradaAt: venta.cobradaAt ?? null,
        // `null` significa que nació en línea; las diferidas llevan la marca.
        sincronizadaAt: venta.cobradaAt ? new Date() : null,
        /*
         * La fecha de la venta es la del mostrador, acotada.
         *
         * `ventasDeHoy` y el cierre de caja filtran por `createdAt`: si la
         * conexión vuelve al otro día, las ventas de ayer aparecerían como de
         * hoy y la caja no cerraría.
         */
        createdAt: venta.cobradaAt
          ? fechaAcotada(venta.cobradaAt)
          : undefined,
        customerId: venta.customerId,
        contactoNombre: venta.contactoNombre,
        contactoTelefono: venta.contactoTelefono ?? null,
        branchId: venta.branchId,
        /*
         * Se cobra y se lleva: el pedido nace entregado. La excepción es el
         * acopio, que nace "listo": la mercadería queda en el depósito
         * esperando los retiros, y cada retiro sale con su remito.
         */
        estado: venta.acopio ? "listo" : "entregado",
        origen: "mostrador",
        tipoEntrega: "retiro",
        subtotal: subtotal.toFixed(2),
        descuento: descuento.toFixed(2),
        descuentoMotivo:
          descuento > 0
            ? (venta.descuentoMotivo ?? motivoAutomatico)
            : null,
        total: total.toFixed(2),
        medioPago,
        /*
         * Lo que fue a cuenta corriente sigue debiéndose: todo a cuenta es
         * "pendiente", una parte es "parcial", nada es "pagado".
         */
        estadoPago:
          parteCuenta >= total - 0.009
            ? "pendiente"
            : parteCuenta > 0
              ? "parcial"
              : "pagado",
        sellerId,
        notas: venta.notas ?? null,
        createdByUserId: venta.usuarioId,
      })
      .returning({ id: orders.id });

    // El detalle de cómo se pagó, con lote y cupón. Siempre, aun con un solo
    // pago: el cierre Z y la conciliación leen de acá.
    await tx.insert(orderPayments).values(
      pagos.map((p) => ({
        orderId: pedido.id,
        medio: p.medio,
        importe: p.importe.toFixed(2),
        nroLote: p.nroLote || null,
        nroCupon: p.nroCupon || null,
        tarjeta: p.tarjeta || null,
      })),
    );

    /*
     * El costo se congela en la línea, igual que el precio. El promedio
     * ponderado se mueve con cada recepción: leer el de hoy para calcular el
     * margen de una venta vieja lo reescribiría cada vez que llega un camión.
     */
    const costos = await costosParaCongelar(
      tx,
      lineas.map((l) => l.variantId).filter((v): v is string => Boolean(v)),
    );

    await tx.insert(orderItems).values(
      lineas.map((l, i) => {
        const costo = l.variantId ? costos.get(l.variantId) : undefined;
        return {
          orderId: pedido.id,
          variantId: l.variantId,
          descripcion: l.descripcion,
          unidad: l.unidad,
          cantidad: l.cantidad.toFixed(2),
          precioUnitario: l.precioUnitario.toFixed(2),
          subtotal: aCentavos(l.cantidad * l.precioUnitario).toFixed(2),
          costoUnitario: costo?.costoUnitario ?? null,
          alicuotaIva: costo?.alicuotaIva ?? null,
          orden: i,
        };
      }),
    );

    if (venta.acopio) {
      /*
       * En acopio la mercadería no sale: se **reserva**, con la misma función
       * que usa un pedido confirmado. El movimiento `venta` lo genera cada
       * retiro parcial, que es cuando de verdad cruza la puerta.
       */
      await reservarPedido(tx, pedido.id);
    } else {
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
    }

    if (sesionId && parteEfectivo > 0) {
      // Al cajón entra solo la parte en efectivo: en una venta partida, lo que
      // fue por débito no está en la caja y el arqueo no lo puede esperar.
      await tx.insert(cashMovements).values({
        sessionId: sesionId,
        tipo: "venta",
        monto: parteEfectivo.toFixed(2),
        motivo: numero,
        orderId: pedido.id,
        creadoPor: venta.usuarioId,
        // La misma fecha que el pedido: si el movimiento dijera la hora de la
        // sincronización, el listado del turno tendría la plata ordenada por
        // cuándo volvió el wifi.
        createdAt: venta.cobradaAt ? fechaAcotada(venta.cobradaAt) : undefined,
      });
    }

    if (parteCuenta > 0 && venta.customerId) {
      // Positivo es lo que el cliente debe, igual que en el resto del libro.
      await tx.insert(accountMovements).values({
        customerId: venta.customerId,
        tipo: "compra",
        monto: parteCuenta.toFixed(2),
        detalle: `Venta de mostrador ${numero}`,
        referencia: numero,
        createdByUserId: venta.usuarioId,
      });
    }

    // La plata que entró queda anotada donde se mira la plata que entró, sin
    // importar por qué canal. Un renglón por cada pago que no sea deuda.
    for (const pago of pagos) {
      if (pago.medio === "cuenta_corriente") continue;
      await tx.insert(payments).values({
        orderId: pedido.id,
        customerId: venta.customerId,
        tipo: "pedido",
        proveedor: "mostrador",
        medio: pago.medio,
        monto: pago.importe.toFixed(2),
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
