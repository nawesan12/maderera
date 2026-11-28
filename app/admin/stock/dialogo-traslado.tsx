"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { unidadConcordada } from "@/lib/formato";
import { admiteDecimales, formatearCantidad, leerCantidad } from "@/lib/unidades";
import { buscarMedidas, crearTraslado, type MedidaEncontrada } from "./actions";

interface Renglon {
  medida: MedidaEncontrada;
  cantidad: string;
}

/**
 * El traslado entre sucursales: un viaje del camión con todas sus medidas.
 *
 * Era una transferencia de a una medida por vez, sin ver cuánto había en el
 * origen hasta que el error lo decía, y con un campo numérico que no dejaba
 * mover media placa (mes simulado, H009 y H112). Ahora se arma la lista como
 * se carga el camión —buscar, poner cuánto, siguiente—, cada renglón dice
 * lo que hay para mover en el origen, y al mandarlo se abre el comprobante
 * para que lo firme quien recibe.
 */
export function DialogoTraslado({ sucursales }: { sucursales: { id: string; name: string }[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [pendiente, startTransition] = useTransition();
  const [origen, setOrigen] = useState(sucursales[0]?.id ?? "");
  const [destino, setDestino] = useState(sucursales[1]?.id ?? "");
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const [nota, setNota] = useState("");
  const [error, setError] = useState("");
  const cantidades = useRef(new Map<string, HTMLInputElement>());
  const buscador = useRef<HTMLInputElement>(null);

  const nombres = Object.fromEntries(sucursales.map((s) => [s.id, s.name]));
  const origenNombre = nombres[origen] ?? "";

  function agregar(m: MedidaEncontrada) {
    setError("");
    // La misma medida dos veces es un renglón: se va a su cantidad.
    if (!renglones.some((r) => r.medida.id === m.id)) {
      setRenglones((rs) => [...rs, { medida: m, cantidad: "" }]);
    }
    requestAnimationFrame(() => cantidades.current.get(m.id)?.focus());
  }

  function cambiar(id: string, cantidad: string) {
    setError("");
    setRenglones((rs) => rs.map((r) => (r.medida.id === id ? { ...r, cantidad } : r)));
  }

  function sacar(id: string) {
    setRenglones((rs) => rs.filter((r) => r.medida.id !== id));
    buscador.current?.focus();
  }

  // Elegir de dónde sale el mismo lugar al que va corre el destino a otra
  // sucursal: quedaba «Desde Aserradero · Hacia Aserradero» (M4-085).
  function elegirOrigen(v: string) {
    setOrigen(v);
    if (v === destino) setDestino(v === origen ? (sucursales.find((s) => s.id !== v)?.id ?? "") : origen);
  }

  function elegirDestino(v: string) {
    setDestino(v);
    if (v === origen) setOrigen(v === destino ? (sucursales.find((s) => s.id !== v)?.id ?? "") : destino);
  }

  function invertir() {
    setOrigen(destino);
    setDestino(origen);
  }

  const revisados = renglones.map((r) => {
    const n = leerCantidad(r.cantidad);
    const hay = r.medida.disponible[origen] ?? 0;
    const mal =
      r.cantidad.trim() !== "" &&
      (!Number.isFinite(n) || n <= 0 || (!admiteDecimales(r.medida.unidad) && !Number.isInteger(n)));
    return { ...r, n, hay, mal, sinStock: Number.isFinite(n) && n > hay };
  });
  const listo =
    origen !== "" &&
    destino !== "" &&
    origen !== destino &&
    revisados.length > 0 &&
    revisados.every((r) => r.cantidad.trim() !== "" && !r.mal && !r.sinStock);

  function mandar() {
    if (!listo || pendiente) return;
    startTransition(async () => {
      const r = await crearTraslado({
        origenId: origen,
        destinoId: destino,
        nota,
        renglones: revisados.map((x) => ({ variantId: x.medida.id, cantidad: x.cantidad.trim() })),
      });
      if (r.error || !r.id) {
        setError(r.error ?? "No se pudo registrar el traslado.");
        return;
      }
      toast.success(`${r.codigo} en camino a ${nombres[destino]}`);
      setAbierto(false);
      setRenglones([]);
      setNota("");
      router.push(`/admin/stock/traslados/${r.id}`);
    });
  }

  return (
    <Dialog open={abierto} onOpenChange={setAbierto}>
      <DialogTrigger className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark">
        <Truck className="h-4 w-4" aria-hidden="true" />
        Trasladar
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto max-sm:top-4 max-sm:translate-y-0 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Traslado entre sucursales</DialogTitle>
        </DialogHeader>

        {/* Etiquetas y controles en filas propias de la grilla: el ⇆ queda
            en la fila de los selectores y no depende de lo que el Select
            agrega debajo del botón (caía 8 px más abajo, M2S1-166). A 375 px,
            Desde y Hacia uno arriba del otro con el ⇆ al costado, entre los
            dos: en tres columnas «Casa Central» se cortaba. Solo inicio y fin
            de fila: «sm:row-span-1» es el atajo grid-row y borraba el
            row-start-2, y el ⇆ subía a la fila de las etiquetas. */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Label htmlFor="traslado-origen" className="col-start-1 row-start-1">
            Desde
          </Label>
          <div className="min-w-0 col-start-1 row-start-2">
            <Select value={origen} onValueChange={(v) => v && elegirOrigen(v)} items={nombres}>
              <SelectTrigger id="traslado-origen" className="h-11 w-full text-base data-[size=default]:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sucursales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <button
            type="button"
            onClick={invertir}
            aria-label="Invertir origen y destino"
            className="col-start-2 row-start-2 row-end-5 flex h-11 w-11 items-center justify-center self-center rounded-lg border text-muted-foreground hover:bg-muted hover:text-foreground sm:row-end-3"
          >
            <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <Label htmlFor="traslado-destino" className="col-start-1 row-start-3 mt-1 sm:col-start-3 sm:row-start-1 sm:mt-0">
            Hacia
          </Label>
          <div className="min-w-0 col-start-1 row-start-4 sm:col-start-3 sm:row-start-2">
            <Select value={destino} onValueChange={(v) => v && elegirDestino(v)} items={nombres}>
              <SelectTrigger id="traslado-destino" className="h-11 w-full text-base data-[size=default]:h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sucursales.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {revisados.length > 0 && (
          <ul className="tarjeta-hundida divide-y divide-border/60 overflow-hidden">
            {revisados.map((r) => {
              const nombre = `${r.medida.producto} ${r.medida.medida}`;
              const hay = Math.max(r.hay, 0);
              return (
                // El nombre y la medida a todo el ancho; la cantidad, con su
                // unidad, y la ✕ en el renglón de abajo: al lado del campo la
                // columna quedaba de una palabra por línea (M2S4-048).
                <li key={r.medida.id} className="px-3 py-2.5">
                  <p className="text-base font-medium leading-snug break-words">{r.medida.producto}</p>
                  <p className="text-sm text-muted-foreground">
                    {r.medida.medida} · <span className="tabular">{r.medida.sku}</span>
                  </p>
                  {/* Lo que hay en el origen, en su propia línea a 375 px:
                      al lado del campo se partía en tres (M2S4-048). */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {/* Lo que frena «Mandar» se dice en el renglón: el botón
                        se apagaba sin decir por qué (mes simulado). */}
                    <p
                      id={`traslado-hay-${r.medida.id}`}
                      className={`tabular min-w-0 basis-full text-sm sm:basis-0 sm:flex-1 ${r.sinStock || r.mal || r.hay <= 0 ? "font-medium text-saldo-debe" : "text-muted-foreground"}`}
                    >
                      {r.mal ? (
                        Number.isFinite(r.n) && r.n > 0 ? (
                          "Va sin decimales"
                        ) : (
                          "Cantidad mal escrita"
                        )
                      ) : (
                        <>
                          {r.sinStock ? "Solo hay " : `${origenNombre}: `}
                          <span className="whitespace-nowrap">
                            {formatearCantidad(hay)} {unidadConcordada(hay, r.medida.unidad, nombre)}
                          </span>
                          {r.sinStock ? ` en ${origenNombre}` : ""}
                        </>
                      )}
                    </p>
                    <label
                      htmlFor={`traslado-cant-${r.medida.id}`}
                      className="ml-auto flex h-11 w-40 shrink-0 items-center gap-1.5 rounded-md bg-hundida pr-3 focus-within:ring-2 focus-within:ring-ring sm:ml-0"
                    >
                      <span className="sr-only">Cantidad de {nombre}</span>
                      <input
                        id={`traslado-cant-${r.medida.id}`}
                        ref={(el) => {
                          if (el) cantidades.current.set(r.medida.id, el);
                          else cantidades.current.delete(r.medida.id);
                        }}
                        inputMode="decimal"
                        autoComplete="off"
                        value={r.cantidad}
                        onChange={(e) => cambiar(r.medida.id, e.target.value)}
                        onKeyDown={(e) => {
                          // Enter pasa a la próxima medida, como al cargar el camión.
                          if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                            e.preventDefault();
                            buscador.current?.focus();
                          } else if (e.key === "Enter") {
                            e.preventDefault();
                            mandar();
                          }
                        }}
                        aria-invalid={r.mal || r.sinStock || undefined}
                        aria-describedby={`traslado-hay-${r.medida.id}`}
                        placeholder={admiteDecimales(r.medida.unidad) ? "2,5" : "4"}
                        className="tabular h-11 w-16 min-w-0 flex-1 bg-transparent text-right text-lg text-foreground outline-none"
                      />
                      {/* Todos los campos del mismo ancho, con la unidad que
                          sea: «placas» y «u.» los dejaban desparejos. */}
                      <span className="shrink-0 text-sm text-muted-foreground">
                        {unidadConcordada(Number.isFinite(r.n) ? r.n : 2, r.medida.unidad, nombre)}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => sacar(r.medida.id)}
                      aria-label={`Sacar ${nombre}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <BuscadorDeMedida
          ref={buscador}
          etiqueta={revisados.length > 0 ? "Otra medida" : "Medida"}
          alElegir={agregar}
          origen={origen}
        />

        <div className="space-y-2">
          <Label htmlFor="traslado-nota">Nota</Label>
          <Input
            id="traslado-nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={300}
            autoComplete="off"
            placeholder="Quién lo lleva, patente…"
          />
        </div>

        {error && (
          <p role="alert" className="text-base text-saldo-debe">
            {error}
          </p>
        )}

        <Button type="button" onClick={mandar} disabled={!listo || pendiente} className="boton-accion h-11 w-full text-base">
          {pendiente ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : revisados.length > 1 ? (
            `Mandar ${revisados.length} medidas`
          ) : (
            "Mandar"
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Buscar una medida por nombre, medida o código. La búsqueda la hace Go
 * («2x4» encuentra el tirante de 2" x 4"); al elegir, el campo se vacía para
 * la siguiente. Cada resultado dice lo que hay en el origen.
 */
export function BuscadorDeMedida({
  ref,
  etiqueta,
  alElegir,
  origen,
  id = "traslado-buscar",
  autoFocus = true,
}: {
  ref?: React.Ref<HTMLInputElement>;
  etiqueta: string;
  alElegir: (m: MedidaEncontrada) => void;
  origen: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [encontradas, setEncontradas] = useState<MedidaEncontrada[]>([]);
  const [buscado, setBuscado] = useState("");
  const [resaltada, setResaltada] = useState(0);

  // Una consulta por pausa, no por tecla; la respuesta vieja no pisa a la nueva.
  useEffect(() => {
    const t = texto.trim();
    if (t.length < 2) return;
    let vigente = true;
    const reloj = setTimeout(() => {
      buscarMedidas(t).then((r) => {
        if (!vigente) return;
        setEncontradas(r.slice(0, 8));
        setBuscado(t);
        setResaltada(0);
      });
    }, 300);
    return () => {
      vigente = false;
      clearTimeout(reloj);
    };
  }, [texto]);

  const largo = texto.trim().length >= 2;
  const visibles = largo ? encontradas : [];

  function elegir(m: MedidaEncontrada) {
    alElegir(m);
    setTexto("");
    setEncontradas([]);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{etiqueta}</Label>
      <Input
        id={id}
        ref={ref}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (visibles.length === 0) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setResaltada((i) => Math.min(i + 1, visibles.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setResaltada((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            elegir(visibles[resaltada]);
          }
        }}
        placeholder="Nombre, medida o código"
        autoComplete="off"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={visibles.length > 0}
        aria-controls={`${id}-resultados`}
      />
      {visibles.length > 0 && (
        <ul id={`${id}-resultados`} role="listbox" className="max-h-64 overflow-y-auto rounded-lg bg-card shadow-sm">
          {visibles.map((v, i) => (
            <li key={v.id} role="option" aria-selected={i === resaltada}>
              <button
                type="button"
                onClick={() => elegir(v)}
                className={`flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-base hover:bg-muted ${
                  i === resaltada ? "bg-muted" : ""
                }`}
              >
                <span className="min-w-0">
                  {v.producto} — {v.medida} · <span className="tabular text-muted-foreground">{v.sku}</span>
                </span>
                <span className="tabular shrink-0 text-sm text-muted-foreground">
                  {formatearCantidad(Math.max(v.disponible[origen] ?? 0, 0))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {largo && buscado === texto.trim() && visibles.length === 0 && (
        <p className="text-sm text-muted-foreground">Nada con ese nombre.</p>
      )}
    </div>
  );
}
