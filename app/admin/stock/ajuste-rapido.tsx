"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Minus, Plus, Ruler } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  admiteDecimales,
  formatearCantidad,
  formatearLargo,
  formatearUnidadPlural,
  leerCantidad,
  metrosDePiezas,
} from "@/lib/unidades";
import { formatearUnidad } from "@/lib/formato";
import {
  avisoDelAjuste,
  MOTIVOS_QUE_RESTAN,
  MOTIVOS_QUE_SUMAN,
  motivosDelConteo,
  teclaDelAjuste,
  type ModoDelAjuste,
} from "@/lib/stock-ajuste";
import { ajustarStock, type MotivoDeAjuste } from "./ajuste-actions";

type Extra = { contado?: number; motivo?: MotivoDeAjuste; pedido?: string };

/**
 * Suma o resta stock sin salir del listado.
 *
 * Llegó mercadería o se rompió una placa: son correcciones de todos los días.
 * Obligar a abrir la ficha del producto para cambiar un número es lo que hace
 * que el inventario del sistema se despegue del real.
 *
 * Todo se carga también con un número, no solo lo que se mide: con un botón
 * de a uno no se cargan 28,8 metros de zócalo, y tampoco 200 bisagras. El
 * metro lineal se carga **por piezas**, que es como se cuenta al descargar el
 * camión. Y está «Contar», que deja el número que se contó en el galpón, con
 * el motivo de cada ajuste en el libro de movimientos.
 */
export function AjusteRapido({
  variantId,
  producto,
  medida,
  branchSlug,
  sucursal,
  unidad,
  largoMm,
  galpon,
}: {
  variantId: string;
  /** El nombre y la medida van en el título del cuadro y en el aviso: con dos placas parecidas, se ajustaba la que no era. */
  producto: string;
  medida: string;
  branchSlug: string;
  sucursal: string;
  unidad: string;
  largoMm: number | null;
  /** Lo que tiene que haber en el estante: el físico menos lo que salió en el camión. */
  galpon: number;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const nombre = `${producto} ${medida}`;

  function ajustar(cantidad: number, alTerminar?: () => void, extra?: Extra) {
    startTransition(async () => {
      const resultado = await ajustarStock(variantId, branchSlug, cantidad, extra);
      if (resultado.error) toast.error(resultado.error);
      else {
        if (resultado.ok) avisarConDeshacer(resultado.ok, cantidad, extra);
        alTerminar?.();
        router.refresh();
      }
    });
  }

  /*
   * Cada ajuste se puede deshacer desde el aviso (T4, hallazgo 21).
   *
   * Deshacer **no borra** el movimiento: asienta el inverso con motivo
   * «Corrección», y el libro dice las dos cosas, que es lo que pasó. Diez
   * segundos: el que ajusta suele estar atendiendo a alguien. Sirve una sola
   * vez. Un conteo no se deshace: se cuenta de nuevo. Una reposición a un
   * cliente tampoco: quedó en el historial del pedido.
   */
  function avisarConDeshacer(mensaje: string, cantidad: number, extra?: Extra) {
    const titulo = avisoDelAjuste(nombre, mensaje);
    if (extra?.contado !== undefined || extra?.pedido || cantidad === 0) {
      toast.success(titulo);
      return;
    }
    let usado = false;
    toast.success(titulo, {
      duration: 10_000,
      classNames: { title: "text-base", actionButton: "!h-10 !px-4 !text-base !font-semibold" },
      action: {
        label: "Deshacer",
        onClick: () => {
          if (usado) return;
          usado = true;
          startTransition(async () => {
            const r = await ajustarStock(variantId, branchSlug, -cantidad, { motivo: "correccion" });
            if (r.error) toast.error(r.error, { duration: 10_000 });
            else {
              if (r.ok) toast.success(avisoDelAjuste(nombre, r.ok));
              router.refresh();
            }
          });
        },
      },
    });
  }

  // La placa se ajusta de a media: es lo que queda cuando se vende una.
  const paso = unidad === "placa" ? 0.5 : 1;
  const nombrePaso = paso === 1 ? "uno" : "media";

  // De 44 px y separados: de 36 y pegados, el + caía en el − con el dedo.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <RestaRapida
        paso={paso}
        nombrePaso={nombrePaso}
        nombre={nombre}
        sucursal={sucursal}
        pendiente={pendiente}
        onRestar={(motivo, cerrar) => ajustar(-paso, cerrar, { motivo })}
      />
      <button
        onClick={() => ajustar(paso)}
        disabled={pendiente}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Sumar ${nombrePaso} de ${nombre} en ${sucursal}`}
      >
        {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        {paso !== 1 && <span className="text-sm">media</span>}
      </button>

      <CargaPorMedida
        nombre={nombre}
        unidad={unidad}
        largoMm={unidad === "metro_lineal" ? largoMm : null}
        sucursal={sucursal}
        galpon={galpon}
        pendiente={pendiente}
        onCargar={ajustar}
      />
    </div>
  );
}

/**
 * Carga de una cantidad medida: sumar, restar o contar.
 *
 * Es un cuadro con el nombre del producto en el título, y no un globo pegado
 * a la tarjeta: en el teléfono el globo tapaba justo el nombre y la medida, y
 * con dos placas parecidas no había cómo confirmar cuál se tocaba (se
 * restaron dos fenólicos en vez de dos lacas, H295 y H322). En el teléfono va
 * arriba, así el teclado no tapa el botón (H398).
 *
 * Cada modo tiene su fila de motivos y cada motivo ejecuta. Solo «Ingreso»
 * (sumando) y «Conteo» (contando) van con Enter: restando, el motivo se toca,
 * porque el resaltado y el Enter eran «Ingreso» aunque uno hubiera entrado a
 * descontar una rotura (H106).
 */
function CargaPorMedida({
  nombre,
  unidad,
  largoMm,
  sucursal,
  galpon,
  pendiente,
  onCargar,
}: {
  nombre: string;
  unidad: string;
  largoMm: number | null;
  sucursal: string;
  galpon: number;
  pendiente: boolean;
  onCargar: (cantidad: number, alTerminar?: () => void, extra?: Extra) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [porPiezas, setPorPiezas] = useState(Boolean(largoMm));
  const [texto, setTexto] = useState("");
  const [modo, setModo] = useState<ModoDelAjuste>("sumar");
  // «A cliente» pide el número del pedido antes de restar.
  const [pedido, setPedido] = useState<string | null>(null);
  const campoPedido = useRef<HTMLInputElement>(null);
  const enteros = !admiteDecimales(unidad);

  const valor = leerCantidad(texto);
  const cantidad =
    !Number.isFinite(valor) || valor <= 0 ? 0 : porPiezas && largoMm ? metrosDePiezas(valor, largoMm) : valor;

  const abreviatura = formatearUnidad(unidad);
  const largoTexto = largoMm ? formatearLargo(largoMm) : null;

  const decimalMal = enteros && cantidad > 0 && !Number.isInteger(cantidad);
  const listo = () => {
    setTexto("");
    setPedido(null);
    setAbierto(false);
  };

  const sePuedeMover = !pendiente && cantidad > 0 && !decimalMal;
  const sePuedeContar = !pendiente && texto.trim() !== "" && Number.isFinite(valor) && valor >= 0 && !decimalMal;
  const diferencia = modo === "contar" && sePuedeContar ? cantidad - galpon : 0;

  function cargar(signo: 1 | -1, motivo: MotivoDeAjuste) {
    if (!sePuedeMover) return;
    if (motivo === "reposicion") {
      if (pedido === null || pedido.trim() === "") {
        setPedido(pedido ?? "");
        requestAnimationFrame(() => campoPedido.current?.focus());
        return;
      }
      onCargar(signo * cantidad, listo, { motivo, pedido: pedido.trim() });
      return;
    }
    onCargar(signo * cantidad, listo, { motivo });
  }

  function contar(motivo: MotivoDeAjuste = "conteo") {
    if (!sePuedeContar) return;
    onCargar(0, listo, { contado: cantidad, motivo });
  }

  function cambiarModo(m: ModoDelAjuste) {
    setModo(m);
    setPedido(null);
  }

  const etiquetaDelCampo =
    modo === "contar"
      ? porPiezas && largoMm
        ? "Piezas que hay"
        : `Lo que hay, en ${formatearUnidadPlural(unidad)}`
      : porPiezas && largoMm
        ? "Piezas"
        : `Cantidad, en ${formatearUnidadPlural(unidad)}`;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="flex h-11 items-center gap-1.5 rounded-md border px-3 text-base text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Cargar una cantidad de ${nombre} en ${sucursal}`}
      >
        <Ruler className="h-4 w-4" aria-hidden="true" />
        Cargar
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto max-sm:top-4 max-sm:translate-y-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="pr-8 break-words">{nombre}</DialogTitle>
            <p className="text-base text-muted-foreground">
              {sucursal} · hay <span className="tabular font-medium text-foreground">{formatearCantidad(galpon)}</span>
            </p>
          </DialogHeader>

          <div className="flex rounded-md bg-hundida p-0.5 text-base" role="group" aria-label="Qué hacer">
            {(
              [
                ["sumar", "Sumar"],
                ["restar", "Restar"],
                ["contar", "Contar"],
              ] as const
            ).map(([m, t]) => (
              <button
                key={m}
                type="button"
                onClick={() => cambiarModo(m)}
                aria-pressed={modo === m}
                className={`h-10 flex-1 rounded px-2 ${modo === m ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                {t}
              </button>
            ))}
          </div>

          {largoMm ? (
            <div className="flex rounded-md bg-hundida p-0.5 text-sm" role="group" aria-label="Cómo se cuenta">
              <button
                type="button"
                onClick={() => setPorPiezas(true)}
                aria-pressed={porPiezas}
                className={`h-9 flex-1 rounded px-2 ${porPiezas ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                Piezas de {largoTexto}
              </button>
              <button
                type="button"
                onClick={() => setPorPiezas(false)}
                aria-pressed={!porPiezas}
                className={`h-9 flex-1 rounded px-2 ${!porPiezas ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
              >
                Metros sueltos
              </button>
            </div>
          ) : null}

          <label className="block text-sm text-muted-foreground">
            {etiquetaDelCampo}
            <input
              autoFocus
              inputMode="decimal"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                // La regla, con su prueba, en `teclaDelAjuste`.
                const accion = teclaDelAjuste(e, modo);
                if (accion === null) return;
                e.preventDefault();
                if (accion === "contar") contar();
                else if (accion === "ingreso") cargar(1, "ingreso");
              }}
              className="tabular mt-1 block h-12 w-full rounded-md bg-hundida px-3 text-xl text-foreground"
              placeholder={porPiezas && largoMm ? "12" : enteros ? "200" : "3,5"}
            />
          </label>

          <p className="tabular min-h-6 text-base" aria-live="polite">
            {decimalMal ? (
              <span className="text-destructive">Va sin decimales: se cuenta por {formatearUnidadPlural(unidad)}.</span>
            ) : cantidad > 0 || (modo === "contar" && sePuedeContar) ? (
              <>
                {modo === "contar" ? "Queda en " : modo === "restar" ? "− " : "+ "}
                <strong>
                  {formatearCantidad(cantidad)} {abreviatura}
                </strong>
                {porPiezas && largoMm ? (
                  <span className="text-muted-foreground">
                    {" "}
                    ({formatearCantidad(valor)} × {largoTexto})
                  </span>
                ) : null}
                {modo === "contar" && diferencia !== 0 && (
                  <span className={diferencia < 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
                    {" "}
                    · {diferencia > 0 ? "sobran" : "faltan"} {formatearCantidad(Math.abs(diferencia))}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">
                {Number.isFinite(valor) || texto === "" ? " " : "Eso no es un número."}
              </span>
            )}
          </p>

          {modo === "sumar" && (
            <FilaDeMotivos motivos={MOTIVOS_QUE_SUMAN} principal="ingreso" habilitado={sePuedeMover} pendiente={pendiente}
              onElegir={(m) => cargar(1, m)} />
          )}

          {modo === "restar" && (
            <>
              <FilaDeMotivos motivos={MOTIVOS_QUE_RESTAN} habilitado={sePuedeMover} pendiente={pendiente}
                elegido={pedido !== null ? "reposicion" : undefined} onElegir={(m) => cargar(-1, m)} />
              {pedido !== null && (
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    cargar(-1, "reposicion");
                  }}
                >
                  <label className="block flex-1 text-sm text-muted-foreground">
                    Pedido del cliente
                    <input
                      ref={campoPedido}
                      value={pedido}
                      onChange={(e) => setPedido(e.target.value)}
                      autoComplete="off"
                      placeholder="PED-1098"
                      className="tabular mt-1 block h-11 w-full rounded-md bg-hundida px-3 text-lg uppercase text-foreground"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={!sePuedeMover || pedido.trim() === ""}
                    className="h-11 shrink-0 rounded-md bg-accion px-4 text-base font-medium text-white hover:bg-brand-orange-dark disabled:opacity-40"
                  >
                    {pendiente ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reponer"}
                  </button>
                </form>
              )}
            </>
          )}

          {modo === "contar" && (
            <FilaDeMotivos motivos={motivosDelConteo(diferencia)} principal="conteo" habilitado={sePuedeContar} pendiente={pendiente}
              onElegir={(m) => contar(m)} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * El − de la fila, con su motivo.
 *
 * Restaba en el acto y el libro decía «Ajuste»: la placa rota no quedaba como
 * rotura (comité final). Ahora el − pregunta por qué, con los mismos motivos
 * de la carga por número salvo «A cliente», que va con su pedido desde
 * «Cargar». El título dice qué producto es (H295).
 */
function RestaRapida({
  paso,
  nombrePaso,
  nombre,
  sucursal,
  pendiente,
  onRestar,
}: {
  paso: number;
  nombrePaso: string;
  nombre: string;
  sucursal: string;
  pendiente: boolean;
  onRestar: (motivo: MotivoDeAjuste, cerrar: () => void) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        disabled={pendiente}
        className="flex h-11 min-w-11 items-center justify-center gap-1 rounded-md border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
        aria-label={`Restar ${nombrePaso} de ${nombre} en ${sucursal}`}
      >
        <Minus className="h-4 w-4" />
        {paso !== 1 && <span className="text-sm">media</span>}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-3">
        <p className="text-base font-semibold leading-snug break-words">{nombre}</p>
        <p className="mb-2 text-sm text-muted-foreground">
          {sucursal} · − {nombrePaso}
        </p>
        <FilaDeMotivos
          motivos={MOTIVOS_QUE_RESTAN.filter((m) => m.valor !== "reposicion")}
          habilitado={!pendiente}
          pendiente={pendiente}
          onElegir={(motivo) => onRestar(motivo, () => setAbierto(false))}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Los motivos de un modo: un chip por motivo, que ejecuta. `principal` es el
 * que va resaltado y con Enter; restando no hay ninguno.
 */
function FilaDeMotivos({
  motivos,
  principal,
  elegido,
  habilitado,
  pendiente,
  onElegir,
}: {
  motivos: { valor: MotivoDeAjuste; texto: string }[];
  principal?: MotivoDeAjuste;
  /** El que está esperando un dato (el pedido de «A cliente»). */
  elegido?: MotivoDeAjuste;
  habilitado: boolean;
  pendiente: boolean;
  onElegir: (motivo: MotivoDeAjuste) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Motivo">
      {motivos.map((m) => {
        const esPrincipal = m.valor === principal;
        return (
          <button
            key={m.valor}
            type="button"
            onClick={() => onElegir(m.valor)}
            disabled={!habilitado}
            aria-pressed={elegido === m.valor || undefined}
            className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-md px-1.5 text-base leading-tight font-medium max-sm:text-[15px] transition-colors disabled:opacity-40 ${
              esPrincipal ? "col-span-3 bg-accion text-white hover:bg-brand-orange-dark sm:col-span-1" : "border hover:bg-muted"
            }`}
          >
            {pendiente && esPrincipal ? <Loader2 className="h-4 w-4 animate-spin" /> : m.texto}
            {esPrincipal && !pendiente && (
              <kbd className="hidden rounded border border-current px-1 text-[11px] font-medium opacity-70 sm:inline">Enter</kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
