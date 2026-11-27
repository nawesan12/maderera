/*
 * La venta sin conexión: el latido, la caja de esta máquina, la cola y el
 * cobro que se guarda acá para subir después.
 *
 * Todo lo que toca la cola de ventas del mostrador vive en este módulo. La
 * pantalla solo llama a `useColaDelMostrador` y a `cobrarSinConexion`.
 */

import { useCallback, useEffect, useRef } from "react";
import { formatearMonto } from "@/lib/formato";
import {
  revisarVenta,
  totalDeLaVenta,
  type LineaDeVenta,

  type MedioDeMostrador,
  type PagoDeVenta,
} from "@/lib/mostrador/importes";
import { encolarVenta } from "@/lib/mostrador/offline/cola";
import { cuentaSinConexion } from "@/lib/mostrador/cuenta-sin-conexion";
import { paraCobrar } from "@/lib/mostrador/cortes-de-la-venta";
import type { CorteDeMostrador } from "@/lib/mostrador/tipos";
import { numeroProvisorio } from "@/lib/mostrador/offline/numero-provisorio";
import { useCaja } from "@/lib/mostrador/offline/use-caja";
import { useCola } from "@/lib/mostrador/offline/use-cola";
import { useConexion, type InformeDeCaja } from "@/lib/mostrador/offline/use-conexion";
import { documentoDeVenta } from "@/lib/mostrador/ticket";
import type { Aviso, Cliente, Turno, UltimaVenta } from "./tipos";

/**
 * La conexión, la caja física y la cola de ventas sin subir.
 *
 * Son hooks que se necesitan entre sí, y por eso van juntos y en este orden.
 */
export function useColaDelMostrador(branchId: string) {
  /*
   * Lo que esta máquina cuenta de sí misma en cada latido.
   *
   * Va por ref y no por dependencia porque el orden de los hooks lo pide: el
   * latido necesita saber cuántas ventas hay sin subir, y la cola necesita
   * saber si hay conexión. Con la ref, cada uno lee del otro el valor del
   * momento sin que ninguno tenga que existir antes.
   */
  const informeRef = useRef<InformeDeCaja>({ caja: null, pendientes: 0 });
  const informe = useCallback(() => informeRef.current, []);

  // La verdad sobre si hay servidor, medida y no adivinada.
  // Si el servidor ya no reconoce la caja (la desvincularon), se suelta acá
  // y la barra vuelve a pedir que se vincule.
  const desvincularRef = useRef<(secreto?: string) => Promise<void>>(async () => {});
  const alPerderLaCaja = useCallback((secreto: string) => void desvincularRef.current(secreto), []);
  const conexion = useConexion(branchId, informe, alPerderLaCaja);
  const {
    caja: cajaFisica,
    leida: cajaLeida,
    vincular: vincularCaja,
    desvincular: desvincularCaja,
    avanzar: avanzarContador,
  } = useCaja();
  useEffect(() => {
    desvincularRef.current = desvincularCaja;
  }, [desvincularCaja]);

  /*
   * La cola de ventas sin subir. Drena sola al volver la conexión; acá se usa
   * para mostrar cuántas faltan, que es lo que quien atiende necesita ver antes
   * de cerrar el turno.
   */
  const cola = useCola(conexion.enLinea, branchId);

  useEffect(() => {
    informeRef.current = {
      caja: cajaFisica
        ? { id: cajaFisica.id, secreto: cajaFisica.secreto }
        : null,
      // Las atascadas cuentan igual: esa plata está en el cajón y todavía no en
      // el turno, que es exactamente lo que el cierre de caja tiene que saber.
      pendientes: cola.sinSubir + cola.atascadas,
    };
  }, [cajaFisica, cola.sinSubir, cola.atascadas]);

  return { conexion, cajaFisica, cajaLeida, vincularCaja, desvincularCaja, avanzarContador, cola };
}

type CajaFisica = ReturnType<typeof useCaja>["caja"];
type ContextoDelTicket = Parameters<typeof documentoDeVenta>[1];

/** Lo que la pantalla tiene cargado al momento de cobrar sin conexión. */
export interface VentaSinConexion {
  clave: string;
  branchId: string;
  usuarioId: string;
  lineas: LineaDeVenta[];
  /** Los cortes armados con conexión: viajan para que el trabajo llegue al taller. */
  cortes: { id: string; corte: CorteDeMostrador }[];
  cliente: Cliente | null;
  /** Sin cliente, el nombre del presupuesto traído (si no, «Consumidor final»). */
  contacto?: string | null;
  medio: MedioDeMostrador;
  /** Se arma recién al encolar, igual que con conexión. */
  pagosDeLaVenta: () => PagoDeVenta[] | undefined;
  acopio: boolean;
  cuit: string;
  /**
   * Factura o comprobante: la factura elegida se emite al subir. Se fijaba en
   * «interno» y la venta a un RI quedaba sin factura y sin aviso (M3S2-008).
   */
  comprobante: "interno" | "fiscal";
  /** Con cuánto pagó en efectivo (el vuelto del ticket). */
  recibido: number | null;
  /** El descuento total, el que figura en el ticket. */
  descuento: number;
  motivoDelDescuento: string;
  /** El tipeado a mano: el de la forma de pago lo vuelve a calcular el servidor. */
  descuentoManual: number;
  motivoDesc: string;
  turno: Turno | null;
  cajaFisica: CajaFisica;
  avanzarContador: () => Promise<unknown>;
  contextoDelTicket: ContextoDelTicket;
}

/** Lo que el cobro sin conexión le devuelve a la pantalla. */
export interface AlCobrarSinConexion {
  setAviso: (aviso: Aviso | null) => void;
  setUltima: (ultima: UltimaVenta | null) => void;
  limpiar: () => void;
  /** Lo vendido, para que el buscador lo descuente mientras espera en la cola. */
  apartar: (lineas: LineaDeVenta[]) => void;
  /**
   * Vuelve a leer la cola. Sin esto, el chip y «N ventas sin enviar» se
   * enteraban de la venta en el ciclo siguiente, cada 20 s, y quedaban una
   * venta atrasados (mes 23, M2S1-086).
   */
  refrescarCola: () => Promise<void>;
}

/**
 * El cobro cuando no hay servidor.
 *
 * Toma el número de la caja, arma el ticket con lo que hay en pantalla y
 * guarda las dos cosas en la misma transacción local. La factura necesita
 * ARCA en línea: si se eligió, viaja con la venta y se emite al subir (el
 * drenaje, app/api/mostrador/ventas); el papel de ahora es el provisorio.
 */
export async function cobrarSinConexion(
  {
    clave,
    branchId,
    usuarioId,
    lineas,
    cortes,
    cliente,
    contacto,
    medio,
    pagosDeLaVenta,
    acopio,
    cuit,
    comprobante,
    recibido,
    descuento,
    motivoDelDescuento,
    descuentoManual,
    motivoDesc,
    turno,
    cajaFisica,
    avanzarContador,
    contextoDelTicket,
  }: VentaSinConexion,
  { setAviso, setUltima, limpiar, apartar, refrescarCola }: AlCobrarSinConexion,
) {
  const problema = revisarVenta(lineas, medio, cliente?.id ?? null);

  if (problema) {
    setAviso({ tipo: "error", texto: problema });
    return;
  }

  const pagosPedidos = pagosDeLaVenta();
  if (medio === "cuenta_corriente" || pagosPedidos?.some((p) => p.medio === "cuenta_corriente")) {
    const sinCuenta = cuentaSinConexion(cliente);
    if (sinCuenta) {
      setAviso({ tipo: "error", texto: sinCuenta });
      return;
    }
  }

  if (!cajaFisica) {
    setAviso({
      tipo: "error",
      texto: "Esta máquina todavía no está vinculada a una caja. Conectate una vez para vincularla.",
    });
    return;
  }

  if (medio === "efectivo" && !turno) {
    setAviso({
      tipo: "error",
      texto: "No hay caja abierta en esta sucursal. Abrila antes de cobrar en efectivo.",
    });
    return;
  }

  try {
    const numero = numeroProvisorio(cajaFisica.codigo, cajaFisica.proximoNumero);
    const cobradaAt = new Date().toISOString();

    const pagos = pagosDeLaVenta();
    // Cada renglón del corte atado a su despiece, como con conexión.
    const conLosCortes = paraCobrar(lineas, cortes);
    // Lo que entra al cajón, para que el chip de la caja lo cuente mientras
    // la venta espera (M2S1-086).
    const total = Math.round((totalDeLaVenta(lineas) - descuento) * 100) / 100;
    const efectivo = pagos
      ? pagos.filter((p) => p.medio === "efectivo").reduce((s, p) => s + p.importe, 0)
      : medio === "efectivo"
        ? total
        : 0;

    const ticket = documentoDeVenta(
      {
        numero,
        provisorio: true,
        cobradaAt,
        contactoNombre: cliente?.nombre ?? (contacto || "Consumidor final"),
        medioPago: medio,
        pagos,
        acopio,
        descuento,
        descuentoMotivo: motivoDelDescuento || null,
        lineas,
        recibido: medio === "efectivo" && !pagos ? recibido : null,
      },
      contextoDelTicket,
    );

    await encolarVenta(
      {
        clave,
        numeroProvisorio: numero,
        branchId,
        ...conLosCortes,
        customerId: cliente?.id ?? null,
        contactoNombre: cliente?.nombre ?? (contacto || "Consumidor final"),
        medioPago: medio,
        pagos,
        acopio,
        comprobante,
        cuit: cuit || null,
        descuento: descuentoManual,
        descuentoMotivo: motivoDesc || null,
        usuarioId,
        cobradaAt,
        efectivo,
        ...(recibido !== null && medio === "efectivo" && !pagos ? { efectivoRecibido: recibido } : {}),
      },
      ticket,
    );
    await refrescarCola();

    await avanzarContador();

    apartar(conLosCortes.lineas);
    setUltima({ numero, orderId: null, invoiceId: undefined, clave });
    setAviso({
      tipo: "ok",
      texto:
        recibido !== null && medio === "efectivo" && !pagos && recibido > total
          ? `${numero} cobrada sin conexión. Vuelto ${formatearMonto(Math.round((recibido - total) * 100) / 100)}.`
          : `${numero} cobrada sin conexión. Se sube sola cuando vuelva internet.`,
    });
    limpiar();
  } catch {
    setAviso({
      tipo: "error",
      texto: "No se pudo guardar la venta en esta máquina. Anotala en papel y avisá.",
    });
  }
}
