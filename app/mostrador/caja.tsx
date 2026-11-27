"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Lock, Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fechaHora, formatearImporte, hora, importeIlegible, importeParaElCampo } from "@/lib/formato";
import { importeDeCaja, nombreDeLaDiferencia, TOLERANCIA_ARQUEO } from "@/lib/mostrador/arqueo";
import { encolarMovimiento } from "@/lib/mostrador/offline/cola";
import type { RenglonDelCierre } from "@/lib/mostrador/tipos";
import type { LineaDeVenta } from "@/lib/mostrador/importes";
import { abrirCaja, cerrarCaja, registrarMovimientoDeCaja } from "./actions";
import { NOMBRE_DEL_MEDIO } from "./medios";
import type { Sucursal, Turno, Movimiento, TurnoCerradoDelMostrador, VentaDeHoy } from "./tipos";
import { VentasDeHoy, type DatosParaRehacer } from "./ventas-de-hoy";


type Destino = "banco" | "caja_fuerte" | "otro";

/** Lo que dice un retiro sin motivo escrito (el mismo texto que pone Go). */
const DESTINO: Record<Destino, { motivo: string; chip: string }> = {
  banco: { motivo: "Depósito en el banco", chip: "Banco" },
  caja_fuerte: { motivo: "A la caja fuerte", chip: "Caja fuerte" },
  otro: { motivo: "", chip: "" },
};

/** Lo que dice un ingreso sin motivo escrito (MotivoDelOrigen en Go). */
const ORIGEN: Record<Destino, string> = {
  banco: "Extracción del banco",
  caja_fuerte: "De la caja fuerte",
  otro: "",
};

/*
 * El retiro dice a dónde va la plata (H333) y el ingreso de dónde viene
 * (M3S3-014): de la caja fuerte y del banco, sin escribir nada; «otro», con
 * el motivo. Una fila para lo que entra y otra para lo que sale.
 */
const ENTRA: { destino: Destino; texto: string }[] = [
  { destino: "caja_fuerte", texto: "De caja fuerte" },
  { destino: "banco", texto: "Del banco" },
  { destino: "otro", texto: "Otro ingreso" },
];
const SALE: { destino: Destino; texto: string }[] = [
  { destino: "banco", texto: "Al banco" },
  { destino: "caja_fuerte", texto: "A caja fuerte" },
  { destino: "otro", texto: "Otro retiro" },
];

/**
 * Lo que se paga del cajón es un gasto, con su categoría: el flete pagado en
 * mano no aparecía en ningún archivo (mes simulado, M3S1-005). Las de
 * categoria_gasto.
 */
const PAGOS: [string, string][] = [
  ["flete", "Flete"],
  ["combustible", "Combustible"],
  ["mantenimiento", "Mantenimiento"],
  ["servicios", "Servicios"],
  ["librería", "Librería"],
  ["sueldos", "Sueldos"],
  ["otros", "Otro gasto"],
];

/** El turno cerrado, como se imprime: el recién cerrado o el último de hoy. */
interface TurnoCerrado {
  turno: Pick<Turno, "sucursal" | "abiertaPor" | "abiertaAt" | "fondoInicial" | "ventasEnEfectivo" | "otrosIngresos" | "retiros" | "devoluciones" | "gastos" | "esperado">;
  cierre: RenglonDelCierre[];
  movimientos: Movimiento[];
  contado: number;
  notas: string;
  mensaje: string;
  cerradoAt: Date;
}

/** El último turno cerrado hoy (de la pantalla), como se imprime. */
function papelDelUltimo(u: TurnoCerradoDelMostrador): TurnoCerrado {
  return {
    turno: {
      sucursal: u.sucursal,
      abiertaPor: u.abiertaPor,
      abiertaAt: new Date(u.abiertaAt),
      fondoInicial: u.fondo,
      ventasEnEfectivo: u.ventas,
      otrosIngresos: u.otrosIngresos,
      retiros: u.retiros,
      devoluciones: u.devoluciones,
      gastos: u.gastos,
      esperado: u.esperado,
    },
    cierre: u.cierre,
    movimientos: u.movimientos,
    contado: u.contado ?? 0,
    notas: u.notas ?? "",
    mensaje: "",
    cerradoAt: u.cerradaAt ? new Date(u.cerradaAt) : new Date(),
  };
}

export function PanelDeCaja({
  sucursal,
  turno,
  ultimoCierre = null,
  fondoBase,
  ultimoContado,
  cajaId,
  cierre,
  movimientos,
  ventas,
  enLinea,
  onRehacer,
  onEncolado,
  onAbierta,
  focoAlCerrar,
  onCerrar,
}: {
  sucursal: Sucursal;
  turno: Turno | null;
  /** El último turno cerrado hoy, para reimprimir su papel (M2S2-064). */
  ultimoCierre?: TurnoCerradoDelMostrador | null;
  /**
   * El cambio de la sucursal, para poder decirlo **antes** de abrir la caja:
   * con el turno cerrado no hay de dónde leerlo.
   */
  fondoBase: number;
  /**
   * Lo que quedó contado al cerrar el turno anterior: es con lo que abre el
   * siguiente. Abrir con la base hacía desaparecer la diferencia entre turnos
   * sin un solo movimiento (mes simulado, H024 y H249).
   */
  ultimoContado: number | null;
  /** La caja física de esta PC: el turno queda atado a ese puesto. */
  cajaId: string | null;
  cierre: RenglonDelCierre[];
  movimientos: Movimiento[];
  ventas: VentaDeHoy[];
  enLinea: boolean;
  /** «Anular y rehacer» una venta de hoy: sus renglones, su cliente, cómo pagó y su corte vuelven a la venta. */
  onRehacer?: (renglones: LineaDeVenta[], conCorte: boolean, venta: VentaDeHoy, datos?: DatosParaRehacer) => void;
  onEncolado: () => void;
  /** Se abrió el turno, con el mensaje de Go. */
  onAbierta?: (mensaje: string) => void;
  /** A dónde vuelve el cursor al cerrar el panel. */
  focoAlCerrar?: () => HTMLElement | null;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [trabajando, empezar] = useTransition();
  // El fondo arranca con lo que quedó contado: es lo normal, y Enter abre.
  // La primera vez, con el cambio fijo (M2S1-177).
  const [fondo, setFondo] = useState(() =>
    ultimoContado !== null ? importeParaElCampo(ultimoContado) : fondoBase > 0 ? importeParaElCampo(fondoBase) : "",
  );
  const [motivoApertura, setMotivoApertura] = useState("");
  /*
   * La diferencia con lo que quedó, ¿es un conteo mal hecho o plata que
   * entró o salió? Contar mal no es sacar plata: cargado como retiro, la
   * caja fuerte sumaba lo que no existía y el sobrante quedaba como ganancia
   * (mes simulado, M2S3-002).
   */
  const [contoMal, setContoMal] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState<TurnoCerrado | null>(null);
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");

  const efectivoContado = importeDeCaja(contado);
  const diferencia =
    turno && efectivoContado !== null ? efectivoContado - turno.esperado : null;
  const importeDelMovimiento = importeDeCaja(monto);

  // Lo que el fondo deja entre turnos: si no es lo contado, hay que decir
  // adónde fue o de dónde vino (Go lo exige igual).
  const fondoTipeado = importeDeCaja(fondo);
  const entreTurnos =
    ultimoContado !== null && fondoTipeado !== null && Math.abs(ultimoContado - fondoTipeado) > TOLERANCIA_ARQUEO
      ? ultimoContado - fondoTipeado
      : 0;
  const puedeAbrir = !trabajando && fondoTipeado !== null && enLinea && (entreTurnos === 0 || motivoApertura.trim() !== "");

  function abrir() {
    if (!puedeAbrir || fondoTipeado === null) return;
    empezar(async () => {
      const r = await abrirCaja(sucursal.id, fondoTipeado, { motivo: motivoApertura, cajaId, corregir: entreTurnos !== 0 && contoMal });
      setAviso(r.error ?? r.ok ?? null);
      if (!r.error) {
        setFondo("");
        setMotivoApertura("");
        setCerrado(null);
        router.refresh();
        onAbierta?.(r.ok ?? "Caja abierta.");
      }
    });
  }

  /** Un ingreso, un retiro o un pago del cajón (con categoría: un gasto). */
  function mover(turnoAbierto: Turno, t: "ingreso" | "retiro", destino: Destino, categoria?: string) {
    empezar(async () => {
      if (importeDelMovimiento === null) return;
      /*
       * El piso de cambio también sin conexión: el servidor lo controla al
       * registrar el retiro, pero sin conexión no hay servidor y la cuenta
       * se hace con el esperado que ya está en pantalla. Sin base de cambio,
       * el piso es cero: el retiro no deja el cajón en negativo (como Go).
       */
      const piso = Math.max(0, turnoAbierto.fondoBase);
      if (t === "retiro" && turnoAbierto.esperado - importeDelMovimiento - piso < -0.009) {
        const disponible = Math.max(0, Math.round((turnoAbierto.esperado - piso) * 100) / 100);
        setAviso(
          piso > 0 && disponible > 0
            ? `Ese retiro deja el cajón sin el cambio de la base (${formatearImporte(turnoAbierto.fondoBase)}). Podés retirar hasta ${formatearImporte(disponible)}.`
            : piso > 0
              ? `No se puede retirar: en el cajón hay ${formatearImporte(turnoAbierto.esperado)} y la base de cambio es ${formatearImporte(turnoAbierto.fondoBase)}.`
              : disponible > 0
                ? `En el cajón hay ${formatearImporte(turnoAbierto.esperado)}. Podés retirar hasta ${formatearImporte(disponible)}.`
                : "No se puede retirar: el cajón no tiene efectivo.",
        );
        return;
      }
      const motivoFinal = motivo.trim() || (t === "ingreso" ? ORIGEN[destino] : DESTINO[destino].motivo);
      /*
       * Sin conexión el movimiento se encola en vez de perderse. La plata
       * sale del cajón en el momento, no cuando vuelve el wifi: si el retiro
       * no queda anotado, el arqueo de la noche muestra un faltante que nadie
       * va a poder explicar.
       */
      if (!enLinea) {
        await encolarMovimiento({
          clave: crypto.randomUUID(),
          branchId: sucursal.id,
          tipo: t,
          monto: importeDelMovimiento,
          motivo: motivoFinal,
          destino,
          hechoAt: new Date().toISOString(),
        });
        setAviso(`${t === "retiro" ? "Retiro" : "Ingreso"} anotado. Se sube cuando vuelva la conexión.`);
        setMonto("");
        setMotivo("");
        onEncolado();
        return;
      }
      const r = await registrarMovimientoDeCaja(turnoAbierto.id, t, importeDelMovimiento, motivo, destino, categoria);
      setAviso(r.error ?? r.ok ?? null);
      if (!r.error) {
        setMonto("");
        setMotivo("");
        router.refresh();
      }
    });
  }

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
      <DialogContent
        finalFocus={focoAlCerrar}
        className="flex max-h-[calc(100vh-3rem)] w-full flex-col overflow-hidden p-0 sm:max-w-2xl"
      >
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

          {/* El turno que se acaba de cerrar, con su papel: al cerrar no
              quedaba nada para guardar con la plata (H024). Y sin turno
              abierto, el último cerrado hoy, para reimprimirlo si la
              impresora falló o se recargó la página (M2S2-064). */}
          {cerrado ? (
            <ResumenDelCierre cerrado={cerrado} />
          ) : (
            !turno && ultimoCierre && <ResumenDelCierre cerrado={papelDelUltimo(ultimoCierre)} />
          )}

          {!turno ? (
            <div>
              {ultimoContado !== null ? (
                <p className="flex items-baseline justify-between gap-3 text-base text-muted-foreground">
                  <span>Quedó al cerrar</span>
                  <span className="tabular font-semibold text-foreground">{formatearImporte(ultimoContado)}</span>
                </p>
              ) : (
                <p className="text-base text-muted-foreground">No hay caja abierta en esta sucursal.</p>
              )}
              {baseDeCambio > 0 && (
                <p className="mt-1 flex items-baseline justify-between gap-3 text-base text-muted-foreground">
                  <span>Cambio fijo</span>
                  <span className="tabular font-semibold text-foreground">{formatearImporte(baseDeCambio)}</span>
                </p>
              )}
              <label className="mt-4 block">
                <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Fondo inicial
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  // Se abre para cargar el fondo: el cursor arranca acá.
                  autoFocus
                  value={fondo}
                  aria-invalid={importeIlegible(fondo) || undefined}
                  onChange={(e) => setFondo(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    // Es el único dato: Enter (o Ctrl+Enter) abre la caja; si
                    // falta decir adónde fue la diferencia, va ahí.
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (entreTurnos !== 0 && !motivoApertura.trim()) {
                        document.querySelector<HTMLInputElement>('[data-foco="entre-turnos"]')?.focus();
                        return;
                      }
                      abrir();
                    }
                  }}
                  className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                />
              </label>
              {entreTurnos !== 0 && (
                <>
                  <div className="mt-2.5 grid grid-cols-2 gap-2" role="group" aria-label="La diferencia">
                    {[
                      { valor: false, texto: entreTurnos > 0 ? "Se retiró" : "Se agregó" },
                      { valor: true, texto: "Se contó mal" },
                    ].map((o) => (
                      <button
                        key={o.texto}
                        type="button"
                        aria-pressed={contoMal === o.valor}
                        onClick={() => setContoMal(o.valor)}
                        className={`h-11 rounded-xl border text-base font-medium transition-colors ${
                          contoMal === o.valor ? "border-accion bg-accion text-white" : "border-linea hover:bg-hundida"
                        }`}
                      >
                        {o.texto}
                      </button>
                    ))}
                  </div>
                  <input
                    data-foco="entre-turnos"
                    value={motivoApertura}
                    onChange={(e) => setMotivoApertura(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        abrir();
                      }
                    }}
                    placeholder={
                      contoMal
                        ? `Había ${formatearImporte(fondoTipeado ?? 0)}, no ${formatearImporte(ultimoContado ?? 0)}`
                        : entreTurnos > 0
                          ? `Adónde fueron los ${formatearImporte(entreTurnos)}`
                          : `De dónde salieron los ${formatearImporte(-entreTurnos)}`
                    }
                    className="estado-espera mt-2 h-12 w-full rounded-lg border border-[var(--estado-acento)] bg-background px-3 text-base"
                  />
                </>
              )}

              <button
                disabled={!puedeAbrir}
                onClick={abrir}
                className="mt-4 inline-flex h-14 w-full items-center justify-center rounded-xl bg-accion text-lg font-bold text-white transition-colors hover:bg-accion-hover disabled:opacity-40"
              >
                Abrir la caja
              </button>
              {/* Abrir y cerrar caja son en línea, y no por comodidad: el
                  índice único que garantiza un turno por sucursal vive en la
                  base. Dos máquinas abriendo sin conexión terminarían con dos
                  turnos y las ventas del día repartidas entre los dos. */}
              {!enLinea && (
                // Las ventas sin conexión entran al turno cuando vuelve.
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin conexión no se puede abrir la caja; sí se puede seguir vendiendo.
                </p>
              )}
            </div>
          ) : (
            <>
              <CuentaDelTurno turno={turno} />

              {/* El cambio que no se retira. Sin esto, «podés retirar hasta
                  tanto» aparecía recién como error al intentarlo. Si lo que
                  hay no alcanza, se ve en el acto y no en el arqueo (H177). */}
              {turno.fondoBase > 0 && (
                <p
                  className={`mt-2 flex items-baseline justify-between gap-3 text-base ${
                    turno.esperado < turno.fondoBase ? "estado-problema font-semibold" : "text-muted-foreground"
                  }`}
                >
                  <span>Cambio para mañana</span>
                  <span className="tabular font-semibold">
                    {formatearImporte(turno.fondoBase)}
                    {turno.esperado < turno.fondoBase &&
                      ` · faltan ${formatearImporte(turno.fondoBase - turno.esperado)}`}
                  </span>
                </p>
              )}

              {/* El cierre Z. Lo de arriba es el efectivo, que es lo único que
                  puede faltar del cajón; esto es todo lo que entró en el
                  turno, que es lo que hay que conciliar contra el posnet y el
                  banco. */}
              <CierreZ cierre={cierre} />

              <section className="mt-6">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Ingreso o retiro
                </h3>
                {/* Monto y motivo en un renglón, los cuatro destinos abajo:
                    en una sola fila el motivo quedaba sin ancho. */}
                <div className="mt-2 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={monto}
                      aria-invalid={importeIlegible(monto) || undefined}
                      onChange={(e) => setMonto(e.target.value)}
                      placeholder="Monto"
                      aria-label="Monto"
                      className="tabular h-12 w-32 rounded-lg border border-linea bg-background px-3 text-right text-base"
                    />
                    <input
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Motivo"
                      aria-label="Motivo"
                      className="h-12 min-w-0 flex-1 rounded-lg border border-linea bg-background px-3 text-base"
                    />
                  </div>
                  {/* Lo que entra y lo que sale, cada uno en su fila. */}
                  <div className="flex flex-wrap gap-2">
                    {ENTRA.map(({ destino, texto }) => (
                      <button
                        key={`entra-${destino}`}
                        disabled={trabajando || !(importeDelMovimiento !== null && importeDelMovimiento > 0) || (destino === "otro" && !motivo.trim())}
                        onClick={() => mover(turno, "ingreso", destino)}
                        className="h-12 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-40"
                      >
                        {texto}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {SALE.map(({ destino, texto }) => (
                      <button
                        key={`sale-${destino}`}
                        disabled={trabajando || !(importeDelMovimiento !== null && importeDelMovimiento > 0) || (destino === "otro" && !motivo.trim())}
                        onClick={() => mover(turno, "retiro", destino)}
                        className="h-12 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-40"
                      >
                        {texto}
                      </button>
                    ))}
                    {/* El pago del cajón, con su categoría: va como gasto. Sin
                        conexión no, porque el gasto lo registra el servidor. */}
                    <label className="contents">
                      <span className="sr-only">Pago del cajón</span>
                      <select
                        value=""
                        disabled={trabajando || !enLinea || !(importeDelMovimiento !== null && importeDelMovimiento > 0) || !motivo.trim()}
                        onChange={(e) => {
                          if (e.target.value) mover(turno, "retiro", "otro", e.target.value);
                        }}
                        className="h-12 rounded-lg border border-linea bg-background px-3 text-base font-medium transition-colors hover:bg-hundida disabled:opacity-40"
                      >
                        <option value="">Pago…</option>
                        {PAGOS.map(([valor, texto]) => (
                          <option key={valor} value={valor}>
                            {texto}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
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
                    type="text"
                    inputMode="decimal"
                    value={contado}
                    aria-invalid={importeIlegible(contado) || undefined}
                    onChange={(e) => setContado(e.target.value)}
                    className="tabular mt-1.5 h-14 w-full rounded-xl border border-linea bg-background px-3.5 text-right text-2xl font-semibold"
                  />
                </label>

                {/* Faltante o sobrante, con esa palabra: un número con signo
                    obliga a traducir, y es el dato que después hay que
                    explicar. Con centavos, los centavos: redondeado, el
                    arqueo escondía lo que faltaba. */}
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
                      {Math.abs(diferencia) < 0.005
                        ? "cierra"
                        : Math.abs(diferencia) <= TOLERANCIA_ARQUEO
                          ? `cierra · ${formatearImporte(diferencia)}`
                          : formatearImporte(Math.abs(diferencia))}
                    </span>
                  </p>
                )}

                {turno.fondoBase > 0 &&
                  contado !== "" &&
                  efectivoContado !== null &&
                  efectivoContado < turno.fondoBase && (
                    <p className="estado-espera mt-1 text-sm font-medium">
                      Quedan menos de {formatearImporte(turno.fondoBase)} de cambio.
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
                  aria-label="Notas del cierre"
                  aria-invalid={
                    (diferencia !== null && Math.abs(diferencia) > TOLERANCIA_ARQUEO && !notas.trim()) || undefined
                  }
                  className={`mt-2.5 h-12 w-full rounded-lg border bg-background px-3 text-base ${
                    diferencia !== null && Math.abs(diferencia) > TOLERANCIA_ARQUEO && !notas.trim()
                      ? "border-[var(--estado-acento)] estado-espera"
                      : "border-linea"
                  }`}
                />

                <button
                  disabled={
                    trabajando ||
                    efectivoContado === null ||
                    !enLinea ||
                    (diferencia !== null && Math.abs(diferencia) > TOLERANCIA_ARQUEO && !notas.trim())
                  }
                  onClick={() =>
                    empezar(async () => {
                      if (efectivoContado === null) return;
                      const r = await cerrarCaja(turno.id, efectivoContado, notas);
                      setAviso(r.error ?? null);
                      if (!r.error) {
                        setCerrado({
                          turno,
                          cierre,
                          movimientos,
                          contado: efectivoContado,
                          notas: notas.trim(),
                          mensaje: r.ok ?? "Caja cerrada.",
                          cerradoAt: new Date(),
                        });
                        setContado("");
                        setNotas("");
                        setFondo(importeParaElCampo(efectivoContado));
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
                  // Además faltaría contar las ventas que todavía no subieron:
                  // esa plata está en el cajón pero no en el turno.
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sin conexión no se puede cerrar.
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
                      <li
                        key={m.id}
                        className={`flex items-center gap-3 py-2.5 ${m.anulado ? "text-muted-foreground line-through" : ""}`}
                      >
                        <span className="min-w-0 flex-1 truncate text-base">
                          {m.motivo ?? m.tipo}
                        </span>
                        {/* Lo que cargó otra persona (un recibo cobrado desde el
                            panel), con su nombre: entraba en silencio (M2S2-063). */}
                        {m.otroPuesto && m.quien && (
                          <span className="estado-info shrink-0 rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm text-[var(--estado-tinta)]">
                            {m.quien}
                          </span>
                        )}
                        {m.tipo === "retiro" && m.destino && m.destino !== "otro" && !m.motivo?.startsWith(DESTINO[m.destino].motivo) && (
                          <span className="shrink-0 rounded-full bg-hundida px-2.5 py-0.5 text-sm text-muted-foreground">
                            {DESTINO[m.destino].chip}
                          </span>
                        )}
                        <span
                          className={`tabular shrink-0 font-semibold ${
                            m.monto < 0 ? "text-saldo-debe" : "text-saldo-favor"
                          }`}
                        >
                          {formatearImporte(m.monto)}
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
          <VentasDeHoy ventas={ventas} onRehacer={onRehacer} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * La cuenta del efectivo: fondo + ventas + otros ingresos − retiros −
 * devoluciones − gastos = «Debería haber». Las devoluciones y los gastos
 * aparecen cuando los hay: antes no estaban, y «Debería haber» decía $2.000
 * con los cuatro recuadros sumando $50.000 (mes simulado, H177 y H366).
 */
export function CuentaDelTurno({
  turno,
  contado,
}: {
  turno: Pick<Turno, "fondoInicial" | "ventasEnEfectivo" | "otrosIngresos" | "retiros" | "devoluciones" | "gastos" | "esperado">;
  contado?: number;
}) {
  const recuadros: [string, number][] = [
    ["Fondo inicial", turno.fondoInicial],
    ["Ventas en efectivo", turno.ventasEnEfectivo],
    ["Otros ingresos", turno.otrosIngresos],
    ["Retiros", turno.retiros],
  ];
  if (turno.devoluciones) recuadros.push(["Devoluciones", turno.devoluciones]);
  if (turno.gastos) recuadros.push(["Gastos", turno.gastos]);
  return (
    <>
      <dl className={`grid grid-cols-2 gap-3 ${recuadros.length > 4 ? "sm:grid-cols-3" : ""}`}>
        {recuadros.map(([titulo, valor]) => (
          <Dato key={titulo} titulo={titulo} valor={valor} />
        ))}
      </dl>

      <div className="tarjeta-hundida mt-3 flex items-baseline justify-between gap-3 rounded-xl p-4">
        <span className="text-lg font-semibold">Debería haber</span>
        <span className="tabular text-3xl font-bold">{formatearImporte(turno.esperado)}</span>
      </div>
      {contado !== undefined && (
        <p className="mt-2 flex items-baseline justify-between gap-3 px-4 text-lg">
          <span className="text-muted-foreground">Contado</span>
          <span className="tabular font-bold">{formatearImporte(contado)}</span>
        </p>
      )}
    </>
  );
}

/**
 * Lo que entró en el turno, separado por lo que es: lo cobrado de ventas, lo
 * que quedó a cuenta (no es plata que entró; H180), los cobros de cuenta
 * tomados en el mostrador (el cheque y la transferencia de un recibo no
 * figuraban en ningún turno; H176) y las devoluciones.
 */
function CierreZ({ cierre }: { cierre: RenglonDelCierre[] }) {
  const grupos: [string, RenglonDelCierre[]][] = [
    ["Cobrado en el turno", cierre.filter((r) => !r.devolucion && !r.cobranza && r.medioPago !== "cuenta_corriente")],
    // El cobro de un pedido en efectivo entraba como «otro ingreso» y no
    // figuraba acá (M2S2-130).
    ["Cobros de pedidos", cierre.filter((r) => r.cobranza && r.dePedido)],
    ["Cobros de cuenta", cierre.filter((r) => r.cobranza && !r.dePedido)],
    ["Vendido a cuenta", cierre.filter((r) => !r.devolucion && !r.cobranza && r.medioPago === "cuenta_corriente")],
    ["Devoluciones", cierre.filter((r) => r.devolucion)],
  ];
  return (
    <>
      {grupos
        .filter(([, filas]) => filas.length > 0)
        .map(([titulo, filas]) => (
          <section key={titulo} className="mt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
            <dl className="mt-2 divide-y divide-linea-tenue rounded-xl border border-linea">
              {filas.map((r) => (
                <div
                  key={`${r.medioPago}-${r.quien ?? ""}`}
                  className="flex items-baseline justify-between gap-3 px-4 py-2.5"
                >
                  {/* El medio real y el pedido de cada devolución, y el
                      recibo y quién cobró lo que tomó otra persona: decía
                      «Cuenta corriente · Sim Mostrador» de una transferencia
                      (M2S1-081, M3S1-060, M2S2-007). */}
                  <dt className="min-w-0 text-base">
                    {NOMBRE_DEL_MEDIO[r.medioPago] ?? r.medioPago}
                    {r.pedidos && <span className="codigo"> · {r.pedidos}</span>}
                    {r.quien && ` · ${r.quien}`}
                    <span className="ml-1.5 text-sm text-muted-foreground">({r.cantidad})</span>
                  </dt>
                  <dd className="tabular shrink-0 font-semibold">{formatearImporte(r.total)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
    </>
  );
}

/**
 * El turno recién cerrado: la cuenta, lo contado y el botón para imprimirlo.
 * El papel es una hoja aparte en el `body` (`.cierre-impreso` en globals.css):
 * al imprimir se ve solo ella, sin el mostrador de atrás.
 */
function ResumenDelCierre({ cerrado }: { cerrado: TurnoCerrado }) {
  const { turno, cierre, movimientos, contado, notas, mensaje, cerradoAt } = cerrado;
  const diferencia = contado - turno.esperado;
  /*
   * Los retiros por destino, con su motivo: el papel decía «Retiros −$
   * 620.000» en una línea, y es lo que el cajero firma y entrega con el
   * depósito (mes simulado, M2S3-098).
   */
  const retiros = movimientos.filter((m) => m.tipo === "retiro");
  const porDestino = (["banco", "caja_fuerte", "otro"] as const)
    .map((d) => ({
      destino: d,
      filas: retiros.filter((m) => (m.destino ?? "otro") === d),
    }))
    .filter((g) => g.filas.length > 0);
  return (
    <section className="tarjeta-hundida mb-5 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-base font-semibold">
          {mensaje || `Último cierre · ${hora.format(cerradoAt)}`}
        </p>
        <button
          type="button"
          autoFocus={Boolean(mensaje)}
          onClick={() => window.print()}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-linea bg-background px-4 text-base font-medium transition-colors hover:bg-hundida"
        >
          <Printer className="h-4 w-4" />
          Imprimir el cierre
        </button>
      </div>
      {typeof document !== "undefined" &&
        createPortal(
          <div className="cierre-impreso" aria-hidden="true">
            <p className="razon">Cierre de caja · {turno.sucursal}</p>
            <p>
              {turno.abiertaPor} · {fechaHora.format(turno.abiertaAt)} a {fechaHora.format(cerradoAt)}
            </p>
            <div className="separador" />
            {(
              [
                ["Fondo inicial", turno.fondoInicial],
                ["Ventas en efectivo", turno.ventasEnEfectivo],
                ["Otros ingresos", turno.otrosIngresos],
                ["Retiros", turno.retiros],
                ["Devoluciones", turno.devoluciones],
                ["Gastos", turno.gastos],
              ] as [string, number][]
            )
              .filter(([t, v]) => v !== 0 || t === "Fondo inicial")
              .map(([t, v]) =>
                t === "Retiros" && porDestino.length > 0 ? (
                  porDestino.map((g) => (
                    <div key={g.destino}>
                      <p className="linea-datos">
                        <span>{g.destino === "banco" ? "Al banco" : g.destino === "caja_fuerte" ? "A caja fuerte" : "Otros retiros"}</span>
                        <span>{formatearImporte(g.filas.reduce((s, m) => s + m.monto, 0))}</span>
                      </p>
                      {/* Cada retiro con su motivo, también los del banco y
                          la caja fuerte que lo escribieron (mes 23). */}
                      {g.filas
                        .filter((m) => g.destino === "otro" || (m.motivo && m.motivo !== DESTINO[g.destino].motivo))
                        .map((m) => (
                          <p key={m.id} className="linea-datos">
                            <span>· {m.motivo ?? "Retiro"}</span>
                            <span>{formatearImporte(m.monto)}</span>
                          </p>
                        ))}
                    </div>
                  ))
                ) : (
                  <p key={t} className="linea-datos">
                    <span>{t}</span>
                    <span>{formatearImporte(v)}</span>
                  </p>
                ),
              )}
            <p className="linea-datos total">
              <span>Debería haber</span>
              <span>{formatearImporte(turno.esperado)}</span>
            </p>
            <p className="linea-datos total">
              <span>Contado</span>
              <span>{formatearImporte(contado)}</span>
            </p>
            <p className="linea-datos">
              <span>{nombreDeLaDiferencia(diferencia) === "faltante" ? "Faltante" : nombreDeLaDiferencia(diferencia) === "sobrante" ? "Sobrante" : "Diferencia"}</span>
              <span>{formatearImporte(diferencia)}</span>
            </p>
            {notas && <p>{notas}</p>}
            {cierre.length > 0 && <div className="separador" />}
            {cierre.map((r) => (
              <p key={`${r.devolucion ? "d" : r.cobranza ? "c" : "v"}-${r.medioPago}-${r.quien ?? ""}`} className="linea-datos">
                <span>
                  {r.devolucion
                    ? "Devolución · "
                    : r.cobranza
                      ? r.dePedido
                        ? "Cobro de pedido · "
                        : "Cobro de cuenta · "
                      : r.medioPago === "cuenta_corriente"
                        ? "A cuenta · "
                        : ""}
                  {NOMBRE_DEL_MEDIO[r.medioPago] ?? r.medioPago}
                  {r.pedidos && ` · ${r.pedidos}`}
                  {r.quien && ` · ${r.quien}`} ({r.cantidad})
                </span>
                <span>{formatearImporte(r.total)}</span>
              </p>
            ))}
            <div className="separador" />
            <p className="firma">Firma</p>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function Dato({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <div className="rounded-xl border border-linea p-3.5">
      <dt className="text-sm text-muted-foreground">{titulo}</dt>
      <dd className={`tabular mt-0.5 text-xl font-semibold ${valor === 0 ? "text-muted-foreground" : ""}`}>
        {formatearImporte(valor)}
      </dd>
    </div>
  );
}
