"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { VincularCaja } from "@/components/mostrador/vincular-caja";
import { tarifaDeCorte, type TarifaDeCorte } from "@/lib/cortes/tarifa";
import type { PromoVigente } from "@/lib/dal/contenido";
import { formatearMonto } from "@/lib/formato";
import { borradorVale, duenoDelBorrador, type DuenoDelBorrador } from "@/lib/mostrador/borrador-del-corte";
import type { Autorizacion } from "@/components/autorizacion/campo-pin";
import {
  aAutorizar,
  desvioDeLaVenta,
  revisarChequeDePago,
  montoDelDescuento,
  totalDeLaVenta,
  vuelto,
  type LineaDeVenta,
  type TipoDescuento,
  type MedioDeMostrador,
} from "@/lib/mostrador/importes";
import { useCopiaLocal } from "@/lib/mostrador/offline/use-copia-local";
import type {
  CorteDeMostrador,
  ResultadoDeMostrador,
  RenglonDelCierre,
} from "@/lib/mostrador/tipos";
import {
  descuentoPorMedioDePago,
  montoDelDescuentoDePago,
  type EscalaDePago,
} from "@/lib/precios/medio-pago";
import {
  cobrarVenta,
  emitirPresupuestoDeMostrador,
  emitirRemitoDeVenta,
  letraDelComprobante,
  preciosDelCliente,
} from "./actions";
import { AltaAMano } from "./alta-a-mano";
import { campoEnPantalla, enfocar, useAtajos, AyudaDeAtajos, type Campo } from "./atajos";
import { focoDespuesDe, type DespuesDe } from "@/lib/mostrador/foco";
import { BarraSuperior } from "./barra-superior";
import { Buscador } from "./buscador";
import { PanelDeCaja } from "./caja";
import { Cobro } from "./cobro";
import { CorteAMedida, hayAlgoCargado, type EstadoDelCorte } from "./corte-a-medida";
import { sumar, Lineas } from "./lineas";
import { cobrarSinConexion as guardarSinConexion, useColaDelMostrador } from "./sin-conexion";
import {
  MEDIOS_DE_CONTADO,
  type TipoDeOperacion,
  TIPOS_DE_OPERACION,
  esElTipo,
  type ParteDePago,
  type ChequeEnPantalla,
  CHEQUE_VACIO,
  aChequeDePago,
} from "./medios";
import {
  type Aviso,
  type Sucursal,
  type Turno,
  type Movimiento,
  type VentaDeHoy,
  type Cliente,
  type UltimaVenta,
  papelDeLaVenta,
} from "./tipos";

/** Una clave nueva por venta: es lo que impide que el doble toque cobre dos veces. */
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
  descuentoLibrePct,
  promos,
  escalasDePago,
}: {
  /** `administraCaja`: si puede dar de alta terminales (/admin/caja). */
  usuario: { nombre: string; userId: string; administraCaja?: boolean };
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
  /** Lo que se puede dejar de cobrar sin el PIN de un admin (/admin/reglas). */
  descuentoLibrePct: number;
  /** Las promociones vigentes. Se cuentan, no se descuentan. */
  promos: PromoVigente[];
  /** El descuento por forma de pago: lo aplica el servidor, acá se muestra. */
  escalasDePago: EscalaDePago[];
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
  const buscarClienteLocal = useCallback(
    (texto: string): Cliente[] =>
      copia.buscarCliente(texto).map((c) => ({ ...c, estado: c.estado ?? "activo" })),
    [copia],
  );

  /*
   * La conexión, la caja de esta máquina y la cola de ventas sin subir. Todo
   * lo de vender sin servidor está en `sin-conexion.ts`.
   */
  const { conexion, cajaFisica, vincularCaja, avanzarContador, cola } =
    useColaDelMostrador(sucursal.id);

  const [lineas, setLineas] = useState<LineaDeVenta[]>([]);
  const [clave, setClave] = useState(claveNueva);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [medio, setMedio] = useState<MedioDeMostrador>("efectivo");
  const [recibido, setRecibido] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [otrosPrecios, setOtrosPrecios] = useState<Record<string, number> | null>(null);
  const [comprobante, setComprobante] = useState<"interno" | "fiscal">("interno");
  const [cuit, setCuit] = useState("");
  const [tipoDesc, setTipoDesc] = useState<TipoDescuento>("porcentaje");
  const [valorDesc, setValorDesc] = useState("");
  const [motivoDesc, setMotivoDesc] = useState("");
  const [letra, setLetra] = useState<string | null>(null);
  const [ultima, setUltima] = useState<UltimaVenta | null>(null);
  const [caja, setCaja] = useState(false);
  /*
   * Si el panel de la caja se abrió desde el cobro. Abierto el turno, el panel
   * se cierra solo y el cursor vuelve al cobro que estaba en curso: con el
   * cliente esperando, volver a buscar «Cobrar» es el clic de más.
   */
  const [cajaParaCobrar, setCajaParaCobrar] = useState(false);
  /*
   * Lo que se sabe del turno antes de que llegue el `router.refresh()`.
   *
   * Recién abierto desde acá, ya está abierto en la base: no hay que esperar a
   * que vuelva la página para cobrar. Y si Go rechaza un efectivo porque otra
   * terminal cerró el turno, la pantalla deja de creer que está abierto en el
   * acto. Vale hasta que cambia el turno que manda el servidor.
   */
  const [turnoLocal, setTurnoLocal] = useState<"abierto" | "cerrado" | null>(null);
  const [turnoVisto, setTurnoVisto] = useState(turno);
  if (turnoVisto !== turno) {
    setTurnoVisto(turno);
    setTurnoLocal(null);
  }
  const hayTurno = turnoLocal === "abierto" ? true : turnoLocal === "cerrado" ? false : Boolean(turno);
  /*
   * Unos 400 ms sin cobrar después de abrir la caja desde el cobro: el botón
   * pasa de «Abrir la caja» a «Cobrar» debajo del dedo, y el segundo toque de
   * un doble clic no puede terminar la venta.
   */
  const [enPausa, setEnPausa] = useState(false);
  /*
   * El PIN de un admin, cuando Go lo pide para esta venta (T3). El campo
   * aparece en el lugar del botón de cobrar; la ficha es un PIN ya tecleado:
   * si la venta falló después por otra cosa, se reenvía con ella y el admin
   * no tiene que volver.
   */
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const [ficha, setFicha] = useState<string | null>(null);
  const [suelta, setSuelta] = useState<string | null>(null);
  /*
   * El corte que se está vendiendo, si se vende uno.
   *
   * Viaja con la venta y el trabajo nace recién cuando se cobra: armar el
   * despiece y cancelar la venta no puede dejar un trabajo fantasma en la cola
   * del taller. Ver `CorteDeMostrador` en `lib/mostrador/venta.ts`.
   */
  const [corte, setCorte] = useState<CorteDeMostrador | null>(null);
  // Los renglones que agregó el corte, por descripción: cambiarles la
  // cantidad no los cambia, y sacarlos todos saca el corte.
  const [renglonesDelCorte, setRenglonesDelCorte] = useState<string[]>([]);
  /** La placa elegida para cortar, mientras el diálogo está abierto. */
  const [cortando, setCortando] = useState<ResultadoDeMostrador | null>(null);
  /*
   * Lo que se cargó en el último corte que se cerró sin agregarlo.
   *
   * Un clic de más, un Esc o la X tiraban veinte medidas tipeadas con el
   * cliente enfrente (T4, hallazgo 20). Ahora cerrar no pierde nada: volver a
   * abrir la misma placa, en la misma venta, arranca donde quedó. Por eso
   * cerrar no pregunta —preguntar es un paso más, y el criterio del mostrador
   * es ahorrarlos—. Vive en memoria: es de esta venta, no de mañana.
   */
  // De qué venta es, en `borradorVale` (lib/mostrador/borrador-del-corte.ts).
  const [borradorDelCorte, setBorradorDelCorte] = useState<(EstadoDelCorte & DuenoDelBorrador) | null>(null);

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
  /** El cheque de un pago de un solo medio. En el pago partido va por renglón. */
  const [cheque, setCheque] = useState<ChequeEnPantalla>(CHEQUE_VACIO);

  /*
   * El pago partido: null es "todo por el medio elegido", que es la venta de
   * siempre. Activado, cada renglón dice medio e importe y la suma tiene que
   * dar el total al centavo.
   */
  const [partes, setPartes] = useState<ParteDePago[] | null>(null);

  /*
   * El PIN pedido y la ficha valen para la venta como estaba cuando Go los
   * pidió. Si cambian los renglones, el cliente, el medio, el pago partido o
   * el descuento, se van: vuelve el botón de cobrar con el total recalculado
   * y el admin no firma una cifra vieja. (Se ajusta al renderizar, como
   * CampoPin, y no en un efecto.)
   */
  const queSeCobra = JSON.stringify([lineas, cliente?.id ?? null, medio, partes, tipoDesc, valorDesc]);
  const [cobroVisto, setCobroVisto] = useState(queSeCobra);
  if (cobroVisto !== queSeCobra) {
    setCobroVisto(queSeCobra);
    if (pidePin) setPidePin(null);
    if (ficha) setFicha(null);
  }

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
  const descuentoManual = useMemo(
    () => montoDelDescuento(subtotal, tipoDesc, Number(valorDesc)),
    [subtotal, tipoDesc, valorDesc],
  );
  /*
   * El de la forma de pago, con la misma regla que `RegistrarVenta`: sigue a
   * la plata que entra, así que con el pago partido en medios distintos no
   * hay. Uno tipeado a mano gana y nunca se suman. Sin esto la pantalla
   * cobraba y daba vuelto sobre un total y la caja registraba otro.
   */
  const escalaDePago = useMemo(() => {
    const unSoloMedio =
      !partes || partes.every((p) => !(Number(p.importe) > 0) || p.medio === medio);
    return unSoloMedio ? descuentoPorMedioDePago(escalasDePago, medio, subtotal) : null;
  }, [escalasDePago, partes, medio, subtotal]);
  const descuento =
    descuentoManual > 0
      ? descuentoManual
      : escalaDePago
        ? montoDelDescuentoDePago(subtotal, escalaDePago.porcentaje)
        : 0;
  const motivoDelDescuento =
    descuentoManual > 0 ? motivoDesc : (escalaDePago?.etiqueta ?? "");
  const total = useMemo(() => subtotal - descuento, [subtotal, descuento]);
  /*
   * Lo que va a pedir el PIN, avisado mientras se carga y no al cobrar: con la
   * misma regla que Go (ventas.DesvioDeLaVenta), el total se pone naranja y
   * dice cuánto queda abajo del precio. Así se llama al admin mientras se
   * termina de cargar, no con el cliente esperando. La escala automática no
   * cuenta.
   */
  const porAutorizar = useMemo(
    () => aAutorizar(desvioDeLaVenta(lineas, descuentoManual), descuentoLibrePct),
    [lineas, descuentoManual, descuentoLibrePct],
  );
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
   * Hay efectivo en este cobro y no hay turno: Go lo rechaza
   * (`parteEfectivo > 0` en RegistrarVenta), sea el pago entero o una parte
   * del partido. Antes solo se miraba el medio elegido, y un partido con una
   * parte en efectivo llegaba hasta el servidor para enterarse.
   */
  const conEfectivo = partes
    ? partes.some((p) => p.medio === "efectivo" && Number(p.importe) > 0)
    : medio === "efectivo";
  const faltaCaja = conEfectivo && !hayTurno;

  /*
   * Si se puede cobrar ahora.
   *
   * Lo decide la pantalla y no el botón: la misma condición gobierna el botón
   * y `Ctrl + Enter`, y escrita en dos lados un día dicen cosas distintas.
   * Sin caja no se explica: el botón pasa a «Abrir la caja» (ver `Cobro`).
   */
  const puedeCobrar =
    lineas.length > 0 &&
    !enviando &&
    !enPausa &&
    !faltaCaja &&
    !(medio === "cuenta_corriente" && !cliente) &&
    !(partes !== null && Math.abs(restanteDePartes) > 0.01) &&
    // El cheque se cobra con sus datos: sin número no se lo encuentra en el banco.
    !(partes === null && medio === "cheque" && revisarChequeDePago(aChequeDePago(cheque)) !== null) &&
    !(partes?.some((p) => p.medio === "cheque" && revisarChequeDePago(aChequeDePago(p.cheque)) !== null) ?? false);

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
          cheque: p.medio === "cheque" ? aChequeDePago(p.cheque) : null,
        }));
    }

    if (medio === "cheque") {
      return [{ medio, importe: total, cheque: aChequeDePago(cheque) }];
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

  /** El cobro cuando no hay servidor. La lógica está en `sin-conexion.ts`. */
  function cobrarSinConexion() {
    return guardarSinConexion(
      {
        clave,
        branchId: sucursal.id,
        usuarioId: usuario.userId,
        lineas,
        cliente,
        medio,
        pagosDeLaVenta,
        acopio,
        cuit,
        descuento,
        motivoDelDescuento,
        descuentoManual,
        motivoDesc,
        turno,
        cajaFisica,
        avanzarContador,
        contextoDelTicket,
      },
      { setAviso, setUltima, limpiar },
    );
  }

  function limpiar() {
    setBorradorDelCorte(null);
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
    setCheque(CHEQUE_VACIO);
    setPartes(null);
    setCorte(null);
    setRenglonesDelCorte([]);
    setPidePin(null);
    setFicha(null);
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
    // El corte a medio cargar era para el otro: con otro cliente no vuelve.
    if ((nuevo?.id ?? null) !== (cliente?.id ?? null)) setBorradorDelCorte(null);
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
    // La lista contra la que se marca lo tocado a mano pasa a ser la de este
    // cliente. La media placa no: el precio que vuelve es el de la entera.
    setLineas((prev) =>
      prev.map((l) =>
        l.variantId && !l.presentacion && precios[l.variantId] > 0
          ? { ...l, precioLista: precios[l.variantId] }
          : l,
      ),
    );
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
        // La media placa se deja: el precio que vuelve es el de la placa
        // entera, y ponérselo la cobraba el doble.
        l.variantId && !l.presentacion && otrosPrecios[l.variantId] > 0
          ? { ...l, precioUnitario: otrosPrecios[l.variantId], precioLista: otrosPrecios[l.variantId] }
          : l,
      ),
    );
    setOtrosPrecios(null);
  }

  function cobrar(pin?: string) {
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
     * conexión. (Si pasa lo libre, Go la marca en rojo para el dueño.)
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
        // El corte viaja mientras sigan en la venta los renglones que lo
        // trajeron (la placa, las pasadas, el canto): si se sacaron todos,
        // el taller cortaría algo que no se cobró.
        ...(corte && lineas.some((l) => renglonesDelCorte.includes(l.descripcion)) ? { corte } : {}),
        comprobante,
        cuit: cuit || null,
        descuento: descuentoManual,
        descuentoMotivo: motivoDesc || null,
        ...(pin ? { pin } : ficha ? { ficha } : {}),
      });

      if (r.ficha) setFicha(r.ficha);
      if (r.autorizacion) {
        // Falta el PIN, o el que se tecleó no era: el campo aparece (o
        // tiembla) en el lugar del botón.
        setPidePin(r.autorizacion);
        return;
      }
      setPidePin(null);
      if (r.error) {
        /*
         * Otra terminal cerró el turno mientras se cargaba esta venta. El
         * botón vuelve a decir «Abrir la caja» en el acto, que es lo que hay
         * que hacer, en vez de un error para leer. El texto es el de Go
         * (`venta.go`): no hay código de error para esto y no se cambia el
         * contrato por un cartel.
         */
        if (r.error.startsWith("No hay caja abierta")) {
          setTurnoLocal("cerrado");
          router.refresh();
          return;
        }
        setAviso({ tipo: "error", texto: r.error });
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

  /** El cursor, de vuelta donde corresponde (ver `lib/mostrador/foco.ts`). */
  function volverDe(que: DespuesDe) {
    const campo = focoDespuesDe(que, { medio, partido: partes !== null });
    requestAnimationFrame(() => enfocar(campo));
  }

  /** El elemento al que el diálogo que se cierra le devuelve el foco. */
  function focoAlCerrar(que: DespuesDe) {
    return () =>
      campoEnPantalla(focoDespuesDe(que, { medio, partido: partes !== null })) ??
      campoEnPantalla("buscador");
  }

  function abrirCajaParaCobrar() {
    setCajaParaCobrar(true);
    setCaja(true);
  }

  /** Abierto el turno desde el panel. */
  function alAbrirLaCaja(mensaje: string) {
    setTurnoLocal("abierto");
    if (!cajaParaCobrar) return;
    setCajaParaCobrar(false);
    setCaja(false);
    setAviso({ tipo: "ok", texto: mensaje });
    setEnPausa(true);
    setTimeout(() => setEnPausa(false), 400);
    volverDe("caja-para-cobrar");
  }

  /** Lo que hace Ctrl+Enter, y lo mismo el botón grande. */
  const alCobrar = faltaCaja ? abrirCajaParaCobrar : puedeCobrar ? () => void cobrar() : undefined;

  /*
   * Ctrl+Enter en el buscador agrega la línea y cobra, **con la línea ya en la
   * venta**. El cobro no puede salir en el mismo evento: `lineas` todavía es
   * la de antes y se cobraría el carrito sin el producto (T4, hallazgo 18).
   * Se marca, se agrega, y el efecto cobra en el render siguiente, con todo
   * recalculado —total, descuento por medio, PIN—.
   */
  const cobrarAlAgregar = useRef(false);
  const cobrarLoAgregado = useEffectEvent(() => alCobrar?.());
  useEffect(() => {
    if (!cobrarAlAgregar.current) return;
    cobrarAlAgregar.current = false;
    cobrarLoAgregado();
  }, [lineas]);

  /*
   * Los atajos.
   *
   * El que no tiene nada que hacer todavía —imprimir sin venta cobrada, cobrar
   * sin líneas— se deja afuera y la tecla vuelve a ser del navegador: un atajo
   * que no hace nada es igual de molesto que un botón muerto.
   */
  useAtajos({
    cobrar: alCobrar,
    buscador: () => enfocar("buscador"),
    cliente: () => enfocar("cliente"),
    // Abre el cobro de la cuenta, si el cliente elegido debe algo.
    recibo: () => document.querySelector<HTMLButtonElement>('[data-foco="recibo"]')?.click(),
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
    caja: () => {
      setCajaParaCobrar(false);
      setCaja((abierta) => !abierta);
    },
  });

  return (
    <div className="panel textura flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <BarraSuperior
        conexion={conexion}
        cola={cola}
        usuario={usuario}
        sucursales={sucursales}
        sucursal={sucursal}
        turno={hayTurno ? turno : null}
        cajaAbierta={hayTurno}
        onCaja={() => {
          setCajaParaCobrar(false);
          setCaja(true);
        }}
        // Sin caja vinculada el mostrador vende igual mientras haya internet;
        // lo que no puede es cobrar cuando se corte. Por eso el selector está
        // arriba, a mano, y no escondido en la configuración.
        terminal={
          <VincularCaja
            branchId={sucursal.id}
            enLinea={conexion.enLinea}
            vinculada={cajaFisica?.codigo ?? null}
            onVincular={vincularCaja}
            administra={usuario.administraCaja}
          />
        }
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <Buscador
            copia={copia}
            branchId={sucursal.id}
            customerId={cliente?.id ?? null}
            listaDelCliente={cliente?.priceListId ?? null}
            onElegir={(l, yCobrar) => {
              cobrarAlAgregar.current = Boolean(yCobrar);
              setLineas((prev) => sumar(prev, l));
            }}
            onSuelta={setSuelta}
            onCortar={setCortando}
            sePuedeCortar={conexion.enLinea}
          />
          <Lineas
            lineas={lineas}
            onCambiar={setLineas}
            onLimpiar={limpiar}
            onNoVaciar={() => volverDe("no-vaciar")}
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
            branchId={sucursal.id}
            buscarClienteLocal={buscarClienteLocal}
            listaGeneral={listaGeneral}
            subtotal={subtotal}
            descuento={descuento}
            etiquetaDelDescuento={motivoDelDescuento}
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
            faltaCaja={faltaCaja}
            onAbrirCaja={abrirCajaParaCobrar}
            enviando={enviando}
            puede={lineas.length > 0}
            puedeCobrar={puedeCobrar}
            onCobrar={() => cobrar()}
            porAutorizar={porAutorizar}
            pidePin={pidePin}
            onPin={(pin) => cobrar(pin)}
            onCancelarPin={() => {
              setPidePin(null);
              enfocar("buscador");
            }}
            aviso={aviso}
            ultima={ultima}
            acopio={acopio}
            onTipo={elegirTipo}
            onPartir={partirElPago}
            tarjeta={tarjeta}
            onTarjeta={setTarjeta}
            cheque={cheque}
            onCheque={setCheque}
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
            formaDeVenta: cortando.formaDeVenta,
            precioMediaPct: cortando.precioMediaPct,
          }}
          anchoSierra={anchoSierra}
          inicial={
            borradorDelCorte &&
            borradorVale(borradorDelCorte, {
              clave,
              variantId: cortando.variantId,
              clienteId: cliente?.id ?? null,
              ahora: Date.now(),
            })
              ? borradorDelCorte
              : undefined
          }
          focoAlCerrar={focoAlCerrar("corte")}
          cliente={cliente?.nombre ?? null}
          precioPorPasada={tarifaDeLaPlaca?.precioPorPasada ?? 0}
          precioPorMetroCanto={tarifaDeLaPlaca?.precioPorMetroCanto ?? 0}
          onCerrar={(estado) => {
            setBorradorDelCorte(
              hayAlgoCargado(estado)
                ? {
                    ...estado,
                    ...duenoDelBorrador({
                      clave,
                      variantId: cortando.variantId,
                      clienteId: cliente?.id ?? null,
                      ventaVacia: lineas.length === 0,
                      ahora: Date.now(),
                    }),
                  }
                : null,
            );
            setCortando(null);
            // El diálogo se desmonta en vez de cerrarse, así que su `finalFocus`
            // no llega a correr: el cursor se devuelve acá.
            volverDe("corte");
          }}
          onAgregar={(nuevas, elCorte) => {
            setLineas((prev) => [...prev, ...nuevas]);
            setCorte(elCorte);
            setRenglonesDelCorte(nuevas.map((l) => l.descripcion));
            setBorradorDelCorte(null);
            setCortando(null);
            volverDe("corte-agregado");
          }}
        />
      )}

      {suelta !== null && (
        <AltaAMano
          descripcionInicial={suelta}
          focoAlCerrar={focoAlCerrar("a-mano")}
          onCerrar={() => {
            setSuelta(null);
            volverDe("a-mano");
          }}
          onAgregar={(l) => {
            setLineas((prev) => [...prev, l]);
            setSuelta(null);
            volverDe("a-mano");
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
          onAbierta={alAbrirLaCaja}
          focoAlCerrar={focoAlCerrar(cajaParaCobrar ? "caja-para-cobrar" : "caja")}
          onCerrar={() => {
            volverDe(cajaParaCobrar ? "caja-para-cobrar" : "caja");
            setCajaParaCobrar(false);
            setCaja(false);
          }}
        />
      )}
    </div>
  );
}
