"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Landmark,
  Loader2,
  Lock,
  NotebookPen,
  PenLine,
  Plus,
  FileText,
  Printer,
  Receipt,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearMonto, formatearPrecio } from "@/lib/formato";
import { totalDeLaVenta, vuelto, type LineaDeVenta } from "@/lib/mostrador/importes";
import type { MedioDeMostrador } from "@/lib/mostrador/importes";
import {
  abrirCaja,
  buscarClientes,
  buscarEnMostrador,
  cerrarCaja,
  cobrarVenta,
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

interface Cliente {
  id: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  estado: string;
}

const MEDIOS: { valor: MedioDeMostrador; texto: string; Icono: typeof Banknote }[] = [
  { valor: "efectivo", texto: "Efectivo", Icono: Banknote },
  { valor: "debito", texto: "Débito", Icono: CreditCard },
  { valor: "credito", texto: "Crédito", Icono: CreditCard },
  { valor: "transferencia", texto: "Transferencia", Icono: Landmark },
  { valor: "cuenta_corriente", texto: "Cuenta corriente", Icono: NotebookPen },
];

/** Una clave nueva por venta: es lo que impide que el doble toque cobre dos veces. */
function claveNueva() {
  return crypto.randomUUID();
}

/* -------------------------------------------------------------------------- */
/* Pantalla                                                                    */
/* -------------------------------------------------------------------------- */

export function VistaMostrador({
  usuario,
  sucursales,
  sucursal,
  turno,
  movimientos,
}: {
  usuario: { nombre: string };
  sucursales: Sucursal[];
  sucursal: Sucursal;
  turno: Turno | null;
  movimientos: Movimiento[];
}) {
  const router = useRouter();
  const [enviando, empezar] = useTransition();

  const [lineas, setLineas] = useState<LineaDeVenta[]>([]);
  const [clave, setClave] = useState(claveNueva);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [medio, setMedio] = useState<MedioDeMostrador>("efectivo");
  const [recibido, setRecibido] = useState("");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [otrosPrecios, setOtrosPrecios] = useState<Record<string, number> | null>(null);
  const [comprobante, setComprobante] = useState<"interno" | "fiscal">("interno");
  const [cuit, setCuit] = useState("");
  const [letra, setLetra] = useState<string | null>(null);
  const [ultima, setUltima] = useState<{
    numero: string;
    orderId: string;
    invoiceId?: string;
  } | null>(null);
  const [caja, setCaja] = useState(false);
  const [suelta, setSuelta] = useState<string | null>(null);

  const total = useMemo(() => totalDeLaVenta(lineas), [lineas]);
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

  function limpiar() {
    setLineas([]);
    setCliente(null);
    setMedio("efectivo");
    setRecibido("");
    setClave(claveNueva());
    setOtrosPrecios(null);
    setComprobante("interno");
    setCuit("");
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

  function cobrar() {
    setAviso(null);
    empezar(async () => {
      const r = await cobrarVenta({
        clave,
        branchId: sucursal.id,
        lineas,
        customerId: cliente?.id ?? null,
        contactoNombre: cliente?.nombre ?? "Consumidor final",
        medioPago: medio,
        comprobante,
        cuit: cuit || null,
      });

      if (r.error) {
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
        setUltima({ numero: r.numero, orderId: r.orderId, invoiceId: r.invoiceId });
      }
      limpiar();
      router.refresh();
    });
  }

  return (
    <div className="panel flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <BarraSuperior
        usuario={usuario}
        sucursales={sucursales}
        sucursal={sucursal}
        turno={turno}
        onCaja={() => setCaja(true)}
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          <Buscador
            branchId={sucursal.id}
            customerId={cliente?.id ?? null}
            onElegir={(l) => setLineas((prev) => sumar(prev, l))}
            onSuelta={setSuelta}
          />
          <Lineas
            lineas={lineas}
            onCambiar={setLineas}
            onLimpiar={limpiar}
          />
        </section>

        <aside className="flex w-[400px] shrink-0 flex-col border-l border-linea bg-card">
          <Cobro
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
            onMedio={setMedio}
            recibido={recibido}
            onRecibido={setRecibido}
            cambio={cambio}
            hayCaja={Boolean(turno)}
            enviando={enviando}
            puede={lineas.length > 0}
            onCobrar={cobrar}
            aviso={aviso}
            ultima={ultima}
          />
        </aside>
      </div>

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
          movimientos={movimientos}
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
  usuario,
  sucursales,
  sucursal,
  turno,
  onCaja,
}: {
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
  branchId,
  customerId,
  onElegir,
  onSuelta,
}: {
  branchId: string;
  customerId: string | null;
  onElegir: (l: LineaDeVenta) => void;
  /** Abre el alta a mano con el texto que ya se tipeó. */
  onSuelta: (descripcion: string) => void;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<
    Awaited<ReturnType<typeof buscarEnMostrador>>
  >([]);
  const [buscando, setBuscando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  // El foco arranca acá y vuelve acá después de cada ítem: en el mostrador se
  // tipea sin mirar, y un cursor que se va obliga a soltar el teclado.
  useEffect(() => {
    campo.current?.focus();
  }, []);

  // Espera corta: quien tipea rápido no dispara una consulta por tecla. Todo
  // el estado se toca adentro del temporizador y nada sincrónicamente en el
  // efecto, que es lo que dispara renders en cascada.
  useEffect(() => {
    const consulta = texto.trim();
    if (consulta.length < 2) return;

    const t = setTimeout(async () => {
      setBuscando(true);
      const r = await buscarEnMostrador(consulta, branchId, customerId);
      setResultados(r);
      setBuscando(false);
    }, 180);

    return () => clearTimeout(t);
  }, [texto, branchId, customerId]);

  /*
   * Lo que se muestra se deriva del texto y no se guarda: así, al borrar el
   * campo la lista desaparece en el acto, sin esperar los 180 ms ni guardar un
   * estado que después hay que acordarse de limpiar.
   */
  const visibles = texto.trim().length < 2 ? [] : resultados;

  function elegir(r: (typeof resultados)[number]) {
    onElegir({
      variantId: r.variantId,
      descripcion: `${r.producto} — ${r.medida}`,
      unidad: r.unidad,
      cantidad: 1,
      precioUnitario: r.precio,
    });
    setTexto("");
    setResultados([]);
    campo.current?.focus();
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-card px-4">
        <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
        <input
          ref={campo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (visibles.length > 0) {
                elegir(visibles[0]);
              } else if (texto.trim().length >= 2 && !buscando) {
                /*
                 * Enter sobre algo que no está en el catálogo abre la carga a
                 * mano con ese texto. En el mostrador se tipea "corte a
                 * medida" o "flete centro" y se espera que pase algo; que no
                 * pase nada obliga a buscar otro camino con alguien esperando
                 * enfrente.
                 */
                onSuelta(texto.trim());
                setTexto("");
              }
            }
            if (e.key === "Escape") setTexto("");
          }}
          placeholder="Buscá por nombre, medida o código…"
          className="h-14 flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />
        {buscando && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {texto.trim().length >= 2 && visibles.length === 0 && !buscando && (
        <div className="absolute inset-x-0 top-full z-20 mt-1.5 rounded-xl border border-linea bg-popover p-4 shadow-lg">
          <p className="text-base text-muted-foreground">
            No hay nada en el catálogo con «{texto.trim()}».
          </p>
          <button
            onClick={() => {
              onSuelta(texto.trim());
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
            <li key={r.variantId}>
              <button
                onClick={() => elegir(r)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hundida"
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
                {i === 0 && (
                  <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>
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
          {lineas.length} {lineas.length === 1 ? "ítem" : "ítems"}
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
              <span className="block text-sm text-muted-foreground">por {l.unidad}</span>
            </span>

            <label className="shrink-0">
              <span className="sr-only">Cantidad de {l.descripcion}</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={l.cantidad}
                onChange={(e) => cambiar(i, "cantidad", Number(e.target.value))}
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
  recibido,
  onRecibido,
  cambio,
  hayCaja,
  enviando,
  puede,
  onCobrar,
  aviso,
  ultima,
}: {
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
  recibido: string;
  onRecibido: (v: string) => void;
  cambio: number | null;
  hayCaja: boolean;
  enviando: boolean;
  puede: boolean;
  onCobrar: () => void;
  aviso: { tipo: "ok" | "error"; texto: string } | null;
  ultima: { numero: string; orderId: string; invoiceId?: string } | null;
}) {
  const faltaCaja = medio === "efectivo" && !hayCaja;
  const faltaCliente = medio === "cuenta_corriente" && !cliente;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-linea p-4">
        <BuscadorDeCliente cliente={cliente} onCliente={onCliente} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Cómo paga
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          {MEDIOS.map(({ valor, texto, Icono }) => (
            <button
              key={valor}
              onClick={() => onMedio(valor)}
              className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-base font-medium transition-colors ${
                medio === valor
                  ? "border-accion bg-accion text-white"
                  : "border-linea hover:bg-hundida"
              } ${valor === "cuenta_corriente" ? "col-span-2" : ""}`}
            >
              <Icono className="h-4 w-4" />
              {texto}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Qué se lleva
        </p>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            onClick={() => onComprobante("interno")}
            className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-base font-medium transition-colors ${
              comprobante === "interno"
                ? "border-accion bg-accion text-white"
                : "border-linea hover:bg-hundida"
            }`}
          >
            <Receipt className="h-4 w-4" />
            Comprobante
          </button>
          <button
            onClick={() => onComprobante("fiscal")}
            className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border text-base font-medium transition-colors ${
              comprobante === "fiscal"
                ? "border-accion bg-accion text-white"
                : "border-linea hover:bg-hundida"
            }`}
          >
            <FileText className="h-4 w-4" />
            {/* La letra la calcula el servidor con la condición de las dos
                partes. Antes de que conteste se dice "Factura" a secas: mejor
                eso que anunciar una letra que después cambia. */}
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

        {medio === "efectivo" && (
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

        {otrosPrecios && (
          <div className="estado-info mt-4 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-[var(--estado-tinta)]">
            <p className="text-base leading-relaxed">
              {cliente?.nombre} tiene otra lista de precios. Los ítems que ya
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

        {faltaCaja && (
          <p className="estado-problema mt-4 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
            No hay caja abierta en esta sucursal. Abrila para poder cobrar en
            efectivo.
          </p>
        )}

        {faltaCliente && (
          <p className="estado-espera mt-4 rounded-xl bg-[var(--estado-fondo)] p-3.5 text-base text-[var(--estado-tinta)]">
            Elegí el cliente: la cuenta corriente necesita saber a quién anotarle
            la deuda.
          </p>
        )}

        {aviso && (
          <p
            className={`mt-4 rounded-xl p-3.5 text-base ${
              aviso.tipo === "ok" ? "estado-ok" : "estado-problema"
            } bg-[var(--estado-fondo)] text-[var(--estado-tinta)]`}
          >
            {aviso.texto}
          </p>
        )}

        {ultima && (
          <div className="mt-3 flex flex-wrap gap-2">
            {/* Si salió factura se imprime la factura, que es el papel que vale.
                Si no, el ticket del pedido, que dice expresamente que no es un
                comprobante fiscal. Las dos rutas piden ids distintos: la
                primera el de la factura, la segunda el del pedido. */}
            <Link
              href={
                ultima.invoiceId
                  ? `/comprobante/${ultima.invoiceId}`
                  : `/ticket/${ultima.orderId}`
              }
              target="_blank"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
            >
              <Printer className="h-4 w-4" />
              Imprimir {ultima.numero}
            </Link>
            {!ultima.invoiceId && (
              <Link
                href={`/admin/facturacion?pedido=${ultima.orderId}`}
                target="_blank"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
              >
                <Plus className="h-4 w-4" />
                Facturar
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-linea p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-semibold">Total</span>
          <span className="tabular text-[34px] font-bold leading-none tracking-tight">
            {formatearMonto(total)}
          </span>
        </div>

        <button
          onClick={onCobrar}
          disabled={!puede || enviando || faltaCaja || faltaCliente}
          className="mt-3.5 inline-flex h-16 w-full items-center justify-center gap-2.5 rounded-xl bg-accion text-xl font-bold text-white transition-colors hover:bg-accion-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <>Cobrar</>
          )}
        </button>
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
          placeholder="Consumidor final — buscá para cambiar"
          className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>

      {visibles.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-72 overflow-y-auto rounded-xl border border-linea bg-popover shadow-lg">
          {visibles.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  onCliente(c);
                  setTexto("");
                  setResultados([]);
                }}
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
  movimientos,
  onCerrar,
}: {
  sucursal: Sucursal;
  turno: Turno | null;
  movimientos: Movimiento[];
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

  return (
    /*
     * El diálogo del sistema y no un `div` fijo propio. No es cosmético: este
     * trae el foco atrapado adentro, cierra con Escape y devuelve el foco al
     * botón que lo abrió. Armado a mano, el teclado seguía llegando a la venta
     * de atrás —el fondo inicial terminaba escrito en el campo del cobro—.
     */
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-linea px-5 py-3.5">
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
                disabled={trabajando || fondo === ""}
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

                {diferencia !== null && (
                  <p className="mt-2 flex items-baseline justify-between text-lg">
                    <span className="text-muted-foreground">Diferencia</span>
                    <span
                      className={`tabular font-bold ${
                        Math.abs(diferencia) < 0.01
                          ? "text-saldo-cero"
                          : diferencia < 0
                            ? "text-saldo-debe"
                            : "text-saldo-favor"
                      }`}
                    >
                      {formatearMonto(diferencia)}
                    </span>
                  </p>
                )}

                <input
                  value={notas}
                  onChange={(e) => setNotas(e.target.value)}
                  placeholder="Notas del cierre (opcional)"
                  className="mt-2.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
                />

                <button
                  disabled={trabajando || contado === ""}
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
        </div>
      </DialogContent>
    </Dialog>
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

        <div className="space-y-3.5">
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
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  agregar();
                }
              }}
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
            onClick={agregar}
            disabled={!valido}
            className="inline-flex h-14 w-full items-center justify-center rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
          >
            Agregar a la venta
          </button>
        </div>
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
