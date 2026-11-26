"use client";

import Link from "next/link";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { VincularCaja } from "@/components/mostrador/vincular-caja";
import { tarifaDeCorte, type TarifaDeCorte } from "@/lib/cortes/tarifa";
import type { PromoVigente } from "@/lib/dal/contenido";
import { formatearMonto, importeDelCampo } from "@/lib/formato";
import { leerDocumento } from "@/lib/clientes/documento";
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
import { guardarVentaEnCurso, leerVentaEnCurso } from "@/lib/mostrador/venta-en-curso";
import type {
  ResultadoDeMostrador,
  RenglonDelCierre,
} from "@/lib/mostrador/tipos";
import {
  descuentoPorMedioDePago,
  montoDelDescuentoDePago,
  type EscalaDePago,
} from "@/lib/precios/medio-pago";
import {
  clientePorId,
  cobrarVenta,
  emitirPresupuestoDeMostrador,
  emitirRemitoDeVenta,
  letraDelComprobante,
  preciosDelCliente,
  ventajaDeLaLista,
  presupuestoParaLaVenta,
} from "./actions";
import { AltaAMano } from "./alta-a-mano";
import { campoEnPantalla, enfocar, useAtajos, AyudaDeAtajos, type Campo } from "./atajos";
import { focoDespuesDe, type DespuesDe } from "@/lib/mostrador/foco";
import { BarraSuperior } from "./barra-superior";
import { Buscador } from "./buscador";
import { PanelDeCaja } from "./caja";
import { Cobro } from "./cobro";
import { CorteAMedida, hayAlgoCargado, type EstadoDelCorte } from "./corte-a-medida";
import { cuentaSinConexion } from "@/lib/mostrador/cuenta-sin-conexion";
import { conElCorte, cortesSinRenglones, paraCobrar, sinElCorte, type CorteEnLaVenta } from "@/lib/mostrador/cortes-de-la-venta";
import { sumar, Lineas } from "./lineas";
import { cobrarSinConexion as guardarSinConexion, useColaDelMostrador } from "./sin-conexion";
import { faltaIdentificarComprador } from "@/lib/fiscal/umbral";
import {
  MEDIOS,
  MEDIOS_DE_CONTADO,
  type TipoDeOperacion,
  TIPOS_DE_OPERACION,
  notaDelPresupuesto,
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
/** Lo que se guarda de la venta en curso para que una recarga no la pierda. */
interface VentaGuardada {
  lineas: LineaDeVenta[];
  cortes: CorteEnLaVenta<EstadoDelCorte, ResultadoDeMostrador>[];
  cliente: Cliente | null;
  medio: MedioDeMostrador;
  acopio: boolean;
  presupuesto: PresupuestoDeLaVenta | null;
  clave: string;
}

/**
 * El presupuesto que armó la venta. Sin ficha, su nombre y teléfono pasan
 * al pedido: salía «Consumidor final» (mes simulado, P-2026-0097).
 */
interface PresupuestoDeLaVenta {
  id: string;
  numero: string;
  contacto?: string | null;
  telefono?: string | null;
}

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
  ultimoContado,
  descuentoLibrePct,
  promos,
  escalasDePago,
  corteACobrar = null,
}: {
  /**
   * `administraCaja`: si puede dar de alta terminales (/admin/caja).
   * `factura`: si entra a Facturación; si no, el «Facturar» de la venta
   * recién cobrada no aparece (llevaba a «No tenés acceso»; H022).
   */
  usuario: { nombre: string; userId: string; administraCaja?: boolean; factura?: boolean };
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
  /** Lo contado al cerrar el último turno: con eso abre el siguiente. */
  ultimoContado: number | null;
  /** Lo que se puede dejar de cobrar sin el PIN de un admin (/admin/reglas). */
  descuentoLibrePct: number;
  /** Las promociones vigentes. Se cuentan, no se descuentan. */
  promos: PromoVigente[];
  /** El descuento por forma de pago: lo aplica el servidor, acá se muestra. */
  escalasDePago: EscalaDePago[];
  /**
   * Un corte de la cola sin venta («paga al retirar»), traído desde su ficha
   * para cobrarlo: abre el corte cargado y la venta lo ata (H173).
   */
  corteACobrar?: {
    id: string;
    numero: string;
    customerId: string | null;
    variantId: string;
    material: string;
    unidad: string;
    precio: number;
    largoMm: number | null;
    anchoMm: number | null;
    color: string | null;
    categoria: string | null;
    formaDeVenta: "entera" | "entera_o_media" | "metro_cuadrado";
    precioMediaPct: number;
    mitad: "largo" | "ancho" | null;
    canto: string;
    piezas: EstadoDelCorte["piezas"];
  } | null;
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
  const { conexion, cajaFisica, cajaLeida, vincularCaja, desvincularCaja, avanzarContador, cola } =
    useColaDelMostrador(sucursal.id);

  // Cuando la cola baja, lo que subió ya está en el servidor: la copia se
  // pone al día y deja de descontarlo a mano.
  const { subioLaCola } = copia;
  const sinSubirAntes = useRef(cola.sinSubir);
  useEffect(() => {
    if (cola.sinSubir < sinSubirAntes.current) subioLaCola();
    sinSubirAntes.current = cola.sinSubir;
  }, [cola.sinSubir, subioLaCola]);

  const [lineas, setLineas] = useState<LineaDeVenta[]>([]);
  const [clave, setClave] = useState(claveNueva);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  /** El presupuesto que armó la venta (se tipeó su número en el buscador). */
  const [presupuesto, setPresupuesto] = useState<PresupuestoDeLaVenta | null>(null);
  const [medio, setMedio] = useState<MedioDeMostrador>("efectivo");
  const [recibido, setRecibido] = useState("");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [otrosPrecios, setOtrosPrecios] = useState<Record<string, number> | null>(null);
  /*
   * «A precio de lista»: el cliente con lista propia compra esta vez a la
   * general, para pagar con cheque o en cuotas (mes simulado, H031). Go la
   * vuelve a valuar con la general (`aLista`).
   */
  const [aLista, setALista] = useState(false);
  /*
   * Si la lista del cliente le da algún precio mejor en esta venta. Solo
   * entonces es «de contado» (la misma regla que Go, `listaConVentaja`): una
   * lista constructora con los precios de la general bloqueaba el cheque sin
   * darle nada a cambio (H037). Null mientras no se sabe.
   */
  const [ventajaDeLista, setVentajaDeLista] = useState<{ clave: string; hay: boolean } | null>(null);
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
   * del taller. Ver `CorteDeMostrador` en `lib/mostrador/tipos.ts`.
   */
  /*
   * Los cortes de la venta: puede llevar varios, y cada renglón que sale de
   * uno lleva su `corteId` (comité final, A2). Ver
   * `lib/mostrador/cortes-de-la-venta.ts`.
   */
  const [cortes, setCortes] = useState<CorteEnLaVenta<EstadoDelCorte, ResultadoDeMostrador>[]>([]);
  /** La placa elegida para cortar, mientras el diálogo está abierto. */
  const [cortando, setCortando] = useState<ResultadoDeMostrador | null>(() =>
    corteACobrar
      ? {
          variantId: corteACobrar.variantId,
          sku: corteACobrar.numero,
          producto: corteACobrar.material,
          medida: "",
          unidad: corteACobrar.unidad,
          precio: corteACobrar.precio,
          stock: 0,
          largoMm: corteACobrar.largoMm,
          anchoMm: corteACobrar.anchoMm,
          color: corteACobrar.color,
          categoria: corteACobrar.categoria,
          formaDeVenta: corteACobrar.formaDeVenta,
          precioMediaPct: corteACobrar.precioMediaPct,
        }
      : null,
  );
  /** El corte de la cola que se está cobrando (H173): se ata al cobrar. */
  const [corteExistente, setCorteExistente] = useState<string | null>(corteACobrar?.id ?? null);
  /** El corte de la venta que se está corrigiendo, si se reabrió uno. */
  const [corrigiendo, setCorrigiendo] = useState<CorteEnLaVenta<EstadoDelCorte, ResultadoDeMostrador> | null>(null);
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
  // Los mismos candidatos y la misma lista que Go (`tarifaDelCorte` en
  // mostrador/controles.go): Go rechaza el corte cuyo cobro no cierra con su
  // plano, y una tarifa que Go encuentra y la pantalla no dejaba el corte sin
  // el renglón de las pasadas, imposible de cobrar (comité final, A2). La
  // lista general no tiene tarifa propia.
  const tarifaDeLaPlaca = cortando
    ? tarifaDeCorte(
        tarifasDeCorte,
        [cortando.categoria ?? "", `${cortando.producto} ${cortando.medida}`, cortando.producto],
        cliente?.priceListId && cliente.priceListId !== listaGeneral ? cliente.priceListId : null,
      )
    : null;

  /*
   * La venta queda en acopio: se cobra y la mercadería no se lleva. El stock
   * se reserva y cada retiro sale después con su remito, desde la ficha del
   * pedido.
   */
  const [acopio, setAcopio] = useState(false);

  /*
   * La venta a medio cargar sobrevive a una recarga (ver
   * `lib/mostrador/venta-en-curso.ts`). Se lee después de montar —el servidor
   * no tiene el navegador— y una venta que llega de un corte de la cola no se
   * pisa con la guardada.
   */
  const ventaLeida = useRef(false);
  useEffect(() => {
    if (ventaLeida.current) return;
    ventaLeida.current = true;
    if (corteACobrar) return;
    const v = leerVentaEnCurso<VentaGuardada>(sucursal.id);
    if (!v || (v.lineas.length === 0 && v.cortes.length === 0)) return;
    void Promise.resolve().then(() => {
      setLineas(v.lineas);
      setCortes(v.cortes);
      setCliente(v.cliente);
      setMedio(v.medio);
      setAcopio(v.acopio);
      setPresupuesto(v.presupuesto);
      setClave(v.clave);
    });
  }, [corteACobrar, sucursal.id]);
  useEffect(() => {
    if (!ventaLeida.current) return;
    guardarVentaEnCurso<VentaGuardada>(
      sucursal.id,
      lineas.length === 0 && cortes.length === 0
        ? null
        : { lineas, cortes, cliente, medio, acopio, presupuesto, clave },
    );
  }, [sucursal.id, lineas, cortes, cliente, medio, acopio, presupuesto, clave]);

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
  /*
   * Empezó otra venta: el aviso de la anterior («Venta PED-1051 registrada…»,
   * en rojo si la factura no salió) se va, y el papel de esa venta se achica a
   * un botón. Quedaban fijos, tapaban el cheque de la venta nueva y parecía
   * que el error era de esta (mes simulado, H179).
   */
  const ventaEmpezada = lineas.length > 0;
  const [empezadaVista, setEmpezadaVista] = useState(ventaEmpezada);
  if (empezadaVista !== ventaEmpezada) {
    setEmpezadaVista(ventaEmpezada);
    if (ventaEmpezada && ultima) setAviso(null);
  }

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
    () => montoDelDescuento(subtotal, tipoDesc, importeDelCampo(valorDesc)),
    [subtotal, tipoDesc, valorDesc],
  );
  /*
   * El de la forma de pago, con la misma regla que `RegistrarVenta`: sigue a
   * la plata que entra, así que con el pago partido en medios distintos no
   * hay. Uno tipeado a mano gana y nunca se suman. Sin esto la pantalla
   * cobraba y daba vuelto sobre un total y la caja registraba otro.
   */
  //
  // Con el pago partido manda el medio elegido en cada renglón y no el
  // importe: antes el descuento aparecía y desaparecía mientras se repartía
  // y «Faltan» cambiaba solo (mes simulado, H025). Va a Go como `sinEscala`.
  //
  // La base es lo del catálogo y el corte: un renglón a mano (el flete) va al
  // precio tipeado, como en Go (`EsElegibleParaLaEscala`; H168).
  const partidoEnMedios = partes !== null && partes.some((p) => p.medio !== medio);
  const baseEscala = useMemo(
    () => totalDeLaVenta(lineas.filter((l) => l.variantId || l.corteId)),
    [lineas],
  );
  const escalaDePago = useMemo(() => {
    const unSoloMedio =
      !partes || partes.every((p) => !(importeDelCampo(p.importe) > 0) || p.medio === medio);
    return unSoloMedio && !partidoEnMedios ? descuentoPorMedioDePago(escalasDePago, medio, baseEscala) : null;
  }, [escalasDePago, partes, medio, baseEscala, partidoEnMedios]);
  // La escala que el pago partido dejó sin correr, para decirlo al lado del total.
  const escalaSinCorrer =
    partidoEnMedios && descuentoManual <= 0 ? descuentoPorMedioDePago(escalasDePago, medio, baseEscala) : null;
  const descuento =
    descuentoManual > 0
      ? descuentoManual
      : escalaDePago
        ? montoDelDescuentoDePago(baseEscala, escalaDePago.porcentaje)
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
  // Sin nada tipeado no hay vuelto que mostrar: vacío es 0, y un vuelto
  // de $0 en pantalla antes de que el cliente saque la plata se lee como si ya
  // hubiera pagado justo.
  const cambio = useMemo(
    () =>
      medio === "efectivo" && recibido.trim() !== ""
        ? vuelto(total, importeDelCampo(recibido))
        : null,
    [medio, total, recibido],
  );
  /*
   * Con cuánto paga, menos que el total: la venta se cobraba igual por el
   * total y la diferencia aparecía recién en el arqueo como faltante (mes
   * simulado, H175). Se dice cuánto falta y no se cobra hasta corregirlo.
   */
  const faltaRecibido =
    medio === "efectivo" && !partes && recibido.trim() !== "" && importeDelCampo(recibido) < total - 0.005
      ? Math.round((total - importeDelCampo(recibido)) * 100) / 100
      : 0;

  // Cuánto falta repartir cuando el pago está partido. Cero es "listo".
  const restanteDePartes = useMemo(() => {
    if (!partes) return 0;
    const suma = partes.reduce((s, p) => s + importeDelCampo(p.importe), 0);
    return Math.round((total - suma) * 100) / 100;
  }, [partes, total]);

  /*
   * Hay efectivo en este cobro y no hay turno: Go lo rechaza
   * (`parteEfectivo > 0` en RegistrarVenta), sea el pago entero o una parte
   * del partido. Antes solo se miraba el medio elegido, y un partido con una
   * parte en efectivo llegaba hasta el servidor para enterarse.
   */
  const conEfectivo = partes
    ? partes.some((p) => p.medio === "efectivo" && importeDelCampo(p.importe) > 0)
    : medio === "efectivo";
  const faltaCaja = conEfectivo && !hayTurno;

  /*
   * Si se puede cobrar ahora.
   *
   * Lo decide la pantalla y no el botón: la misma condición gobierna el botón
   * y `Ctrl + Enter`, y escrita en dos lados un día dicen cosas distintas.
   * Sin caja no se explica: el botón pasa a «Abrir la caja» (ver `Cobro`).
   */
  // Una B desde el monto que fija ARCA lleva el documento del comprador: se
  // pide acá, antes de cobrar, y no al emitir con el cliente pagando.
  const pideDocumento =
    comprobante === "fiscal" && faltaIdentificarComprador(letra, total, []);
  const faltaDocumento = pideDocumento && faltaIdentificarComprador(letra, total, [cliente?.cuit, cuit]);

  // Con factura, el CUIT de la ficha va a ARCA: uno que no pasa el
  // verificador frena acá y no después de cobrar (Go lo rechaza igual).
  const cuitDeLaFichaMal = comprobante === "fiscal" && !!cliente?.cuit && "error" in leerDocumento(cliente.cuit);

  const puedeCobrar =
    lineas.length > 0 &&
    !faltaDocumento &&
    !cuitDeLaFichaMal &&
    faltaRecibido === 0 &&
    !enviando &&
    !enPausa &&
    !faltaCaja &&
    !(medio === "cuenta_corriente" && !cliente) &&
    // Sin conexión, ni la cuenta bloqueada ni el que no tiene cuenta.
    !(medio === "cuenta_corriente" && !conexion.enLinea && cuentaSinConexion(cliente) !== null) &&
    !(partes !== null && Math.abs(restanteDePartes) > 0.01) &&
    // La tarjeta, con lote y cupón: sin ellos no se concilia con el posnet
    // (mes simulado, H032). Sin conexión se cobra igual.
    !(conexion.enLinea && partes === null && (medio === "debito" || medio === "credito") && (!tarjeta.nroLote.trim() || !tarjeta.nroCupon.trim())) &&
    !(conexion.enLinea && (partes?.some((p) => (p.medio === "debito" || p.medio === "credito") && importeDelCampo(p.importe) > 0 && (!p.nroLote.trim() || !p.nroCupon.trim())) ?? false)) &&
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
        .filter((p) => importeDelCampo(p.importe) > 0)
        .map((p) => ({
          medio: p.medio,
          importe: importeDelCampo(p.importe),
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
        cortes,
        cliente,
        contacto: presupuesto?.contacto,
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
      { setAviso, setUltima, limpiar, apartar: (l) => copia.apartar(l, true) },
    );
  }

  function limpiar() {
    setBorradorDelCorte(null);
    setALista(false);
    setCorteExistente(null);
    setPresupuesto(null);
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
    setCortes([]);
    setCorrigiendo(null);
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
    setALista(false);
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
    /*
     * El renglón que está a precio de lista pasa a la lista de este cliente
     * solo: no lo tocó nadie, y dejarlo con el precio del anterior hacía que
     * una venta rehecha para otro cliente pidiera el PIN por «$ 16.900 abajo
     * del precio» (mes simulado). Lo tocado a mano no se pisa: se avisa y se
     * ofrece «Aplicar su lista». La media placa queda: el precio que vuelve es
     * el de la entera.
     */
    const aLaLista = (l: LineaDeVenta) =>
      l.precioLista == null || Math.abs(l.precioUnitario - l.precioLista) <= 0.005;
    setLineas((prev) =>
      prev.map((l) =>
        l.variantId && !l.presentacion && precios[l.variantId] > 0
          ? aLaLista(l)
            ? { ...l, precioUnitario: precios[l.variantId], precioLista: precios[l.variantId] }
            : { ...l, precioLista: precios[l.variantId] }
          : l,
      ),
    );
    const distintos = lineas.some(
      (l) =>
        l.variantId &&
        !l.presentacion &&
        !aLaLista(l) &&
        precios[l.variantId] > 0 &&
        Math.abs(precios[l.variantId] - l.precioUnitario) > 0.005,
    );
    if (distintos) setOtrosPrecios(precios);
  }

  /**
   * Trae un presupuesto a la venta: sus renglones (con los precios de hoy si
   * venció) y su cliente. Se cobra con Ctrl+Enter como cualquier venta, el
   * cobro entra al turno y se factura desde acá; al cobrar, el presupuesto
   * queda aceptado y atado al pedido (mes simulado: eran doce clics en dos
   * pantallas, fuera del mostrador). Reemplaza lo que había cargado: el
   * presupuesto es la venta.
   */
  async function traerPresupuesto(numero: string) {
    const r = await presupuestoParaLaVenta(numero);
    if ("error" in r) {
      setAviso({ tipo: "error", texto: r.error });
      return;
    }
    setCortes([]);
    setLineas(
      r.lineas.map((l) => ({
        variantId: l.variantId,
        descripcion: l.descripcion,
        unidad: l.unidad,
        cantidad: l.cantidad,
        precioUnitario: l.precioUnitario,
        precioLista: l.precioLista,
        presentacion: l.presentacion === "media_largo" || l.presentacion === "media_ancho" ? l.presentacion : null,
      })),
    );
    setPresupuesto({
      id: r.id,
      numero: r.numero,
      contacto: r.customerId ? null : r.contactoNombre.trim() || null,
      telefono: r.customerId ? null : r.contactoTelefono,
    });
    if (r.customerId) {
      const c = await clientePorId(r.customerId);
      if (c) await alElegirCliente(c as Cliente);
    }
    setAviso({ tipo: "ok", texto: `${r.numero} cargado.` });
    enfocar("buscador");
  }

  /**
   * Reabre un corte de la venta para corregirlo, con el precio de la placa
   * para el cliente de ahora: si se eligió otro cliente después de agregarlo,
   * el renglón volvía a armarse con el precio del anterior y podía pedir un
   * PIN sin motivo (revisión del carril F).
   */
  async function corregirCorte(id: string) {
    const c = cortes.find((x) => x.id === id);
    if (!c) return;
    let placa = c.placa;
    try {
      const precios = await preciosDelCliente([c.placa.variantId], cliente?.id ?? null);
      const precio = precios[c.placa.variantId];
      if (precio > 0) placa = { ...c.placa, precio };
    } catch {
      // Sin respuesta queda el precio con el que se agregó: Go igual pone el
      // de lista y, si hace falta, pide el PIN.
    }
    setCorrigiendo({ ...c, placa });
    setCortando(placa);
  }

  // Las variantes de la venta y el cliente: cuando cambian, se vuelve a ver
  // si su lista le da algo mejor que la general.
  const conListaPropia = Boolean(cliente?.priceListId && cliente.priceListId !== listaGeneral);
  const idsDeLaVenta = lineas.map((l) => l.variantId).filter((v): v is string => !!v);
  const claveDeVentaja = conListaPropia && cliente ? `${cliente.id}:${idsDeLaVenta.join(",")}` : "";
  useEffect(() => {
    if (!claveDeVentaja || !cliente || idsDeLaVenta.length === 0 || !conexion.enLinea) return;
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const hay = await ventajaDeLaLista(idsDeLaVenta, cliente.id);
        if (vigente) setVentajaDeLista({ clave: claveDeVentaja, hay });
      } catch {
        // Sin respuesta queda la regla de siempre: su lista es de contado.
      }
    }, 200);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
    // idsDeLaVenta y cliente salen de claveDeVentaja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveDeVentaja, conexion.enLinea]);
  // Sin renglones todavía, o sin saber, se aplica la regla: es de contado.
  const listaDeContado =
    conListaPropia && !aLista && !(ventajaDeLista?.clave === claveDeVentaja && !ventajaDeLista.hay && idsDeLaVenta.length > 0);

  /** Pasa la venta a la lista general (y vuelve), con los precios de esa lista. */
  async function alternarALista() {
    const nuevo = !aLista;
    const ids = lineas.map((l) => l.variantId).filter((v): v is string => !!v);
    const precios = ids.length > 0 ? await preciosDelCliente(ids, nuevo ? null : (cliente?.id ?? null)) : {};
    setALista(nuevo);
    setLineas((prev) =>
      prev.map((l) =>
        // La media placa y lo del corte se dejan: el precio que vuelve es el
        // de la placa entera.
        l.variantId && !l.presentacion && !l.corteId && precios[l.variantId] > 0
          ? { ...l, precioUnitario: precios[l.variantId], precioLista: precios[l.variantId] }
          : l,
      ),
    );
  }

  // El cliente del corte traído, si tiene: se busca una vez al abrir.
  const clienteDelCorte = corteACobrar?.customerId ?? null;
  useEffect(() => {
    if (!clienteDelCorte) return;
    let vigente = true;
    void clientePorId(clienteDelCorte).then((c) => {
      if (vigente && c) setCliente({ ...c, estado: c.estado ?? "activo" } as Cliente);
    });
    return () => {
      vigente = false;
    };
  }, [clienteDelCorte]);

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

    // Cada renglón del corte viaja atado a su despiece, y Go controla que
    // cada corte cobre lo de su plano.
    const conLosCortes = paraCobrar(lineas, cortes);
    empezar(async () => {
      /*
       * Internet se puede cortar entre un latido y el otro (cada 20 s): la
       * pantalla todavía cree que hay conexión y la acción del servidor tira
       * un error de red. Sin esto, ese error tumbaba el mostrador entero
       * («Se nos rompió algo») con la venta cargada y la plata en el cajón
       * (recorrido del comité, 25/11). Ahora se pregunta si hay servidor: si
       * no hay, la venta va a la cola con la misma clave —si la primera había
       * llegado, Go la reconoce por `clave_mostrador` y no la repite—; si hay,
       * queda cargada para volver a cobrar.
       */
      let r: Awaited<ReturnType<typeof cobrarVenta>>;
      try {
        r = await cobrarVenta({
          clave,
          branchId: sucursal.id,
          lineas: conLosCortes.lineas,
          customerId: cliente?.id ?? null,
          contactoNombre: cliente?.nombre ?? (presupuesto?.contacto || "Consumidor final"),
          ...(!cliente && presupuesto?.telefono ? { contactoTelefono: presupuesto.telefono } : {}),
          medioPago: medio,
          pagos: pagosDeLaVenta(),
          acopio,
          ...(conLosCortes.cortes.length > 0 ? { cortes: conLosCortes.cortes } : {}),
          comprobante,
          cuit: cuit || null,
          descuento: descuentoManual,
          descuentoMotivo: motivoDesc || null,
          ...(partidoEnMedios ? { sinEscala: true } : {}),
          ...(aLista ? { aLista: true } : {}),
          ...(pin ? { pin } : ficha ? { ficha } : {}),
          ...(presupuesto ? { presupuestoId: presupuesto.id } : {}),
        });
      } catch {
        if (!(await conexion.latir())) {
          await cobrarSinConexion();
          return;
        }
        setAviso({ tipo: "error", texto: "No se pudo cobrar. Probá de nuevo: la venta sigue cargada." });
        return;
      }

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
        // Las tarifas de corte se cargaron al abrir la pantalla: si el admin
        // cambió una, se traen las nuevas para que «Corregir» arme el corte
        // con ellas (texto de revisarCobroDelCorte, mostrador/controles.go).
        if (r.error.startsWith("Las tarifas de corte cambiaron")) router.refresh();
        setAviso({ tipo: "error", texto: r.error });
        return;
      }

      // El aviso del comprobante no es un error de la venta: la venta está
      // hecha y lo que falta es el papel. Se muestra distinto a propósito.
      // Lo vendido de más tampoco: la venta está, y lo que falta hay que
      // pedirlo (H218).
      const avisos = [r.avisoFiscal, r.avisoStock].filter(Boolean).join(" ");
      setAviso(
        avisos
          ? { tipo: "error", texto: `${r.ok} ${avisos}` }
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
      copia.apartar(conLosCortes.lineas, false);
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
      /*
       * El presupuesto va a precio de lista, y el total con el descuento de la
       * pantalla queda escrito en sus notas: se le decía al cliente un número
       * (con el 10 % en efectivo) y el PDF y la ficha decían otro (mes
       * simulado, H021). Va en las notas y no en el total porque el
       * descuento depende de cómo pague.
       */
      const notas = notaDelPresupuesto({ descuento, descuentoManual, medio, motivo: motivoDelDescuento, total });
      const r = await emitirPresupuestoDeMostrador({
        branchId: sucursal.id,
        lineas,
        customerId: cliente?.id ?? null,
        contactoNombre: cliente?.nombre ?? "Consumidor final",
        notas,
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
    <>
      {/* En el teléfono no se vende (decisión 2 del comité final): no entran el
          buscador, la venta y el cobro, y armar otra pantalla para eso no vale
          lo que cuesta. La tablet vertical sí: abajo de `lg` se apila. */}
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-background p-6 text-center text-foreground sm:hidden">
        <p className="text-xl font-semibold">Usalo en la computadora o la tablet.</p>
        {/* No es un callejón: el panel sí anda en el teléfono. */}
        <Link
          href="/admin"
          className="boton-accion inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold"
        >
          Volver al panel
        </Link>
      </div>
      {/* Abajo de `lg` (la tablet vertical) la venta y el cobro van uno abajo
          del otro, la página scrollea y el total con «Cobrar» queda fijo abajo
          (comité final, M15): a 768 px el panel de 420 dejaba el total en «$» y
          cortaba los medios. Abajo se deja lo que mide esa barra, con el aviso
          y el papel de la venta que van con ella (`--pie-del-cobro`, lo
          escribe `Cobro`). */}
      <div className="panel textura hidden min-h-screen flex-col bg-background pb-[var(--pie-del-cobro,20rem)] text-foreground sm:flex lg:h-screen lg:overflow-hidden lg:pb-0">
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
              leida={cajaLeida}
              branchId={sucursal.id}
              enLinea={conexion.enLinea}
              vinculada={cajaFisica ? { id: cajaFisica.id, codigo: cajaFisica.codigo } : null}
              onVincular={vincularCaja}
              onDesvincular={() => desvincularCaja()}
              administra={usuario.administraCaja}
              pendientesLocales={cola.sinSubir + cola.atascadas}
            />
          }
        />

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
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
              onNoEntra={(texto) => setAviso({ tipo: "error", texto })}
              onPresupuesto={(numero) => void traerPresupuesto(numero)}
              sePuedeCortar={conexion.enLinea}
              sinConexion={!conexion.enLinea}
            />
            <Lineas
              lineas={lineas}
              sinCargo={cortesSinRenglones(lineas, cortes).map((c) => ({ id: c.id, descripcion: c.corte.materialDescripcion }))}
              onCambiar={setLineas}
              onEditarCorte={(id) => void corregirCorte(id)}
              onQuitarCorte={(id) => {
                const r = sinElCorte(lineas, cortes, id);
                setLineas(r.lineas);
                setCortes(r.cortes);
              }}
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
          <aside className="flex w-full flex-col border-t border-linea bg-card lg:w-[420px] lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[560px] 2xl:w-[620px]">
            <Cobro
              branchId={sucursal.id}
              buscarClienteLocal={buscarClienteLocal}
              sinFicha={cliente ? null : presupuesto?.contacto}
              listaDeContado={listaDeContado}
              aLista={aLista}
              onALista={conListaPropia ? () => void alternarALista() : undefined}
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
              pideDocumento={pideDocumento}
              cuitMal={cuitDeLaFichaMal}
              letra={letraVisible}
              medio={medio}
              onMedio={elegirMedio}
              recibido={recibido}
              onRecibido={setRecibido}
              cambio={cambio}
              faltaRecibido={faltaRecibido}
              escalaSinCorrer={escalaSinCorrer?.etiqueta ?? null}
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
              ultimaCompacta={ventaEmpezada}
              puedeFacturar={Boolean(usuario.factura)}
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
              descripcion: cortando.medida ? `${cortando.producto} — ${cortando.medida}` : cortando.producto,
              unidad: cortando.unidad,
              precio: cortando.precio,
              largoMm: cortando.largoMm ?? null,
              anchoMm: cortando.anchoMm ?? null,
              color: cortando.color ?? null,
              formaDeVenta: cortando.formaDeVenta,
              precioMediaPct: cortando.precioMediaPct,
            }}
            anchoSierra={anchoSierra}
            corrigiendo={corrigiendo !== null}
            inicial={
              corrigiendo
                ? corrigiendo.estado
                : corteExistente && corteACobrar && cortando.variantId === corteACobrar.variantId
                  ? { piezas: corteACobrar.piezas, mitad: corteACobrar.mitad, canto: corteACobrar.canto, fijadas: [] }
                  : borradorDelCorte &&
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
              // El corte traído que se cierra sin agregar deja de estar atado.
              if (corteExistente && !cortes.some((c) => c.corte.existente === corteExistente)) setCorteExistente(null);
              // Cerrar la corrección deja el corte como estaba en la venta.
              if (corrigiendo) {
                setCorrigiendo(null);
                setCortando(null);
                volverDe("corte");
                return;
              }
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
            onAgregar={(nuevas, elCorte, estado) => {
              // Reabierto, el corte se reemplaza: sus renglones viejos salen.
              // El corte traído de la cola se ata a la venta en vez de crear otro.
              const existente =
                corrigiendo?.corte.existente ??
                (corteExistente && corteACobrar && cortando.variantId === corteACobrar.variantId && !cortes.some((c) => c.corte.existente === corteExistente)
                  ? corteExistente
                  : null);
              const r = conElCorte(lineas, cortes, {
                id: corrigiendo?.id ?? crypto.randomUUID(),
                placa: cortando,
                corte: existente ? { ...elCorte, existente } : elCorte,
                estado,
              }, nuevas);
              setLineas(r.lineas);
              setCortes(r.cortes);
              setCorrigiendo(null);
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
            ultimoContado={ultimoContado}
            cajaId={cajaFisica?.id ?? null}
            onRehacer={(renglones, conCorte, venta) => {
              setLineas((prev) => [...prev, ...renglones]);
              /* La venta rehecha sale como la anulada: a cuenta sigue a
                 cuenta, y no vuelve a contado con el descuento de efectivo
                 (mes simulado, H269). Un pago partido se vuelve a partir. */
              const medioAnterior = venta.medios && venta.medios.length > 1 ? null : MEDIOS.find((m) => m.valor === venta.medioPago);
              if (medioAnterior) {
                setPartes(null);
                setMedio(medioAnterior.valor);
              }
              setAcopio(venta.estado === "listo");
              setCaja(false);
              setCajaParaCobrar(false);
              if (conCorte) setAviso({ tipo: "error", texto: "El corte de esa venta se vuelve a armar." });
              // Rehacer es casi siempre cambiarle el cliente: el cursor va ahí.
              requestAnimationFrame(() => enfocar("cliente"));
            }}
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
    </>
  );
}
