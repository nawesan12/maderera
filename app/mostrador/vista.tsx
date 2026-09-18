"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CorteAMedida } from "./corte-a-medida";
import type { CorteDeMostrador } from "@/lib/mostrador/venta";
import type { ResultadoDeMostrador } from "@/lib/mostrador/buscar";
import type { PromoVigente } from "@/lib/dal/contenido";
import { PromosDelBanco } from "./promos";
import { enfocar, useAtajos, AyudaDeAtajos, type Campo } from "./atajos";
import {
  tarifaDeCorte,
  type TarifaDeCorte,
} from "@/lib/cortes/tarifa";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  ClipboardList,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  NotebookPen,
  PenLine,
  Plus,
  FileText,
  Printer,
  Search,
  Trash2,
  Undo2,
  UserRound,
  WifiOff,
  X,
  Scissors,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearMonto, formatearPrecio, formatearUnidad } from "@/lib/formato";
import { medioPermitido } from "@/lib/precios/medio-pago";
import {
  leerTipeo,
  montoDelDescuento,
  revisarVenta,
  totalDeLaVenta,
  vuelto,
  type LineaDeVenta,
  type TipoDescuento,
} from "@/lib/mostrador/importes";
import type { MedioDeMostrador } from "@/lib/mostrador/importes";
import type { RenglonDelCierre } from "@/lib/mostrador/caja";
import {
  nombreDeLaDiferencia,
  TOLERANCIA_ARQUEO,
} from "@/lib/mostrador/arqueo";
import {
  useCopiaLocal,
  type CopiaLista,
} from "@/lib/mostrador/offline/use-copia-local";
import {
  useConexion,
  type InformeDeCaja,
  type EstadoConexion,
} from "@/lib/mostrador/offline/use-conexion";
import { useCaja } from "@/lib/mostrador/offline/use-caja";
import {
  useCola,
  type EstadoCola,
} from "@/lib/mostrador/offline/use-cola";
import {
  encolarMovimiento,
  encolarVenta,
} from "@/lib/mostrador/offline/cola";
import { VincularCaja } from "@/components/mostrador/vincular-caja";
import { numeroProvisorio } from "@/lib/mostrador/offline/numero-provisorio";
import { documentoDeVenta } from "@/lib/mostrador/ticket";
import {
  abrirCaja,
  buscarClientes,
  buscarEnMostrador,
  anularVenta,
  cerrarCaja,
  cobrarVenta,
  emitirPresupuestoDeMostrador,
  emitirRemitoDeVenta,
  letraDelComprobante,
  preciosDelCliente,
  registrarMovimientoDeCaja,
} from "./actions";

/* -------------------------------------------------------------------------- */
/* Tipos                                                                       */
/* -------------------------------------------------------------------------- */

interface Sucursal {
  id: string;
  slug: string;
  nombre: string;
}

interface Turno {
  id: string;
  sucursal: string;
  branchId: string;
  abiertaPor: string;
  abiertaAt: Date;
  esperado: number;
  /** El cambio que tiene que quedar siempre. Cero = la sucursal no lo fijó. */
  fondoBase: number;
  fondoInicial: number;
  ventasEnEfectivo: number;
  otrosIngresos: number;
  retiros: number;
  cantidadDeVentas: number;
}

interface Movimiento {
  id: string;
  tipo: string;
  monto: number;
  motivo: string | null;
  createdAt: string;
  quien: string | null;
}

interface VentaDeHoy {
  id: string;
  numero: string;
  cliente: string;
  total: number;
  medioPago: string | null;
  estado: string;
  createdAt: string;
}

interface Cliente {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  estado: string;
  /** La lista de precios asignada, para resolver precios sin servidor. */
  priceListId: string | null;
}

const MEDIOS: { valor: MedioDeMostrador; texto: string; Icono: typeof Banknote }[] = [
  { valor: "efectivo", texto: "Efectivo", Icono: Banknote },
  { valor: "debito", texto: "Débito", Icono: CreditCard },
  { valor: "credito", texto: "Crédito", Icono: CreditCard },
  { valor: "transferencia", texto: "Transferencia", Icono: Landmark },
  { valor: "cuenta_corriente", texto: "Cuenta corriente", Icono: NotebookPen },
];

/**
 * Los medios de contado.
 *
 * La cuenta corriente no está acá: no es una forma de pagar sino **un tipo de
 * operación**, y tenerla en los dos lados obligaba a elegir lo mismo dos veces.
 * El orden es el que se ve en pantalla, que es el de `Alt + 1` a `Alt + 4`.
 */
const MEDIOS_DE_CONTADO = MEDIOS.filter((m) => m.valor !== "cuenta_corriente");

/** Las tres formas de vender. El comentario largo está en `Cobro`. */
type TipoDeOperacion = "contado" | "cuenta" | "acopio";

const TIPOS_DE_OPERACION: {
  clave: TipoDeOperacion;
  texto: string;
  detalle: string;
}[] = [
  { clave: "contado", texto: "Contado", detalle: "Paga y se lo lleva" },
  {
    clave: "cuenta",
    texto: "Cuenta corriente",
    detalle: "Se lo lleva y queda anotado",
  },
  { clave: "acopio", texto: "Acopio", detalle: "Paga y lo retira después" },
];

/*
 * Cuál de los tres está elegido. No se guarda en su propio estado: se lee del
 * acopio y del medio, que son los que viajan con la venta. Un cuarto estado
 * que dijera lo mismo es el que un día queda desincronizado.
 */
function esElTipo(
  clave: TipoDeOperacion,
  acopio: boolean,
  medio: MedioDeMostrador,
) {
  if (clave === "acopio") return acopio;
  if (clave === "cuenta") return !acopio && medio === "cuenta_corriente";
  return !acopio && medio !== "cuenta_corriente";
}

/** La venta recién cobrada, para el papel que sale después. */
interface UltimaVenta {
  numero: string;
  /** Null mientras la venta está en la cola: el pedido todavía no existe. */
  orderId: string | null;
  invoiceId?: string;
  clave?: string;
  acopio?: boolean;
  remitoId?: string;
}

/**
 * Qué papel se imprime.
 *
 * Si salió factura, la factura, que es el papel que vale. Si no, el ticket del
 * pedido. Sin `orderId` la venta todavía está en la cola de esta máquina y el
 * papel se arma con lo guardado acá.
 */
function papelDeLaVenta(u: UltimaVenta) {
  if (u.invoiceId) return `/comprobante/${u.invoiceId}`;
  if (u.orderId) return `/ticket/${u.orderId}`;
  return `/ticket/local?clave=${u.clave}`;
}

/*
 * El mismo nombre de cada medio, para el cierre del turno. Se deriva de
 * `MEDIOS` y no se escribe de nuevo: dos listas del mismo dato terminan
 * diciendo cosas distintas.
 */
const NOMBRE_DEL_MEDIO: Record<string, string> = Object.fromEntries(
  MEDIOS.map((m) => [m.valor, m.texto]),
);

/** Una clave nueva por venta: es lo que impide que el doble toque cobre dos veces. */
/** Un renglón del pago partido, con los importes como texto porque se tipean. */
interface ParteDePago {
  medio: MedioDeMostrador;
  importe: string;
  nroLote: string;
  nroCupon: string;
  tarjeta: string;
  cuotas: number;
}

/**
 * Los planes que se ofrecen.
 *
 * Son los que aparecen en las promociones de los bancos: 3, 6 y 12 sin interés
 * son los que de verdad se usan, y 18 y 24 existen en algunos convenios. No se
 * ofrece cualquier número porque tipear "7 cuotas" no le sirve a nadie.
 */
const CUOTAS = [1, 3, 6, 9, 12, 18, 24] as const;

function claveNueva() {
  return crypto.randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Pantalla                                                                    */
/* -------------------------------------------------------------------------- */

export function VistaMostrador({
  usuario,
  listaGeneral,
  sucursales,
  sucursal,
  turno,
  cierre,
  movimientos,
  ventas,
  tarifasDeCorte,
  anchoSierra,
  fondoBase,
  promos,
}: {
  usuario: { nombre: string; userId: string };
  /** La lista de precios general. Lo que no sea esta es precio diferenciado. */
  listaGeneral: string | null;
  sucursales: Sucursal[];
  sucursal: Sucursal;
  turno: Turno | null;
  cierre: RenglonDelCierre[];
  movimientos: Movimiento[];
  ventas: VentaDeHoy[];
  /** Las tarifas de corte, para poder cotizar un corte sin salir del mostrador. */
  tarifasDeCorte: TarifaDeCorte[];
  /** Lo que se lleva el disco por pasada, de /admin/calculadoras. */
  anchoSierra: number;
  /** El cambio que tiene que quedar en el cajón de esta sucursal. */
  fondoBase: number;
  /** Las promociones vigentes. Se cuentan, no se descuentan. */
  promos: PromoVigente[];
}) {
  const router = useRouter();
  const [enviando, empezar] = useTransition();

  /*
   * La copia local del catálogo.
   *
   * Se carga de IndexedDB apenas monta y se refresca por detrás. Mientras haya
   * copia, buscar no toca el servidor —ni siquiera con internet—: es lo que
   * hace que el buscador conteste en el acto, sin los 180 ms de espera más la
   * ida y vuelta, y lo que permite seguir vendiendo cuando se corta.
   */
  const copia = useCopiaLocal(sucursal.id);

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
  const conexion = useConexion(sucursal.id, informe);
  const {
    caja: cajaFisica,
    vincular: vincularCaja,
    avanzar: avanzarContador,
  } = useCaja();

  /*
   * La cola de ventas sin subir. Drena sola al volver la conexión; acá se usa
   * para mostrar cuántas faltan, que es lo que quien atiende necesita ver antes
   * de cerrar el turno.
   */
  const cola = useCola(conexion.enLinea);

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

  const [lineas, setLineas] = useState<LineaDeVenta[]>([]);
  const [clave, setClave] = useState(claveNueva);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [medio, setMedio] = useState<MedioDeMostrador>("efectivo");
  const [recibido, setRecibido] = useState("");
  const [aviso, setAviso] = useState<{
    tipo: "ok" | "error";
    texto: string;
    /** Presente cuando el bloqueo se puede saltear con la decisión del vendedor. */
    autorizar?: () => void;
  } | null>(null);
  const [otrosPrecios, setOtrosPrecios] = useState<Record<string, number> | null>(null);
  const [comprobante, setComprobante] = useState<"interno" | "fiscal">("interno");
  const [cuit, setCuit] = useState("");
  const [tipoDesc, setTipoDesc] = useState<TipoDescuento>("porcentaje");
  const [valorDesc, setValorDesc] = useState("");
  const [motivoDesc, setMotivoDesc] = useState("");
  const [letra, setLetra] = useState<string | null>(null);
  const [ultima, setUltima] = useState<UltimaVenta | null>(null);
  const [caja, setCaja] = useState(false);
  const [suelta, setSuelta] = useState<string | null>(null);
  /*
   * El corte que se está vendiendo, si se vende uno.
   *
   * Viaja con la venta y el trabajo nace recién cuando se cobra: armar el
   * despiece y cancelar la venta no puede dejar un trabajo fantasma en la cola
   * del taller. Ver `CorteDeMostrador` en `lib/mostrador/venta.ts`.
   */
  const [corte, setCorte] = useState<CorteDeMostrador | null>(null);
  /** La placa elegida para cortar, mientras el diálogo está abierto. */
  const [cortando, setCortando] = useState<ResultadoDeMostrador | null>(null);

  /*
   * La tarifa de corte que corresponde a la placa elegida y a la lista de quien
   * compra: un mayorista paga menos la pasada. La resuelve la misma función que
   * la ficha del corte, para que el precio del mostrador y el del panel no
   * puedan discrepar.
   */
  const tarifaDeLaPlaca = cortando
    ? tarifaDeCorte(
        tarifasDeCorte,
        [cortando.categoria ?? "", `${cortando.producto} ${cortando.medida}`],
        cliente?.priceListId ?? null,
      )
    : null;

  /*
   * La venta queda en acopio: se cobra y la mercadería no se lleva. El stock
   * se reserva y cada retiro sale después con su remito, desde la ficha del
   * pedido.
   */
  const [acopio, setAcopio] = useState(false);

  /*
   * Los datos de la terminal para un pago con tarjeta: lote, cupón y qué
   * tarjeta. Son el "código de que se pagó con qué" que pide el contador.
   */
  const [tarjeta, setTarjeta] = useState({
    nroLote: "",
    nroCupon: "",
    marca: "",
    cuotas: 1,
  });

  /*
   * El pago partido: null es "todo por el medio elegido", que es la venta de
   * siempre. Activado, cada renglón dice medio e importe y la suma tiene que
   * dar el total al centavo.
   */
  const [partes, setPartes] = useState<ParteDePago[] | null>(null);

  /*
   * Lo fijo del ticket. Sale de lo que la pantalla ya tiene, así que el papel
   * se puede armar sin preguntarle nada a nadie.
   */
  const contextoDelTicket = useMemo(
    () => ({
      sucursal: {
        nombre: sucursal.nombre,
        direccion: null as string | null,
        telefono: null as string | null,
      },
      emisor: { razonSocial: "Maderera Juan B. Justo", cuit: null as string | null },
      whatsapp: null as string | null,
    }),
    [sucursal.nombre],
  );

  const subtotal = useMemo(() => totalDeLaVenta(lineas), [lineas]);
  const descuento = useMemo(
    () => montoDelDescuento(subtotal, tipoDesc, Number(valorDesc)),
    [subtotal, tipoDesc, valorDesc],
  );
  const total = useMemo(() => subtotal - descuento, [subtotal, descuento]);
  // Sin nada tipeado no hay vuelto que mostrar: `Number("")` es 0, y un vuelto
  // de $0 en pantalla antes de que el cliente saque la plata se lee como si ya
  // hubiera pagado justo.
  const cambio = useMemo(
    () =>
      medio === "efectivo" && recibido.trim() !== ""
        ? vuelto(total, Number(recibido))
        : null,
    [medio, total, recibido],
  );

  // Cuánto falta repartir cuando el pago está partido. Cero es "listo".
  const restanteDePartes = useMemo(() => {
    if (!partes) return 0;
    const suma = partes.reduce((s, p) => s + (Number(p.importe) || 0), 0);
    return Math.round((total - suma) * 100) / 100;
  }, [partes, total]);

  /*
   * Si se puede cobrar ahora.
   *
   * Lo decide la pantalla y no el botón: la misma condición gobierna el botón
   * y `Ctrl + Enter`, y escrita en dos lados un día dicen cosas distintas.
   * Los carteles que explican *por qué* no se puede —falta caja, falta
   * cliente— los arma el panel de cobro, que es donde se leen.
   */
  const puedeCobrar =
    lineas.length > 0 &&
    !enviando &&
    !(medio === "efectivo" && !turno) &&
    !(medio === "cuenta_corriente" && !cliente) &&
    !(partes !== null && Math.abs(restanteDePartes) > 0.01);

  /**
   * El detalle de pagos que viaja con la venta.
   *
   * Sin partir y sin tarjeta no se manda nada: el servidor arma el pago único
   * solo, y las ventas viejas de la cola siguen entrando igual.
   */
  function pagosDeLaVenta() {
    if (partes) {
      return partes
        .filter((p) => (Number(p.importe) || 0) > 0)
        .map((p) => ({
          medio: p.medio,
          importe: Number(p.importe),
          nroLote: p.nroLote.trim() || null,
          nroCupon: p.nroCupon.trim() || null,
          tarjeta: p.tarjeta.trim() || null,
          cuotas: p.medio === "credito" ? p.cuotas : 1,
        }));
    }

    if (
      (medio === "debito" || medio === "credito") &&
      (tarjeta.nroLote.trim() ||
        tarjeta.nroCupon.trim() ||
        tarjeta.marca.trim() ||
        tarjeta.cuotas > 1)
    ) {
      return [
        {
          medio,
          importe: total,
          nroLote: tarjeta.nroLote.trim() || null,
          nroCupon: tarjeta.nroCupon.trim() || null,
          tarjeta: tarjeta.marca.trim() || null,
          cuotas: tarjeta.cuotas,
        },
      ];
    }

    return undefined;
  }

  /*
   * La letra no se rotula a mano: sale de quién emite y quién recibe. Si la
   * maderera pasara a monotributo, todo lo que emite es C y esta pantalla lo
   * dice sola, sin que nadie tenga que acordarse de cambiar un texto.
   */
  useEffect(() => {
    if (comprobante !== "fiscal") return;

    let vigente = true;
    const t = setTimeout(async () => {
      const r = await letraDelComprobante(cliente?.id ?? null, cuit || null);
      if (vigente) setLetra(r.letra);
    }, 150);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [comprobante, cliente, cuit]);

  // Derivada y no guardada: al volver a "comprobante interno" la letra
  // desaparece sola, sin un `setState` sincrónico adentro del efecto.
  const letraVisible = comprobante === "fiscal" ? letra : null;

  /**
   * El cobro cuando no hay servidor.
   *
   * Toma el número de la caja, arma el ticket con lo que hay en pantalla y
   * guarda las dos cosas en la misma transacción local. No hay comprobante
   * fiscal: eso necesita ARCA en línea, y la pantalla ya lo deshabilitó.
   */
  async function cobrarSinConexion() {
    const problema = revisarVenta(lineas, medio, cliente?.id ?? null);

    if (problema) {
      setAviso({ tipo: "error", texto: problema });
      return;
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

      const ticket = documentoDeVenta(
        {
          numero,
          provisorio: true,
          cobradaAt,
          contactoNombre: cliente?.nombre ?? "Consumidor final",
          medioPago: medio,
          pagos,
          acopio,
          descuento,
          descuentoMotivo: motivoDesc || null,
          lineas,
        },
        contextoDelTicket,
      );

      await encolarVenta(
        {
          clave,
          numeroProvisorio: numero,
          branchId: sucursal.id,
          lineas,
          customerId: cliente?.id ?? null,
          contactoNombre: cliente?.nombre ?? "Consumidor final",
          medioPago: medio,
          pagos,
          acopio,
          comprobante: "interno",
          cuit: cuit || null,
          descuento,
          descuentoMotivo: motivoDesc || null,
          usuarioId: usuario.userId,
          cobradaAt,
        },
        ticket,
      );

      await avanzarContador();

      setUltima({ numero, orderId: null, invoiceId: undefined, clave });
      setAviso({
        tipo: "ok",
        texto: `${numero} cobrada sin conexión. Se sube sola cuando vuelva internet.`,
      });
      limpiar();
    } catch {
      setAviso({
        tipo: "error",
        texto: "No se pudo guardar la venta en esta máquina. Anotala en papel y avisá.",
      });
    }
  }

  function limpiar() {
    setLineas([]);
    setCliente(null);
    setMedio("efectivo");
    setRecibido("");
    setClave(claveNueva());
    setOtrosPrecios(null);
    setComprobante("interno");
    setCuit("");
    setValorDesc("");
    setMotivoDesc("");
    setAcopio(false);
    setTarjeta({ nroLote: "", nroCupon: "", marca: "", cuotas: 1 });
    setPartes(null);
    // Terminada la venta, el foco vuelve al buscador: lo que sigue siempre es
    // el primer producto del que viene atrás en la fila.
    enfocar("buscador");
  }

  /*
   * El medio de pago y, atrás de él, el foco.
   *
   * Cada medio pide un dato distinto y siempre el mismo: el efectivo, con
   * cuánto paga; la tarjeta, la marca, el lote y el cupón. Llevar el cursor
   * hasta ahí es el clic que se ahorra en toda venta. El campo recién existe
   * en el render que viene, así que se enfoca después de pintar.
   */
  function elegirMedio(m: MedioDeMostrador) {
    setMedio(m);
    const campo: Campo | null =
      m === "efectivo"
        ? "recibido"
        : m === "debito" || m === "credito"
          ? "tarjeta"
          : null;
    if (campo) requestAnimationFrame(() => enfocar(campo));
  }

  /** Contado, cuenta corriente o acopio: el medio de pago se acomoda solo. */
  function elegirTipo(t: TipoDeOperacion) {
    if (t === "acopio") {
      setAcopio(true);
      return;
    }
    setAcopio(false);
    if (t === "cuenta") {
      setMedio("cuenta_corriente");
      // Sin cliente no hay a quién anotarle la deuda: es el dato que falta.
      if (!cliente) requestAnimationFrame(() => enfocar("cliente"));
    } else if (medio === "cuenta_corriente") {
      elegirMedio("efectivo");
    }
  }

  /** El siguiente de los tres, para `Alt + T`. */
  function ciclarTipo() {
    const actual = TIPOS_DE_OPERACION.findIndex((t) =>
      esElTipo(t.clave, acopio, medio),
    );
    elegirTipo(
      TIPOS_DE_OPERACION[(actual + 1) % TIPOS_DE_OPERACION.length].clave,
    );
  }

  /** Abre el pago partido con dos renglones: el medio elegido y el otro. */
  function partirElPago() {
    setPartes([
      {
        medio,
        importe: "",
        nroLote: "",
        nroCupon: "",
        tarjeta: "",
        cuotas: 1,
      },
      {
        medio: medio === "efectivo" ? "debito" : "efectivo",
        importe: "",
        nroLote: "",
        nroCupon: "",
        tarjeta: "",
        cuotas: 1,
      },
    ]);
    requestAnimationFrame(() => enfocar("parte", true));
  }


  /*
   * Identificar al cliente con la venta ya empezada es lo normal en el
   * mostrador: primero se cargan las cosas, después se pregunta a nombre de
   * quién. Si el cliente tiene otra lista —un profesional— los ítems ya
   * cargados quedaron valuados a precio de mostrador.
   *
   * No se pisan solos. Quien atiende puede haber tocado un precio a mano, y
   * cambiárselo por atrás es peor que no hacer nada: se avisa y se ofrece.
   */
  async function alElegirCliente(nuevo: Cliente | null) {
    setCliente(nuevo);
    setOtrosPrecios(null);

    /*
     * Quien no es consumidor final se lleva factura.
     *
     * Un responsable inscripto o un monotributista viene a comprar para su
     * negocio y necesita el comprobante para descargarlo: darle el ticket
     * interno y que lo pida es el clic de más que se hacía en toda venta a una
     * empresa. Solo sube: si el vendedor ya eligió factura a mano, elegir
     * después un consumidor final no se la saca.
     */
    if (nuevo && nuevo.condicionIva !== "consumidor_final") {
      setComprobante("fiscal");
    }

    const ids = lineas.map((l) => l.variantId).filter((v): v is string => !!v);
    if (ids.length === 0) return;

    const precios = await preciosDelCliente(ids, nuevo?.id ?? null);
    const distintos = lineas.some(
      (l) =>
        l.variantId &&
        precios[l.variantId] > 0 &&
        Math.abs(precios[l.variantId] - l.precioUnitario) > 0.005,
    );
    if (distintos) setOtrosPrecios(precios);
  }

  function aplicarPrecios() {
    if (!otrosPrecios) return;
    setLineas((prev) =>
      prev.map((l) =>
        l.variantId && otrosPrecios[l.variantId] > 0
          ? { ...l, precioUnitario: otrosPrecios[l.variantId] }
          : l,
      ),
    );
    setOtrosPrecios(null);
  }

  function cobrar(autorizado = false) {
    setAviso(null);

    // Con el pago partido, la suma tiene que dar el total antes de cobrar.
    if (partes && Math.abs(restanteDePartes) > 0.01) {
      setAviso({
        tipo: "error",
        texto:
          restanteDePartes > 0
            ? `Faltan repartir ${formatearMonto(restanteDePartes)} entre los pagos.`
            : `Los pagos se pasan por ${formatearMonto(-restanteDePartes)}.`,
      });
      return;
    }

    /*
     * Sin servidor, la venta se cobra igual y se guarda para subir después.
     *
     * Es la decisión que define todo este trabajo: la plata entra al cajón y la
     * mercadería sale por la puerta, así que negarse a registrar la venta no la
     * evita —solo la deja sin anotar—. El cliente se lleva un ticket con el
     * número de la caja y el sistema se encarga del resto cuando vuelva la
     * conexión.
     */
    if (!conexion.enLinea) {
      void cobrarSinConexion();
      return;
    }

    empezar(async () => {
      const r = await cobrarVenta({
        clave,
        branchId: sucursal.id,
        lineas,
        customerId: cliente?.id ?? null,
        contactoNombre: cliente?.nombre ?? "Consumidor final",
        medioPago: medio,
        pagos: pagosDeLaVenta(),
        acopio,
        ...(corte ? { corte } : {}),
        comprobante,
        cuit: cuit || null,
        descuento,
        descuentoMotivo: motivoDesc || null,
        autorizado,
      });

      if (r.error) {
        setAviso({
          tipo: "error",
          texto: r.error,
          // Cuenta corriente frenada pero salvable: el vendedor decide. Sin
          // esto el mostrador quedaría trabado con un cliente enfrente.
          autorizar: r.requiereAutorizacion ? () => cobrar(true) : undefined,
        });
        return;
      }

      // El aviso del comprobante no es un error de la venta: la venta está
      // hecha y lo que falta es el papel. Se muestra distinto a propósito.
      setAviso(
        r.avisoFiscal
          ? { tipo: "error", texto: `${r.ok} ${r.avisoFiscal}` }
          : { tipo: "ok", texto: r.ok ?? "Venta registrada." },
      );
      if (r.numero && r.orderId) {
        setUltima({
          numero: r.numero,
          orderId: r.orderId,
          invoiceId: r.invoiceId,
          acopio,
        });
      }
      limpiar();
      router.refresh();
    });
  }

  /**
   * El remito de lo que se acaba de llevar. Solo constancia: el stock ya se
   * movió al cobrar. Abre la hoja de impresión apenas el servidor lo numera.
   */
  function emitirRemito() {
    if (!ultima?.orderId) return;
    const orderId = ultima.orderId;

    empezar(async () => {
      const r = await emitirRemitoDeVenta(orderId);
      if (r.error) {
        setAviso({ tipo: "error", texto: r.error });
        return;
      }
      if (r.remitoId) {
        setUltima((previa) =>
          previa ? { ...previa, remitoId: r.remitoId } : previa,
        );
        window.open(`/remito/${r.remitoId}`, "_blank");
      }
    });
  }

  /**
   * El presupuesto con lo que hay cargado, sin cobrar. Queda en la cola del
   * panel con origen "mostrador" y el papel sale en PDF.
   */
  function emitirPresupuesto() {
    if (lineas.length === 0) return;

    empezar(async () => {
      const r = await emitirPresupuestoDeMostrador({
        branchId: sucursal.id,
        lineas,
        customerId: cliente?.id ?? null,
        contactoNombre: cliente?.nombre ?? "Consumidor final",
      });
      if (r.error) {
        setAviso({ tipo: "error", texto: r.error });
        return;
      }
      setAviso({ tipo: "ok", texto: r.ok ?? "Presupuesto emitido." });
      if (r.quoteId) window.open(`/api/presupuestos/${r.quoteId}/pdf`, "_blank");
    });
  }

  /*
   * Los atajos.
   *
   * El que no tiene nada que hacer todavía —imprimir sin venta cobrada, cobrar
   * sin líneas— se deja afuera y la tecla vuelve a ser del navegador: un atajo
   * que no hace nada es igual de molesto que un botón muerto.
   */
  useAtajos({
    cobrar: puedeCobrar ? () => void cobrar() : undefined,
    buscador: () => enfocar("buscador"),
    cliente: () => enfocar("cliente"),
    cantidad: lineas.length > 0 ? () => enfocar("cantidad") : undefined,
    descuento: () => enfocar("descuento"),
    tipo: ciclarTipo,
    medio1: () => elegirMedio(MEDIOS_DE_CONTADO[0].valor),
    medio2: () => elegirMedio(MEDIOS_DE_CONTADO[1].valor),
    medio3: () => elegirMedio(MEDIOS_DE_CONTADO[2].valor),
    medio4: () => elegirMedio(MEDIOS_DE_CONTADO[3].valor),
    papel: () =>
      setComprobante((c) => (c === "interno" ? "fiscal" : "interno")),
    partir: partes === null ? partirElPago : () => setPartes(null),
    presupuesto:
      lineas.length > 0 && conexion.enLinea
        ? () => emitirPresupuesto()
        : undefined,
    imprimir: ultima
      ? () => window.open(papelDeLaVenta(ultima), "_blank")
      : undefined,
    caja: () => setCaja((abierta) => !abierta),
  });

  return (
    <div className="panel textura flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <BarraSuperior
        conexion={conexion}
        cola={cola}
        usuario={usuario}
        sucursales={sucursales}
        sucursal={sucursal}
        turno={turno}
        onCaja={() => setCaja(true)}
      />

      {/* Sin caja vinculada el mostrador vende igual mientras haya internet; lo
          que no puede es cobrar cuando se corte. El cartel está arriba de todo
          porque el momento de resolverlo es ahora, no cuando se caiga la red. */}
      {!cajaFisica && (
        <div className="px-4 pt-3">
          <VincularCaja
            branchId={sucursal.id}
            enLinea={conexion.enLinea}
            onVincular={vincularCaja}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <Buscador
            copia={copia}
            branchId={sucursal.id}
            customerId={cliente?.id ?? null}
            listaDelCliente={cliente?.priceListId ?? null}
            onElegir={(l) => setLineas((prev) => sumar(prev, l))}
            onSuelta={setSuelta}
            onCortar={setCortando}
            sePuedeCortar={conexion.enLinea}
          />
          <Lineas
            lineas={lineas}
            onCambiar={setLineas}
            onLimpiar={limpiar}
          />

          <div className="flex justify-end">
            <AyudaDeAtajos />
          </div>
        </section>

        {/* El panel donde se opera la venta.
            Ancho de verdad: acá adentro entran el cliente, los medios, el tipo
            de operación, el descuento, el papel y el vuelto, y todo eso tiene
            que verse junto y sin scrollear. La lista de productos de la
            izquierda necesita unos 620 px para sus columnas, así que a 1366 —el
            monitor de mostrador— el panel se lleva 560 y siguen entrando las
            dos cosas. */}
        <aside className="flex w-[420px] shrink-0 flex-col border-l border-linea bg-card xl:w-[560px] 2xl:w-[620px]">
          <Cobro
            listaGeneral={listaGeneral}
            subtotal={subtotal}
            descuento={descuento}
            tipoDesc={tipoDesc}
            onTipoDesc={setTipoDesc}
            valorDesc={valorDesc}
            onValorDesc={setValorDesc}
            motivoDesc={motivoDesc}
            onMotivoDesc={setMotivoDesc}
            total={total}
            cliente={cliente}
            onCliente={alElegirCliente}
            otrosPrecios={Boolean(otrosPrecios)}
            onAplicarPrecios={aplicarPrecios}
            comprobante={comprobante}
            onComprobante={setComprobante}
            cuit={cuit}
            onCuit={setCuit}
            letra={letraVisible}
            medio={medio}
            onMedio={elegirMedio}
            recibido={recibido}
            onRecibido={setRecibido}
            cambio={cambio}
            hayCaja={Boolean(turno)}
            enviando={enviando}
            puede={lineas.length > 0}
            puedeCobrar={puedeCobrar}
            onCobrar={() => cobrar()}
            aviso={aviso}
            ultima={ultima}
            acopio={acopio}
            onTipo={elegirTipo}
            onPartir={partirElPago}
            tarjeta={tarjeta}
            onTarjeta={setTarjeta}
            partes={partes}
            onPartes={setPartes}
            restante={restanteDePartes}
            enLinea={conexion.enLinea}
            onRemito={emitirRemito}
            onPresupuesto={emitirPresupuesto}
            promos={promos}
          />
        </aside>
      </div>

      {cortando && (
        <CorteAMedida
          placa={{
            variantId: cortando.variantId,
            descripcion: `${cortando.producto} — ${cortando.medida}`,
            unidad: cortando.unidad,
            precio: cortando.precio,
            largoMm: cortando.largoMm ?? null,
            anchoMm: cortando.anchoMm ?? null,
            color: cortando.color ?? null,
          }}
          anchoSierra={anchoSierra}
          precioPorPasada={tarifaDeLaPlaca?.precioPorPasada ?? 0}
          precioPorMetroCanto={tarifaDeLaPlaca?.precioPorMetroCanto ?? 0}
          onCerrar={() => setCortando(null)}
          onAgregar={(nuevas, elCorte) => {
            setLineas((prev) => [...prev, ...nuevas]);
            setCorte(elCorte);
            setCortando(null);
          }}
        />
      )}

      {suelta !== null && (
        <AltaAMano
          descripcionInicial={suelta}
          onCerrar={() => setSuelta(null)}
          onAgregar={(l) => {
            setLineas((prev) => [...prev, l]);
            setSuelta(null);
          }}
        />
      )}

      {caja && (
        <PanelDeCaja
          sucursal={sucursal}
          turno={turno}
          fondoBase={fondoBase}
          cierre={cierre}
          movimientos={movimientos}
          ventas={ventas}
          enLinea={conexion.enLinea}
          onEncolado={() => void cola.refrescar()}
          onCerrar={() => setCaja(false)}
        />
      )}
    </div>
  );
}

/** Agrega una línea, o suma la cantidad si esa medida ya está en la venta. */
function sumar(lineas: LineaDeVenta[], nueva: LineaDeVenta): LineaDeVenta[] {
  const i = lineas.findIndex(
    (l) => l.variantId && l.variantId === nueva.variantId,
  );
  if (i === -1) return [...lineas, nueva];

  const copia = [...lineas];
  copia[i] = { ...copia[i], cantidad: copia[i].cantidad + nueva.cantidad };
  return copia;
}

/* -------------------------------------------------------------------------- */

function BarraSuperior({
  conexion,
  cola,
  usuario,
  sucursales,
  sucursal,
  turno,
  onCaja,
}: {
  conexion: EstadoConexion;
  cola: EstadoCola;
  usuario: { nombre: string };
  sucursales: Sucursal[];
  sucursal: Sucursal;
  turno: Turno | null;
  onCaja: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-linea px-4">
      <Link href="/admin" className="text-base font-bold tracking-tight">
        Mostrador
      </Link>

      <div className="flex items-center gap-1.5">
        {sucursales.map((s) => (
          <Link
            key={s.id}
            href={`/mostrador?sucursal=${s.slug}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              s.id === sucursal.id
                ? "bg-accion text-white"
                : "text-muted-foreground hover:bg-hundida"
            }`}
          >
            {s.nombre}
          </Link>
        ))}
      </div>

      {/* El estado de conexión, medido con el latido y no con
          `navigator.onLine`, que en un wifi sin salida a internet dice que sí.
          Va acá arriba porque cambia lo que se puede hacer: sin servidor no se
          abre ni se cierra caja, y el comprobante fiscal queda deshabilitado. */}
      {!conexion.enLinea && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-espera">
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión
        </span>
      )}

      {cola.sinSubir > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-espera"
          title="Se suben solas cuando vuelva la conexión."
        >
          {cola.sinSubir} ventas sin enviar
        </span>
      )}

      {cola.atascadas > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-problema">
          {cola.atascadas} venta{cola.atascadas > 1 ? "s" : ""} trabada
          {cola.atascadas > 1 ? "s" : ""}
        </span>
      )}

      {conexion.desfasajeMin !== null && (
        <span
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-semibold estado-problema"
          title="La hora de esta máquina se usa para las ventas hechas sin conexión."
        >
          Reloj corrido {conexion.desfasajeMin} min
        </span>
      )}

      <button
        onClick={onCaja}
        className={`ml-auto inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors ${
          turno
            ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
            : "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
        }`}
      >
        <Banknote className="h-4 w-4" />
        {turno ? `Caja ${formatearMonto(turno.esperado)}` : "Caja cerrada"}
      </button>

      <span className="text-sm text-muted-foreground">{usuario.nombre}</span>
    </header>
  );
}

/* -------------------------------------------------------------------------- */

function Buscador({
  copia,
  branchId,
  customerId,
  listaDelCliente,
  onElegir,
  onSuelta,
  onCortar,
  sePuedeCortar,
}: {
  copia: CopiaLista;
  branchId: string;
  customerId: string | null;
  /** La lista de precios del cliente elegido, para buscar sin servidor. */
  listaDelCliente: string | null;
  onElegir: (l: LineaDeVenta) => void;
  /** Abre el alta a mano con el texto que ya se tipeó. */
  onSuelta: (descripcion: string) => void;
  /** Abre el corte a medida sobre esa placa. */
  onCortar: (placa: ResultadoDeMostrador) => void;
  /**
   * Si se puede cortar ahora.
   *
   * Sin conexión, no: la venta se encola y el trabajo del taller **no viaja en
   * la cola**. Cobrar un corte cuyo despiece nunca llega al aserradero es peor
   * que no poder venderlo, porque el cliente se va con el comprobante y vuelve
   * a buscar unas piezas que nadie cortó.
   */
  sePuedeCortar: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<
    Awaited<ReturnType<typeof buscarEnMostrador>>
  >([]);
  const [buscando, setBuscando] = useState(false);
  /** Cuál de los resultados está marcado. Se mueve con las flechas. */
  const [marcado, setMarcado] = useState(0);
  const campo = useRef<HTMLInputElement>(null);

  // El foco arranca acá y vuelve acá después de cada ítem: en el mostrador se
  // tipea sin mirar, y un cursor que se va obliga a soltar el teclado.
  useEffect(() => {
    campo.current?.focus();
  }, []);

  // La cantidad puede venir tipeada adelante: «3*pino» son tres tablas de pino.
  // La regla de cuándo eso es una cantidad y cuándo una medida está en
  // `leerTipeo`, con sus pruebas.
  const { cantidad, consulta, explicita } = leerTipeo(texto);

  // Espera corta: quien tipea rápido no dispara una consulta por tecla. Todo
  // el estado se toca adentro del temporizador y nada sincrónicamente en el
  // efecto, que es lo que dispara renders en cascada.
  /*
   * Con copia local la búsqueda **se deriva del render**, no de un efecto.
   *
   * Buscar en memoria sobre unos miles de filas tarda menos que un cuadro de
   * animación: meterlo en un efecto agregaría un render de más por tecla y la
   * regla de hooks lo prohíbe con razón. Sin copia —la primera vez, o un
   * navegador sin IndexedDB— se cae al servidor con la espera de siempre.
   */
  const hayCopia = copia.listo && copia.variantes > 0;

  const locales = useMemo(() => {
    if (!hayCopia || consulta.length < 2) return null;
    return copia.buscar(consulta, customerId, listaDelCliente);
  }, [consulta, hayCopia, copia, customerId, listaDelCliente]);

  useEffect(() => {
    if (hayCopia || consulta.length < 2) return;

    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await buscarEnMostrador(consulta, branchId, customerId);
      setResultados(r);
      setBuscando(false);
    }, 180);

    return () => clearTimeout(t);
  }, [consulta, branchId, customerId, hayCopia]);

  /*
   * Lo que se muestra se deriva del texto y no se guarda: así, al borrar el
   * campo la lista desaparece en el acto, sin esperar los 180 ms ni guardar un
   * estado que después hay que acordarse de limpiar.
   */
  const visibles = consulta.length < 2 ? [] : (locales ?? resultados);

  // El marcado se acota al leerlo y no se corrige con un efecto: la lista
  // cambia con cada tecla y un `setState` adentro de un efecto por cada
  // pulsación es un render de más.
  const elegido = Math.min(marcado, Math.max(visibles.length - 1, 0));

  function elegir(r: (typeof resultados)[number]) {
    onElegir({
      variantId: r.variantId,
      descripcion: `${r.producto} — ${r.medida}`,
      unidad: r.unidad,
      cantidad,
      precioUnitario: r.precio,
    });
    setTexto("");
    setResultados([]);
    setMarcado(0);
    campo.current?.focus();
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-card px-4">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          ref={campo}
          data-foco="buscador"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setMarcado(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (visibles.length === 0) return;
              e.preventDefault();
              setMarcado((m) => {
                const tope = visibles.length - 1;
                const i = Math.min(m, tope);
                return e.key === "ArrowDown"
                  ? Math.min(i + 1, tope)
                  : Math.max(i - 1, 0);
              });
              return;
            }

            if (e.key === "Enter") {
              e.preventDefault();

              /*
               * Ctrl+Enter sobre una placa abre el corte a medida. Es el mismo
               * botón «Cortar» de la lista, que hasta ahora era el único paso
               * de la venta que obligaba al mouse.
               */
              const r = visibles[elegido];
              if ((e.ctrlKey || e.metaKey) && r && sePuedeCortar && r.largoMm && r.anchoMm) {
                onCortar(r as ResultadoDeMostrador);
                setTexto("");
                return;
              }

              if (r) {
                elegir(r);
              } else if (consulta.length >= 2 && !buscando) {
                /*
                 * Enter sobre algo que no está en el catálogo abre la carga a
                 * mano con ese texto. En el mostrador se tipea "corte a
                 * medida" o "flete centro" y se espera que pase algo; que no
                 * pase nada obliga a buscar otro camino con alguien esperando
                 * enfrente.
                 */
                onSuelta(consulta);
                setTexto("");
              }
            }
            if (e.key === "Escape") setTexto("");
          }}
          placeholder="Buscá por nombre, medida o código…"
          className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />
        {/* Lo que se entendió del prefijo, mientras se tipea: sin esto, «3*»
            es un asterisco perdido en el medio de la búsqueda. */}
        {explicita && (
          <span className="shrink-0 rounded-lg bg-hundida px-2.5 py-1 text-base font-semibold">
            ×{cantidad}
          </span>
        )}
        {buscando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {consulta.length >= 2 && visibles.length === 0 && !buscando && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl border border-linea bg-popover p-4 shadow-lg">
          <p className="text-base text-muted-foreground">
            No hay nada en el catálogo con «{consulta}».
          </p>
          <button
            onClick={() => {
              onSuelta(consulta);
              setTexto("");
            }}
            className="mt-2.5 inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
          >
            <PenLine className="h-4 w-4" />
            Cargarlo a mano
            <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
              Enter
            </kbd>
          </button>
        </div>
      )}

      {visibles.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-[420px] overflow-y-auto rounded-xl border border-linea bg-popover shadow-lg">
          {visibles.map((r, i) => (
            <li
              key={r.variantId}
              className={`flex items-stretch ${i === elegido ? "bg-hundida" : ""}`}
            >
              <button
                onClick={() => elegir(r)}
                className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hundida"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">
                    {r.producto} — {r.medida}
                  </span>
                  <span className="block text-sm text-muted-foreground">
                    {r.sku} · {r.stock > 0 ? `${r.stock} en esta sucursal` : "sin stock acá"}
                  </span>
                </span>
                <span className="tabular shrink-0 text-lg font-semibold">
                  {r.precio > 0 ? formatearPrecio(r.precio) : "a definir"}
                </span>
                {i === elegido && (
                  <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>

              {/* Cortar, solo para lo que tiene medida de placa cargada: un
                  tarugo no se corta, y sin las dos medidas no hay plano.
                  Sin conexión tampoco aparece: la copia local no guarda las
                  medidas de la placa, y un corte es un trabajo del taller que
                  necesita el catálogo. */}
              {sePuedeCortar && r.largoMm && r.anchoMm && (
                <button
                  onClick={() => {
                    onCortar(r as ResultadoDeMostrador);
                    setTexto("");
                  }}
                  className="flex shrink-0 items-center gap-1.5 border-l border-linea px-4 text-base font-medium text-acento-texto transition-colors hover:bg-hundida"
                >
                  <Scissors className="h-4 w-4" />
                  Cortar
                  {i === elegido && (
                    <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                      Ctrl + Enter
                    </kbd>
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Lineas({
  lineas,
  onCambiar,
  onLimpiar,
}: {
  lineas: LineaDeVenta[];
  onCambiar: (l: LineaDeVenta[]) => void;
  onLimpiar: () => void;
}) {
  if (lineas.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-linea text-center">
        <p className="text-lg font-medium text-muted-foreground">
          Buscá un producto para empezar la venta
        </p>
        <p className="text-base text-muted-foreground">
          Por nombre, por medida o pasando el código. Lo que no esté —un corte,
          un flete— se carga a mano desde el mismo buscador.
        </p>
      </div>
    );
  }

  function cambiar(i: number, campo: "cantidad" | "precioUnitario", valor: number) {
    const copia = [...lineas];
    copia[i] = { ...copia[i], [campo]: valor };
    onCambiar(copia);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-linea bg-card">
      <div className="flex items-center justify-between border-b border-linea px-4 py-2.5">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {lineas.length} {lineas.length === 1 ? "producto" : "productos"}
        </span>
        <button
          onClick={onLimpiar}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Vaciar
        </button>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-linea overflow-y-auto">
        {lineas.map((l, i) => (
          <li key={`${l.variantId ?? "suelta"}-${i}`} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-base font-medium">{l.descripcion}</span>
              <span className="block text-sm text-muted-foreground">
                por {formatearUnidad(l.unidad)}
              </span>
            </span>

            <label className="shrink-0">
              <span className="sr-only">Cantidad de {l.descripcion}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={l.cantidad}
                onChange={(e) => cambiar(i, "cantidad", Number(e.target.value))}
                /* F2 cae en la cantidad de la última línea cargada, que es la
                   que se acaba de equivocar. Las de más arriba se corrigen con
                   el mouse o con Tab. */
                data-foco={i === lineas.length - 1 ? "cantidad" : undefined}
                onKeyDown={(e) => {
                  // Corregida la cantidad, el foco vuelve solo al buscador:
                  // lo que sigue es cargar el próximo producto.
                  if (e.key === "Enter" || e.key === "Escape") {
                    e.preventDefault();
                    enfocar("buscador");
                  }
                }}
                className="tabular h-11 w-24 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
              />
            </label>

            <span className="text-muted-foreground">×</span>

            <label className="shrink-0">
              <span className="sr-only">Precio de {l.descripcion}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={l.precioUnitario}
                onChange={(e) => cambiar(i, "precioUnitario", Number(e.target.value))}
                className="tabular h-11 w-32 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
              />
            </label>

            <span className="tabular w-32 shrink-0 text-right text-lg font-semibold">
              {formatearMonto(l.cantidad * l.precioUnitario)}
            </span>

            <button
              onClick={() => onCambiar(lineas.filter((_, j) => j !== i))}
              aria-label={`Quitar ${l.descripcion}`}
              className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Cobro({
  subtotal,
  descuento,
  tipoDesc,
  onTipoDesc,
  valorDesc,
  onValorDesc,
  motivoDesc,
  onMotivoDesc,
  total,
  cliente,
  onCliente,
  otrosPrecios,
  onAplicarPrecios,
  comprobante,
  onComprobante,
  cuit,
  onCuit,
  letra,
  medio,
  onMedio,
  listaGeneral,
  recibido,
  onRecibido,
  cambio,
  hayCaja,
  enviando,
  puede,
  puedeCobrar,
  onCobrar,
  aviso,
  ultima,
  acopio,
  onTipo,
  onPartir,
  promos,
  tarjeta,
  onTarjeta,
  partes,
  onPartes,
  restante,
  enLinea,
  onRemito,
  onPresupuesto,
}: {
  subtotal: number;
  descuento: number;
  tipoDesc: TipoDescuento;
  onTipoDesc: (t: TipoDescuento) => void;
  valorDesc: string;
  onValorDesc: (v: string) => void;
  motivoDesc: string;
  onMotivoDesc: (v: string) => void;
  total: number;
  cliente: Cliente | null;
  onCliente: (c: Cliente | null) => void;
  otrosPrecios: boolean;
  onAplicarPrecios: () => void;
  comprobante: "interno" | "fiscal";
  onComprobante: (c: "interno" | "fiscal") => void;
  cuit: string;
  onCuit: (v: string) => void;
  letra: string | null;
  medio: MedioDeMostrador;
  onMedio: (m: MedioDeMostrador) => void;
  /** La lista general: lo que no sea esta es precio de profesional. */
  listaGeneral: string | null;
  recibido: string;
  onRecibido: (v: string) => void;
  cambio: number | null;
  hayCaja: boolean;
  enviando: boolean;
  /** Hay algo cargado: alcanza para un presupuesto. */
  puede: boolean;
  /** Además, están los datos que la venta necesita para cobrarse. */
  puedeCobrar: boolean;
  onCobrar: () => void;
  aviso: { tipo: "ok" | "error"; texto: string; autorizar?: () => void } | null;
  ultima: UltimaVenta | null;
  acopio: boolean;
  /** Elegir contado, cuenta corriente o acopio: acomoda el medio de pago. */
  onTipo: (t: TipoDeOperacion) => void;
  /** Abrir el pago partido con dos renglones. */
  onPartir: () => void;
  promos: PromoVigente[];
  tarjeta: { nroLote: string; nroCupon: string; marca: string; cuotas: number };
  onTarjeta: (v: {
    nroLote: string;
    nroCupon: string;
    marca: string;
    cuotas: number;
  }) => void;
  partes: ParteDePago[] | null;
  onPartes: (v: ParteDePago[] | null) => void;
  /** Lo que falta repartir en el pago partido. Cero es "cierra". */
  restante: number;
  enLinea: boolean;
  onRemito: () => void;
  onPresupuesto: () => void;
}) {
  const faltaCaja = medio === "efectivo" && !hayCaja;

  /*
   * El precio de profesional es de contado.
   *
   * `registrarVentaDeMostrador` lo rechaza igual, pero enterarse al cobrar es
   * tarde: hay alguien esperando enfrente y ya se cargó toda la venta. Acá el
   * crédito se apaga apenas se elige el cliente, y el cartel dice cuál es la
   * salida —cobrar a consumidor final, que es precio de catálogo—.
   */
  const precioProfesional =
    cliente?.priceListId != null && cliente.priceListId !== listaGeneral;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-linea p-4">
        <BuscadorDeCliente cliente={cliente} onCliente={onCliente} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/*
          Qué clase de operación es. Va primero porque decide el resto: contado
          deja elegir el medio, cuenta corriente lo fija y acopio reserva en vez
          de entregar.

          La clienta pidió "más tipos de factura, como de acopio, cuenta
          corriente, contado". Leído de cerca, no son tipos de comprobante
          fiscal —esos los decide la condición de IVA del cliente y no se
          eligen— sino **tres formas distintas de vender**, y las tres ya
          existían repartidas en controles que no se miraban juntos: un
          checkbox acá, un medio de pago allá.

          Puestas en un solo lugar se elige una vez y la pantalla se acomoda. El
          botón de cobrar y el papel que sale después dicen cuál fue.
        */}
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Tipo de operación
        </p>
        <div
          className="mt-2.5 grid grid-cols-3 gap-2"
          role="group"
          aria-label="Tipo de operación"
        >
          {TIPOS_DE_OPERACION.map((t) => {
            const activo = esElTipo(t.clave, acopio, medio);
            return (
              <button
                key={t.clave}
                type="button"
                aria-pressed={activo}
                onClick={() => onTipo(t.clave)}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  activo
                    ? "border-accion bg-accion/10"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                <span className="block text-base font-medium">{t.texto}</span>
                <span className="block text-sm text-muted-foreground">
                  {t.detalle}
                </span>
              </button>
            );
          })}
        </div>

        {/*
          Lo que se toca en toda venta, en dos columnas: cómo paga y con cuánto,
          contra el descuento y el papel. En el panel angosto de antes esto era
          una fila atrás de la otra y había que scrollear para llegar al vuelto,
          que es lo último que se tipea antes de cobrar.
        */}
        <div className="mt-5 grid gap-x-4 gap-y-5 xl:grid-cols-2">
          <div className="min-w-0">
            {/* En cuenta corriente no se elige medio: el medio *es* la cuenta
                corriente, y tenerlo dos veces en pantalla era el control
                duplicado que hacía elegir lo mismo dos veces. En su lugar, la
                columna dice a quién se le anota, que es el dato que falta. */}
            {medio === "cuenta_corriente" && (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Se le anota a
                </p>
                {cliente ? (
                  <p className="mt-2.5 rounded-xl border border-linea p-3.5 text-base">
                    <span className="font-medium">{cliente.nombre}</span>
                    <span className="block text-muted-foreground">
                      Se lleva la mercadería y el total queda como deuda en su
                      cuenta.
                    </span>
                  </p>
                ) : (
                  <p className="estado-espera mt-2.5 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
                    Elegí el cliente: la cuenta corriente necesita saber a quién
                    anotarle la deuda.{" "}
                    <kbd className="whitespace-nowrap rounded border border-current px-1.5 py-0.5 text-xs">
                      Alt + C
                    </kbd>
                  </p>
                )}
              </>
            )}

            {medio !== "cuenta_corriente" && (
              <>
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Cómo paga
                </p>
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {MEDIOS_DE_CONTADO.map(({ valor, texto }, i) => {
                    const bloqueado =
                      precioProfesional && !medioPermitido(valor, true);

                    return (
                      <button
                        key={valor}
                        onClick={() => !bloqueado && onMedio(valor)}
                        disabled={bloqueado}
                        title={
                          bloqueado
                            ? "El precio de profesional es de contado. Cobrá por transferencia, débito o efectivo, o pasá la venta a consumidor final."
                            : `Alt + ${i + 1}`
                        }
                        className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                          medio === valor
                            ? "border-accion bg-accion text-white"
                            : "border-linea hover:bg-hundida"
                        } ${
                          bloqueado
                            ? "cursor-not-allowed opacity-40 hover:bg-transparent"
                            : ""
                        }`}
                      >
                        {texto}
                      </button>
                    );
                  })}
                </div>


                {precioProfesional && (
                  <p className="mt-2 rounded-lg bg-hundida px-3 py-2 text-sm text-muted-foreground">
                    Precio de profesional: es de contado. En cuotas con tarjeta
                    corre el precio de catálogo, así que la venta va a
                    consumidor final.
                  </p>
                )}
              </>
            )}

            {medio === "efectivo" && !partes && (
              <label className="mt-4 block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Con cuánto paga
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={recibido}
                  onChange={(e) => onRecibido(e.target.value)}
                  data-foco="recibido"
                  onKeyDown={(e) => {
                    // Es el último dato de la venta en efectivo: Enter cobra.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (puedeCobrar) onCobrar();
                    }
                  }}
                  placeholder="0"
                  className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                />
                {cambio !== null && (
                  <span className="mt-2 flex items-baseline justify-between text-lg">
                    <span className="text-muted-foreground">Vuelto</span>
                    <span className="tabular font-bold text-saldo-favor">
                      {formatearMonto(cambio)}
                    </span>
                  </span>
                )}
              </label>
            )}

            {faltaCaja && (
              <p className="estado-problema mt-3 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
                No hay caja abierta en esta sucursal. Abrila para poder cobrar en
                efectivo.
              </p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Descuento
            </p>
            <div className="mt-2.5 flex gap-2">
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-linea">
                {(["porcentaje", "monto"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => onTipoDesc(t)}
                    className={`h-12 px-3.5 text-base font-medium transition-colors ${
                      tipoDesc === t ? "bg-accion text-white" : "hover:bg-hundida"
                    }`}
                  >
                    {t === "porcentaje" ? "%" : "$"}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="0"
                step="0.01"
                value={valorDesc}
                onChange={(e) => onValorDesc(e.target.value)}
                data-foco="descuento"
                placeholder="0"
                className="tabular h-12 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-right text-base"
              />
            </div>

            {/* El motivo, en su propia línea: al lado del importe no entraba y
                es lo que después explica el descuento en el cierre. */}
            <input
              value={motivoDesc}
              onChange={(e) => onMotivoDesc(e.target.value)}
              placeholder="Motivo del descuento"
              className="mt-2 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />

            <p className="mt-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Qué se lleva
            </p>
            <div className="mt-2.5 grid grid-cols-2 gap-2">
              <button
                onClick={() => onComprobante("interno")}
                className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                  comprobante === "interno"
                    ? "border-accion bg-accion text-white"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                Comprobante
              </button>
              <button
                onClick={() => onComprobante("fiscal")}
                className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-xl border px-2 text-base font-medium transition-colors ${
                  comprobante === "fiscal"
                    ? "border-accion bg-accion text-white"
                    : "border-linea hover:bg-hundida"
                }`}
              >
                {/* La letra la calcula el servidor con la condición de las dos
                    partes. Antes de que conteste se dice "Factura" a secas:
                    mejor eso que anunciar una letra que después cambia. */}
                {letra ? `Factura ${letra}` : "Factura"}
              </button>
            </div>

            {comprobante === "fiscal" && !cliente && (
              <label className="mt-2.5 block">
                <span className="text-base text-muted-foreground">
                  CUIT, si lo quiere a nombre de una empresa
                </span>
                <input
                  value={cuit}
                  onChange={(e) => onCuit(e.target.value)}
                  inputMode="numeric"
                  placeholder="Sin CUIT: sale a consumidor final"
                  className="tabular mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>
            )}
          </div>
        </div>

        {/* El lote y el cupón de la terminal, cuando se paga con tarjeta y el
            pago no está partido (partido, van por renglón). Son el dato fiscal
            que después pide el contador; se pueden dejar vacíos. */}
        {!partes && (medio === "debito" || medio === "credito") && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <input
              value={tarjeta.marca}
              onChange={(e) => onTarjeta({ ...tarjeta, marca: e.target.value })}
              data-foco="tarjeta"
              placeholder="Tarjeta"
              className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
            />
            <input
              value={tarjeta.nroLote}
              onChange={(e) => onTarjeta({ ...tarjeta, nroLote: e.target.value })}
              inputMode="numeric"
              placeholder="Lote"
              className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
            />
            <input
              value={tarjeta.nroCupon}
              onChange={(e) => onTarjeta({ ...tarjeta, nroCupon: e.target.value })}
              inputMode="numeric"
              placeholder="Cupón"
              className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
            />
          </div>
        )}

        {/* Las cuotas, solo en crédito: en débito no existen.
            **No cambian lo que se cobra.** Las sin interés las financia el
            banco y la maderera cobra el total igual; esto se guarda para el
            comprobante y para conciliar después contra la liquidación de la
            terminal. Qué bancos tienen sin interés está en el panel de
            promociones, abajo. */}
        {!partes && medio === "credito" && (
          <label className="mt-2.5 flex items-center gap-2.5">
            <span className="text-base text-muted-foreground">En</span>
            <select
              value={tarjeta.cuotas}
              onChange={(e) =>
                onTarjeta({ ...tarjeta, cuotas: Number(e.target.value) })
              }
              className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
            >
              {CUOTAS.map((n) => (
                <option key={n} value={n}>
                  {n === 1 ? "1 pago" : `${n} cuotas`}
                </option>
              ))}
            </select>
            {tarjeta.cuotas > 1 && (
              <span className="text-base text-muted-foreground">
                de {formatearMonto(total / tarjeta.cuotas)} · el total no cambia
              </span>
            )}
          </label>
        )}

        {/* El pago partido: mitad efectivo, mitad débito es una venta de todos
            los días. Cada renglón lleva su medio y su importe, y con tarjeta,
            su lote y cupón. Ocupa el ancho entero del panel: es el momento de
            cobrar y los renglones se tipean mirando la plata sobre el
            mostrador. */}
        {partes !== null && (
          <div className="mt-4 space-y-2 rounded-xl border border-linea p-3">
            {partes.map((parte, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex gap-2">
                  <select
                    value={parte.medio}
                    onChange={(e) =>
                      onPartes(
                        partes.map((p, j) =>
                          j === i
                            ? { ...p, medio: e.target.value as MedioDeMostrador }
                            : p,
                        ),
                      )
                    }
                    className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-background px-2 text-base"
                  >
                    {MEDIOS.map(({ valor, texto }) => (
                      <option key={valor} value={valor}>
                        {texto}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={parte.importe}
                    onChange={(e) =>
                      onPartes(
                        partes.map((p, j) =>
                          j === i ? { ...p, importe: e.target.value } : p,
                        ),
                      )
                    }
                    data-foco={i === 0 ? "parte" : undefined}
                    placeholder="0"
                    className="tabular h-11 w-28 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
                  />
                  {partes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => onPartes(partes.filter((_, j) => j !== i))}
                      className="h-11 shrink-0 rounded-lg border border-linea px-3 text-base font-medium text-muted-foreground hover:bg-hundida"
                    >
                      Sacar
                    </button>
                  )}
                </div>
                {(parte.medio === "debito" || parte.medio === "credito") && (
                  <div className="grid grid-cols-4 gap-2">
                    <input
                      value={parte.tarjeta}
                      onChange={(e) =>
                        onPartes(
                          partes.map((p, j) =>
                            j === i ? { ...p, tarjeta: e.target.value } : p,
                          ),
                        )
                      }
                      placeholder="Tarjeta"
                      className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
                    />
                    <input
                      value={parte.nroLote}
                      onChange={(e) =>
                        onPartes(
                          partes.map((p, j) =>
                            j === i ? { ...p, nroLote: e.target.value } : p,
                          ),
                        )
                      }
                      inputMode="numeric"
                      placeholder="Lote"
                      className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
                    />
                    <input
                      value={parte.nroCupon}
                      onChange={(e) =>
                        onPartes(
                          partes.map((p, j) =>
                            j === i ? { ...p, nroCupon: e.target.value } : p,
                          ),
                        )
                      }
                      inputMode="numeric"
                      placeholder="Cupón"
                      className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
                    />
                    {/* Las cuotas de este renglón, solo si es crédito. */}
                    {parte.medio === "credito" ? (
                      <select
                        value={parte.cuotas}
                        onChange={(e) =>
                          onPartes(
                            partes.map((p, j) =>
                              j === i
                                ? { ...p, cuotas: Number(e.target.value) }
                                : p,
                            ),
                          )
                        }
                        className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
                      >
                        {CUOTAS.map((n) => (
                          <option key={n} value={n}>
                            {n === 1 ? "1 pago" : `${n} cuotas`}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span />
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center justify-between pt-1">
              <div className="flex gap-3">
                {partes.length < 4 && (
                  <button
                    type="button"
                    onClick={() =>
                      onPartes([
                        ...partes,
                        {
                          medio: "efectivo",
                          importe: "",
                          nroLote: "",
                          nroCupon: "",
                          tarjeta: "",
                          cuotas: 1,
                        },
                      ])
                    }
                    className="inline-flex h-11 items-center rounded-lg border border-linea px-3.5 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
                  >
                    + Otro pago
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onPartes(null)}
                  className="inline-flex h-11 items-center rounded-lg border border-linea px-3.5 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
                >
                  Un solo medio
                </button>
              </div>
              <span
                className={`tabular text-sm font-semibold ${
                  Math.abs(restante) > 0.01
                    ? "text-destructive"
                    : "text-saldo-favor"
                }`}
              >
                {Math.abs(restante) > 0.01
                  ? restante > 0
                    ? `Faltan ${formatearMonto(restante)}`
                    : `Sobran ${formatearMonto(-restante)}`
                  : "Cierra justo"}
              </span>
            </div>
          </div>
        )}

        {/* Lo que se consulta de vez en cuando, plegado y junto: partir el pago
            —una venta de cada tantas— y las promociones de los bancos, que se
            abren cuando el cliente pregunta "¿qué promociones tienen?". Están
            para decirlas, no para descontarlas. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {partes === null && (
            <button
              type="button"
              onClick={() => onPartir()}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Partir el pago en más de un medio
            </button>
          )}
          <PromosDelBanco promos={promos} />
        </div>

        {otrosPrecios && (
          <div className="estado-info mt-4 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-[var(--estado-tinta)]">
            <p className="text-base leading-relaxed">
              {cliente?.nombre} tiene otra lista de precios. Los productos que ya
              cargaste están a precio de mostrador.
            </p>
            <button
              onClick={onAplicarPrecios}
              className="mt-2.5 inline-flex h-10 items-center rounded-lg bg-[var(--estado-tinta)] px-3.5 text-sm font-semibold text-[var(--estado-fondo)]"
            >
              Aplicar su lista
            </button>
          </div>
        )}


      </div>

      {/* Cómo salió la venta. Fuera del scroll a propósito: un "no se pudo
          cobrar" al final de una columna que hay que scrollear es un aviso que
          nadie lee. */}
      {aviso && (
        <div
          className={`border-t border-linea px-4 py-3 text-base ${
            aviso.tipo === "ok" ? "estado-ok" : "estado-problema"
          } bg-[var(--estado-fondo)] text-[var(--estado-tinta)]`}
        >
          <p>{aviso.texto}</p>
          {aviso.autorizar && (
            <button
              type="button"
              onClick={aviso.autorizar}
              disabled={enviando}
              className="mt-2.5 h-11 rounded-lg border border-current px-4 text-base font-semibold"
            >
              Cobrar igual, bajo mi responsabilidad
            </button>
          )}
        </div>
      )}

      {/* El papel de la venta recién cobrada, fuera del scroll.
          Es lo primero que se toca después de cobrar y estaba al final de una
          columna que había que scrollear, con el cliente esperando el ticket en
          la mano. */}
      {ultima && (
        <div className="flex flex-wrap gap-2 border-t border-linea px-4 py-3">
          {/* Si salió factura se imprime la factura, que es el papel que vale.
              Si no, el ticket del pedido, que dice expresamente que no es un
              comprobante fiscal. Las dos rutas piden ids distintos: la primera
              el de la factura, la segunda el del pedido. */}
          <Link
            href={papelDeLaVenta(ultima)}
            target="_blank"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
          >
            <Printer className="h-4 w-4 shrink-0" />
            Imprimir {ultima.numero}
            <kbd className="rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
              Alt + I
            </kbd>
          </Link>
          {!ultima.invoiceId && (
            <Link
              href={`/admin/facturacion?pedido=${ultima.orderId}`}
              target="_blank"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
            >
              <Plus className="h-4 w-4 shrink-0" />
              Facturar
            </Link>
          )}

          {/* El remito del retiro: qué se llevó y si pagó. En un acopio no
              se llevó nada todavía; el retiro se registra en la ficha del
              pedido, que es lo que descuenta el stock. */}
          {ultima.orderId &&
            (ultima.acopio ? (
              <Link
                href={`/admin/pedidos/${ultima.orderId}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                <FileText className="h-4 w-4" />
                Registrar retiro
              </Link>
            ) : ultima.remitoId ? (
              <Link
                href={`/remito/${ultima.remitoId}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                <Printer className="h-4 w-4" />
                Remito
              </Link>
            ) : (
              <button
                type="button"
                onClick={onRemito}
                disabled={enviando}
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-50"
              >
                <FileText className="h-4 w-4 shrink-0" />
                Remito
              </button>
            ))}
        </div>
      )}

      <div className="border-t border-linea p-4">
        {descuento > 0 && (
          <>
            <p className="flex items-baseline justify-between text-base text-muted-foreground">
              <span>Subtotal</span>
              <span className="tabular">{formatearMonto(subtotal)}</span>
            </p>
            <p className="flex items-baseline justify-between text-base">
              <span className="text-muted-foreground">
                Descuento{motivoDesc ? ` · ${motivoDesc}` : ""}
              </span>
              <span className="tabular font-semibold text-saldo-favor">
                −{formatearMonto(descuento)}
              </span>
            </p>
          </>
        )}

        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">Total</span>
          <span className="tabular text-[34px] font-bold leading-none tracking-tight">
            {formatearMonto(total)}
          </span>
        </div>

        {/* Cobrar y el presupuesto en la misma fila: el presupuesto es de cada
            tantas ventas y no necesita el ancho entero, y esos 55 px de alto
            son los que hacían falta arriba. */}
        <div className="mt-3.5 flex gap-2">
          <button
            onClick={() => onCobrar()}
            disabled={!puedeCobrar}
            className="inline-flex h-16 min-w-0 flex-1 items-center justify-center gap-2.5 rounded-xl bg-accion text-xl font-bold text-white transition-colors hover:bg-accion-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                {acopio ? "Cobrar y dejar en acopio" : "Cobrar"}
                <kbd className="rounded border border-white/40 px-1.5 py-0.5 text-xs font-medium">
                  Ctrl + Enter
                </kbd>
              </>
            )}
          </button>

          {/* El papel para quien pregunta un precio y se va a pensarlo: mismo
              carro, sin cobrar. Necesita servidor porque numera y arma el PDF. */}
          <button
            type="button"
            onClick={onPresupuesto}
            disabled={!puede || enviando || !enLinea}
            title={
              !enLinea
                ? "Sin conexión no se puede numerar el presupuesto."
                : "Emitir presupuesto sin cobrar · Alt + U"
            }
            className="inline-flex h-16 w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-linea text-sm font-medium transition-colors hover:bg-hundida disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ClipboardList className="h-4 w-4" />
            Presupuesto
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function BuscadorDeCliente({
  cliente,
  onCliente,
}: {
  cliente: Cliente | null;
  onCliente: (c: Cliente | null) => void;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);

  useEffect(() => {
    const consulta = texto.trim();
    if (consulta.length < 2) return;
    const t = setTimeout(async () => {
      setResultados((await buscarClientes(consulta)) as Cliente[]);
    }, 180);
    return () => clearTimeout(t);
  }, [texto]);

  const visibles = texto.trim().length < 2 ? [] : resultados;

  function elegir(c: Cliente) {
    onCliente(c);
    setTexto("");
    setResultados([]);
    // De vuelta a la venta: identificar al cliente es un rodeo en el medio de
    // cargar productos.
    enfocar("buscador");
  }

  if (cliente) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-background px-3.5 py-2.5">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-medium">{cliente.nombre}</span>
          {cliente.cuit && (
            <span className="tabular block text-sm text-muted-foreground">
              CUIT {cliente.cuit}
            </span>
          )}
        </span>
        <button
          onClick={() => onCliente(null)}
          data-foco="cliente"
          aria-label="Quitar el cliente"
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-hundida"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-background px-3.5">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          data-foco="cliente"
          onKeyDown={(e) => {
            if (e.key === "Enter" && visibles.length > 0) {
              e.preventDefault();
              elegir(visibles[0]);
              return;
            }
            // Sin nada tipeado, Escape devuelve el foco a la venta.
            if (e.key === "Escape") {
              if (texto === "") enfocar("buscador");
              setTexto("");
            }
          }}
          placeholder="Consumidor final — buscá para cambiar"
          className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>

      {visibles.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-linea bg-popover shadow-lg">
          {visibles.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => elegir(c)}
                className="w-full px-3.5 py-2.5 text-left transition-colors hover:bg-hundida"
              >
                <span className="block truncate text-base font-medium">{c.nombre}</span>
                <span className="block text-sm text-muted-foreground">
                  {c.cuit ? `CUIT ${c.cuit}` : "sin CUIT"}
                  {c.estado === "moroso" && " · moroso"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PanelDeCaja({
  sucursal,
  turno,
  fondoBase,
  cierre,
  movimientos,
  ventas,
  enLinea,
  onEncolado,
  onCerrar,
}: {
  sucursal: Sucursal;
  turno: Turno | null;
  /**
   * El cambio de la sucursal, para poder decirlo **antes** de abrir la caja:
   * con el turno cerrado no hay de dónde leerlo.
   */
  fondoBase: number;
  cierre: RenglonDelCierre[];
  movimientos: Movimiento[];
  ventas: VentaDeHoy[];
  enLinea: boolean;
  onEncolado: () => void;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [trabajando, empezar] = useTransition();
  const [fondo, setFondo] = useState("");
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const diferencia =
    turno && contado !== "" ? Number(contado) - turno.esperado : null;

  // Antes de abrir no hay turno, así que la base sale de la sucursal.
  const baseDeCambio = turno?.fondoBase ?? fondoBase;

  return (
    /*
     * El diálogo del sistema y no un `div` fijo propio. No es cosmético: este
     * trae el foco atrapado adentro, cierra con Escape y devuelve el foco al
     * botón que lo abrió. Armado a mano, el teclado seguía llegando a la venta
     * de atrás —el fondo inicial terminaba escrito en el campo del cobro—.
     */
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        {/* `mx-0 mt-0` no es redundante: `DialogHeader` trae márgenes negativos
            para desbordar el `p-5` que el diálogo tiene de fábrica, y este
            diálogo lo anula con `p-0` porque su cuerpo scrollea aparte. Sin
            esto, el encabezado se salía veinte píxeles por cada lado y el
            título quedaba cortado contra el borde del panel. */}
        <DialogHeader className="mx-0 mt-0 border-b border-linea px-5 py-3.5">
          <DialogTitle className="text-xl font-bold tracking-tight">
            Caja · {sucursal.nombre}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {aviso && (
            <p className="mb-4 rounded-xl bg-hundida p-3.5 text-base">{aviso}</p>
          )}

          {!turno ? (
            <div>
              <p className="text-base text-muted-foreground">
                No hay caja abierta en esta sucursal. Abrila con el efectivo con
                el que arrancás el día.
                {baseDeCambio > 0 && (
                  <>
                    {" "}
                    El cambio que tiene que quedar siempre acá es{" "}
                    <strong className="tabular text-foreground">
                      {formatearMonto(baseDeCambio)}
                    </strong>
                    .
                  </>
                )}
              </p>
              <label className="mt-4 block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Fondo inicial
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={fondo}
                  onChange={(e) => setFondo(e.target.value)}
                  className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                />
              </label>
              <button
                disabled={trabajando || fondo === "" || !enLinea}
                onClick={() =>
                  empezar(async () => {
                    const r = await abrirCaja(sucursal.id, Number(fondo));
                    setAviso(r.error ?? r.ok ?? null);
                    if (!r.error) {
                      setFondo("");
                      router.refresh();
                    }
                  })
                }
                className="mt-4 inline-flex h-14 w-full items-center justify-center rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
              >
                Abrir la caja
              </button>
              {/* Abrir y cerrar caja son en línea, y no por comodidad: el
                  índice único que garantiza un turno por sucursal vive en la
                  base. Dos máquinas abriendo sin conexión terminarían con dos
                  turnos y las ventas del día repartidas entre los dos. */}
              {!enLinea && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin conexión no se puede abrir la caja. Se puede seguir
                  vendiendo: las ventas entran al turno cuando vuelva.
                </p>
              )}
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Dato titulo="Fondo inicial" valor={turno.fondoInicial} />
                <Dato titulo="Ventas en efectivo" valor={turno.ventasEnEfectivo} />
                <Dato titulo="Otros ingresos" valor={turno.otrosIngresos} />
                <Dato titulo="Retiros" valor={turno.retiros} />
              </dl>

              <div className="tarjeta-hundida mt-3 flex items-baseline justify-between rounded-xl p-4">
                <span className="text-lg font-semibold">Debería haber</span>
                <span className="tabular text-3xl font-bold">
                  {formatearMonto(turno.esperado)}
                </span>
              </div>

              {/* El cambio que no se retira. Sin esto, «podés retirar hasta
                  tanto» aparecía recién como error al intentarlo. */}
              {turno.fondoBase > 0 && (
                <p className="mt-2 flex items-baseline justify-between text-base text-muted-foreground">
                  <span>Cambio que queda para mañana</span>
                  <span className="tabular font-semibold">
                    {formatearMonto(turno.fondoBase)}
                  </span>
                </p>
              )}

              {/* El cierre Z. Lo de arriba es el efectivo, que es lo único que
                  puede faltar del cajón; esto es todo lo que se cobró en el
                  turno, que es lo que hay que conciliar contra el posnet y el
                  banco. */}
              {cierre.length > 0 && (
                <section className="mt-4">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Cobrado en el turno
                  </h3>
                  <dl className="mt-2 divide-y divide-linea-tenue rounded-xl border border-linea">
                    {cierre.map((r) => (
                      <div
                        key={r.medioPago}
                        className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                      >
                        <dt className="text-base">
                          {NOMBRE_DEL_MEDIO[r.medioPago] ?? r.medioPago}
                          <span className="ml-1.5 text-sm text-muted-foreground">
                            ({r.cantidad})
                          </span>
                        </dt>
                        <dd className="tabular font-semibold">
                          {formatearMonto(r.total)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingreso o retiro
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={monto}
                    onChange={(e) => setMonto(e.target.value)}
                    placeholder="Monto"
                    className="tabular h-12 w-32 rounded-lg border border-linea bg-background px-3 text-right text-base"
                  />
                  <input
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    placeholder="Motivo"
                    className="h-12 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
                  />
                  {(["ingreso", "retiro"] as const).map((t) => (
                    <button
                      key={t}
                      disabled={trabajando || monto === "" || !motivo.trim()}
                      onClick={() =>
                        empezar(async () => {
                          /*
                           * Sin conexión el movimiento se encola en vez de
                           * perderse. La plata sale del cajón en el momento,
                           * no cuando vuelve el wifi: si el retiro no queda
                           * anotado, el arqueo de la noche muestra un faltante
                           * que nadie va a poder explicar.
                           */
                          /*
                           * El piso de cambio también sin conexión.
                           *
                           * El servidor lo controla al registrar el retiro,
                           * pero sin conexión no hay servidor: acá la cuenta se
                           * hace con el esperado que ya está en pantalla. Sin
                           * esto, la regla que la clienta pidió se caía justo
                           * el día que se corta internet.
                           */
                          if (
                            t === "retiro" &&
                            turno.fondoBase > 0 &&
                            turno.esperado - Number(monto) < turno.fondoBase
                          ) {
                            const disponible = Math.max(
                              0,
                              turno.esperado - turno.fondoBase,
                            );
                            setAviso(
                              disponible > 0
                                ? `Ese retiro deja el cajón sin el cambio de la base (${formatearMonto(turno.fondoBase)}). Podés retirar hasta ${formatearMonto(disponible)}.`
                                : `No se puede retirar: en el cajón hay ${formatearMonto(turno.esperado)} y la base de cambio es ${formatearMonto(turno.fondoBase)}.`,
                            );
                            return;
                          }

                          if (!enLinea) {
                            await encolarMovimiento({
                              clave: crypto.randomUUID(),
                              branchId: sucursal.id,
                              tipo: t,
                              monto: Number(monto),
                              motivo: motivo.trim(),
                              hechoAt: new Date().toISOString(),
                            });
                            setAviso(
                              `${t === "retiro" ? "Retiro" : "Ingreso"} anotado. Se sube cuando vuelva la conexión.`,
                            );
                            setMonto("");
                            setMotivo("");
                            onEncolado();
                            return;
                          }

                          const r = await registrarMovimientoDeCaja(
                            turno.id,
                            t,
                            Number(monto),
                            motivo,
                          );
                          setAviso(r.error ?? r.ok ?? null);
                          if (!r.error) {
                            setMonto("");
                            setMotivo("");
                            router.refresh();
                          }
                        })
                      }
                      className="h-12 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-40"
                    >
                      {t === "ingreso" ? "Ingreso" : "Retiro"}
                    </button>
                  ))}
                </div>
              </section>

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Cerrar el turno
                </h3>
                <label className="mt-2 block">
                  <span className="text-base text-muted-foreground">
                    Contá el efectivo y poné cuánto hay
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={contado}
                    onChange={(e) => setContado(e.target.value)}
                    className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                  />
                </label>

                {/* Faltante o sobrante, con esa palabra: un número con signo
                    obliga a traducir, y es el dato que después hay que
                    explicar. */}
                {diferencia !== null && (
                  <p className="mt-2 flex items-baseline justify-between text-lg">
                    <span className="text-muted-foreground">
                      {nombreDeLaDiferencia(diferencia) === "sin diferencia"
                        ? "Arqueo"
                        : nombreDeLaDiferencia(diferencia) === "faltante"
                          ? "Falta"
                          : "Sobra"}
                    </span>
                    <span
                      className={`tabular font-bold ${
                        Math.abs(diferencia) <= TOLERANCIA_ARQUEO
                          ? "text-saldo-cero"
                          : diferencia < 0
                            ? "text-saldo-debe"
                            : "text-saldo-favor"
                      }`}
                    >
                      {Math.abs(diferencia) <= TOLERANCIA_ARQUEO
                        ? "cierra"
                        : formatearMonto(Math.abs(diferencia))}
                    </span>
                  </p>
                )}

                {diferencia !== null &&
                  Math.abs(diferencia) > TOLERANCIA_ARQUEO && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Escribí qué pasó: no se puede cerrar con una diferencia
                      sin explicar.
                    </p>
                  )}

                {turno.fondoBase > 0 &&
                  contado !== "" &&
                  Number(contado) < turno.fondoBase && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Quedan menos de {formatearMonto(turno.fondoBase)}: mañana
                      el mostrador arranca sin cambio.
                    </p>
                  )}

                <input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder={
                    diferencia !== null &&
                    Math.abs(diferencia) > TOLERANCIA_ARQUEO
                      ? "Qué pasó con la diferencia"
                      : "Notas del cierre (opcional)"
                  }
                  className="mt-2.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />

                <button
                  disabled={trabajando || contado === "" || !enLinea}
                  onClick={() =>
                    empezar(async () => {
                      const r = await cerrarCaja(turno.id, Number(contado), notas);
                      setAviso(r.error ?? r.ok ?? null);
                      if (!r.error) {
                        setContado("");
                        setNotas("");
                        router.refresh();
                      }
                    })
                  }
                  className="mt-3.5 inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl border border-linea text-lg font-bold transition-colors hover:bg-hundida disabled:opacity-40"
                >
                  <Lock className="h-5 w-5" />
                  Cerrar el turno
                </button>
                {!enLinea && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sin conexión no se puede cerrar. Además faltaría contar las
                    ventas que todavía no subieron: esa plata está en el cajón
                    pero no en el turno.
                  </p>
                )}
              </section>

              {movimientos.length > 0 && (
                <section className="mt-6">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Movimientos
                  </h3>
                  <ul className="mt-2 divide-y divide-linea">
                    {movimientos.map((m) => (
                      <li key={m.id} className="flex items-center gap-3 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-base">
                          {m.motivo ?? m.tipo}
                        </span>
                        <span
                          className={`tabular shrink-0 font-semibold ${
                            m.monto < 0 ? "text-saldo-debe" : "text-saldo-favor"
                          }`}
                        >
                          {formatearMonto(m.monto)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {/* Fuera de la rama del turno a propósito: con débito o transferencia
              se vende sin abrir caja, y si no se pudiera deshacer eso, la mitad
              de las ventas del día quedarían sin arreglo posible. */}
          <VentasDeHoy ventas={ventas} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Las ventas de hoy, con la posibilidad de deshacerlas.
 *
 * El mostrador no tiene historial: tiene "lo que pasó hoy". Las anuladas van
 * tachadas y no escondidas, porque esconderlas hace que el mismo error se anule
 * dos veces.
 */
function VentasDeHoy({ ventas }: { ventas: VentaDeHoy[] }) {
  const router = useRouter();
  const [trabajando, empezar] = useTransition();
  const [anulando, setAnulando] = useState<VentaDeHoy | null>(null);
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  if (ventas.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Ventas de hoy
      </h3>

      {aviso && <p className="mt-2 rounded-xl bg-hundida p-3.5 text-base">{aviso}</p>}

      <ul className="mt-2 divide-y divide-linea">
        {ventas.map((v) => {
          const anulada = v.estado === "cancelado";
          return (
            <li key={v.id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-base ${anulada ? "text-muted-foreground line-through" : ""}`}
                >
                  {v.numero} · {v.cliente}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {new Date(v.createdAt).toLocaleTimeString("es-AR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {v.medioPago ? ` · ${v.medioPago.replace("_", " ")}` : ""}
                </span>
              </span>

              <span
                className={`tabular shrink-0 font-semibold ${anulada ? "text-muted-foreground line-through" : ""}`}
              >
                {formatearMonto(v.total)}
              </span>

              <Link
                href={`/ticket/${v.id}`}
                target="_blank"
                aria-label={`Imprimir ${v.numero}`}
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
              >
                <Printer className="h-4 w-4" />
              </Link>

              {!anulada && (
                <button
                  onClick={() => {
                    setAnulando(v);
                    setMotivo("");
                  }}
                  aria-label={`Anular ${v.numero}`}
                  className="shrink-0 rounded-lg p-2 text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
                >
                  <Undo2 className="h-4 w-4" />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {anulando && (
        <Dialog open onOpenChange={(abierto) => !abierto && setAnulando(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-bold tracking-tight">
                Anular {anulando.numero}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3.5">
              <p className="text-base leading-relaxed text-muted-foreground">
                Vuelve el stock, sale la plata de la caja y se cancela la deuda si
                la había. Nada se borra: queda todo asentado al revés.
              </p>

              <label className="block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Por qué
                </span>
                <input
                  autoFocus
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Se cargó la medida equivocada"
                  className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />
              </label>

              <button
                disabled={trabajando || !motivo.trim()}
                onClick={() =>
                  empezar(async () => {
                    const r = await anularVenta(anulando.id, motivo);
                    setAviso(
                      r.error ?? [r.ok, r.avisoFiscal].filter(Boolean).join(" "),
                    );
                    if (!r.error) {
                      setAnulando(null);
                      router.refresh();
                    }
                  })
                }
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
              >
                <Undo2 className="h-5 w-5" />
                Anular la venta
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Carga de una línea que no está en el catálogo.
 *
 * Existe porque media venta de maderera no es un producto de la lista: un corte
 * a medida, un flete, una diferencia por una placa marcada. Sin esto, eso se
 * arregla afuera del sistema —a mano, en un papel— y la venta que queda
 * registrada no es la que se hizo.
 *
 * La línea sale con `variantId` en nulo, que es lo que hace que no descuente
 * stock de ningún estante: un flete no sale de una pila.
 */
function AltaAMano({
  descripcionInicial,
  onCerrar,
  onAgregar,
}: {
  descripcionInicial: string;
  onCerrar: () => void;
  onAgregar: (l: LineaDeVenta) => void;
}) {
  const [descripcion, setDescripcion] = useState(descripcionInicial);
  const [unidad, setUnidad] = useState("unidad");
  const [cantidad, setCantidad] = useState("1");
  const [precio, setPrecio] = useState("");

  const valido =
    descripcion.trim().length > 0 && Number(cantidad) > 0 && precio !== "" && Number(precio) >= 0;

  function agregar() {
    if (!valido) return;
    onAgregar({
      variantId: null,
      descripcion: descripcion.trim(),
      unidad: unidad.trim() || "unidad",
      cantidad: Number(cantidad),
      precioUnitario: Number(precio),
    });
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold tracking-tight">
            Cargar a mano
          </DialogTitle>
        </DialogHeader>

        <form
          className="space-y-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            agregar();
          }}
        >
          <label className="block">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Qué es
            </span>
            <input
              autoFocus
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Corte a medida, flete, diferencia…"
              className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Cantidad
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                className="tabular mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-right text-base"
              />
            </label>
            <label className="flex-1">
              <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Unidad
              </span>
              <input
                value={unidad}
                onChange={(e) => setUnidad(e.target.value)}
                className="mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Precio por unidad
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="0"
              className="tabular mt-1.5 h-14 w-full rounded-lg border border-linea bg-background px-3 text-right text-2xl font-semibold"
            />
          </label>

          {Number(cantidad) > 0 && precio !== "" && (
            <p className="flex items-baseline justify-between text-lg">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular font-bold">
                {formatearMonto(Number(cantidad) * Number(precio))}
              </span>
            </p>
          )}

          <button
            type="submit"
            disabled={!valido}
            className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
          >
            Agregar a la venta
            <kbd className="rounded border border-white/40 px-1.5 py-0.5 text-xs font-medium">
              Enter
            </kbd>
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */

function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-linea p-3.5">
      <dt className="text-sm text-muted-foreground">{titulo}</dt>
      <dd className="tabular mt-0.5 text-xl font-semibold">
        {formatearMonto(valor)}
      </dd>
    </div>
  );
}
