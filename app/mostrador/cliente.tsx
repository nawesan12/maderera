"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { Loader2, UserPlus, UserRound, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  leerDocumento,
  precargaDelAlta,
  sugerirCondicionIva,
} from "@/lib/clientes/documento";
import { ordenarClientes } from "@/lib/mostrador/ranking-clientes";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";
import {
  buscarClientes,
  clientePorId,
  clientesRecientes,
  crearClienteEnMostrador,
} from "./actions";
import { enfocar } from "./atajos";
import { SaldoDelCliente } from "./cuenta-del-cliente";
import type { Cliente } from "./tipos";
import { documentoConTipo, moneda } from "@/lib/formato";
import { MONTO_IDENTIFICAR_CONSUMIDOR_FINAL } from "@/lib/fiscal/umbral";

export function BuscadorDeCliente({
  cliente,
  onCliente,
  branchId,
  enLinea,
  buscarLocal,
  aCuenta = 0,
  sinFicha = null,
  onSaldo,
}: {
  /** El saldo del cliente elegido, al leerlo. */
  onSaldo?: (de: string, monto: number) => void;
  /** Lo que la venta de ahora carga a cuenta corriente: se mide contra el límite. */
  aCuenta?: number;
  cliente: Cliente | null;
  onCliente: (c: Cliente | null) => void;
  branchId: string;
  enLinea: boolean;
  /** La copia local del padrón: contesta al instante y sin internet. */
  buscarLocal: (texto: string) => Cliente[];
  /** A nombre de quién sale la venta sin cliente (el del presupuesto). */
  sinFicha?: string | null;
}) {
  const [texto, setTexto] = useState("");
  const [delServidor, setDelServidor] = useState<Cliente[]>([]);
  const [recientes, setRecientes] = useState<Cliente[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  /** Cuál de la lista está marcado. Se mueve con las flechas, no con el mouse. */
  const [marcado, setMarcado] = useState(0);
  const [alta, setAlta] = useState<{ nombre: string; documento: string } | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  /*
   * Buscando otro cliente con uno ya elegido. Alt+C caía en el botón
   * «Cambiar» y lo tipeado enseguida se perdía —la barra espaciadora lo
   * apretaba y el campo nacía recién después—: «Techos Costa» llegaba como
   * «osta» y la venta salía a otro cliente (mes simulado, M2S1-021). Ahora el
   * campo aparece y toma el foco en el mismo pulso, con el elegido todavía
   * puesto: Esc lo deja como estaba.
   */
  const [cambiando, setCambiando] = useState(false);
  if (cambiando && !cliente) setCambiando(false);

  function empezarACambiar() {
    flushSync(() => setCambiando(true));
    campo.current?.focus();
  }

  const consulta = texto.trim();

  /*
   * Primero la copia local, después el servidor.
   *
   * La copia contesta en el mismo cuadro en que se tipea —y sin internet—; el
   * servidor completa lo que la copia no tenga todavía (un cliente dado de
   * alta hace un minuto en otra caja). Los dos se mezclan y se ordenan con la
   * misma regla: documento exacto, después lo que empieza igual, y entre
   * iguales el que se atendió hace menos.
   */
  const locales = useMemo(
    () => (consulta.length >= 2 ? buscarLocal(consulta) : []),
    [consulta, buscarLocal],
  );

  useEffect(() => {
    if (consulta.length < 2 || !enLinea) return;
    const t = setTimeout(async () => {
      setDelServidor((await buscarClientes(consulta)) as Cliente[]);
    }, 180);
    return () => clearTimeout(t);
  }, [consulta, enLinea]);

  const visibles = useMemo(() => {
    if (consulta.length < 2) return abierto ? (recientes ?? []) : [];
    const porId = new Map<string, Cliente>();
    for (const c of [...locales, ...delServidor]) if (!porId.has(c.id)) porId.set(c.id, c);
    return ordenarClientes([...porId.values()], consulta, (recientes ?? []).map((r) => r.id)).slice(0, 8);
  }, [consulta, abierto, recientes, locales, delServidor]);

  // La última opción es crear: lo que no aparece se da de alta sin salir.
  const ofreceAlta = consulta.length >= 2;
  const opciones = visibles.length + (ofreceAlta ? 1 : 0);
  const elegido = Math.min(marcado, Math.max(opciones - 1, 0));

  async function alEnfocar() {
    setAbierto(true);
    // Los recientes se piden una vez por cliente elegido, no en cada foco.
    if (recientes === null && enLinea) {
      setRecientes((await clientesRecientes(branchId)) as Cliente[]);
    }
  }

  function elegir(c: Cliente) {
    onCliente(c);
    setCambiando(false);
    setTexto("");
    setDelServidor([]);
    setMarcado(0);
    setAbierto(false);
    // De vuelta a la venta: identificar al cliente es un rodeo en el medio de
    // cargar productos.
    enfocar("buscador");
  }

  function abrirAlta() {
    setAlta(precargaDelAlta(consulta));
    setAbierto(false);
  }

  if (cliente && !cambiando) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-background px-3.5 py-2.5">
          <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-medium">{cliente.nombre}</span>
            {cliente.cuit && (
              <span
                className={`tabular block text-sm ${
                  "error" in leerDocumento(cliente.cuit)
                    ? "estado-problema font-medium text-[var(--estado-tinta)]"
                    : "text-muted-foreground"
                }`}
              >
                {documentoConTipo(cliente.cuit)}
                {"error" in leerDocumento(cliente.cuit) && " · no es válido"}
              </span>
            )}
          </span>
          {/* Alt + C cae acá y el campo aparece en el acto, con el foco: lo
              que se tipea enseguida llega entero. */}
          <button
            onFocus={empezarACambiar}
            onClick={empezarACambiar}
            data-foco="cliente"
            className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground"
          >
            Cambiar
          </button>
          <button
            onClick={() => onCliente(null)}
            aria-label="Volver a consumidor final"
            className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-hundida"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <SaldoDelCliente cliente={cliente} branchId={branchId} enLinea={enLinea} aCuenta={aCuenta} onSaldo={onSaldo} />
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-linea bg-background px-3.5">
        <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          ref={campo}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setMarcado(0);
          }}
          onFocus={alEnfocar}
          onBlur={() =>
            setTimeout(() => {
              setAbierto(false);
              // Sin tipear nada, sigue el que estaba.
              if (campo.current && campo.current.value === "") setCambiando(false);
            }, 150)
          }
          data-foco="cliente"
          role="combobox"
          aria-expanded={opciones > 0}
          aria-controls="clientes-del-buscador"
          aria-activedescendant={opciones > 0 ? `cliente-opcion-${elegido}` : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              if (opciones === 0) return;
              e.preventDefault();
              setMarcado((m) => {
                const i = Math.min(m, opciones - 1);
                return e.key === "ArrowDown" ? Math.min(i + 1, opciones - 1) : Math.max(i - 1, 0);
              });
              return;
            }
            if (e.key === "Enter") {
              const c = visibles[elegido];
              if (c) {
                e.preventDefault();
                elegir(c);
              } else if (ofreceAlta) {
                e.preventDefault();
                abrirAlta();
              }
              return;
            }
            // Sin nada tipeado, Escape devuelve el foco a la venta (y al
            // cliente que estaba, si se estaba cambiando).
            if (e.key === "Escape") {
              if (texto === "") {
                setCambiando(false);
                enfocar("buscador");
              }
              setTexto("");
            }
          }}
          placeholder={`${cliente?.nombre ?? (sinFicha || "Consumidor final")} — buscá por nombre, CUIT o DNI`}

          className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
      </div>

      {opciones > 0 && (
        <ul
          id="clientes-del-buscador"
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-linea bg-popover shadow-lg"
        >
          {consulta.length < 2 && visibles.length > 0 && (
            <li className="px-3.5 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Atendidos hace poco
            </li>
          )}
          {visibles.map((c, i) => (
            <li key={c.id} id={`cliente-opcion-${i}`} role="option" aria-selected={i === elegido}>
              <button
                // `onMouseDown` y no `onClick`: el clic llega después del blur
                // del campo, que ya cerró la lista.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(c);
                }}
                className={`flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-hundida ${
                  i === elegido ? "bg-hundida" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-medium">{c.nombre}</span>
                  <span className="block text-sm text-muted-foreground">
                    {c.cuit ? documentoConTipo(c.cuit) : "sin documento"}
                    {c.estado === "moroso" && " · moroso"}
                  </span>
                </span>
                {i === elegido && (
                  <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>
            </li>
          ))}
          {ofreceAlta && (
            <li id={`cliente-opcion-${visibles.length}`} role="option" aria-selected={elegido === visibles.length}>
              <button
                onMouseDown={(e) => {
                  e.preventDefault();
                  abrirAlta();
                }}
                className={`flex w-full items-center gap-2.5 border-t border-linea px-3.5 py-2.5 text-left text-base font-medium text-acento-texto transition-colors hover:bg-hundida ${
                  elegido === visibles.length ? "bg-hundida" : ""
                }`}
              >
                <UserPlus className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Crear cliente «{consulta}»</span>
                {elegido === visibles.length && (
                  <kbd className="shrink-0 rounded border border-linea px-1.5 py-0.5 text-xs text-muted-foreground">
                    Enter
                  </kbd>
                )}
              </button>
            </li>
          )}
        </ul>
      )}

      {alta && (
        <AltaRapidaDeCliente
          inicial={alta}
          enLinea={enLinea}
          onCerrar={() => {
            setAlta(null);
            campo.current?.focus();
          }}
          onCreado={(c) => {
            setAlta(null);
            elegir(c);
          }}
        />
      )}
    </div>
  );
}

/**
 * El CUIT tipeado sin elegir un cliente, para una factura a una empresa.
 *
 * Se valida mientras se tipea —un CUIT mal escrito termina en una factura que
 * ARCA rechaza, con el cliente ya yéndose— y, si es una empresa que va a
 * volver, se guarda como cliente con un Enter: queda elegida, con su
 * condición de IVA, y la próxima vez se la encuentra buscando.
 */
export function CuitSuelto({
  cuit,
  onCuit,
  enLinea,
  onCliente,
  obligatorio = false,
}: {
  cuit: string;
  onCuit: (v: string) => void;
  enLinea: boolean;
  onCliente: (c: Cliente | null) => void;
  /**
   * La venta llega al monto desde el que la B identifica al comprador
   * (lib/fiscal/umbral.ts): el campo pasa a pedirse, y un DNI también sirve.
   */
  obligatorio?: boolean;
}) {
  const [alta, setAlta] = useState(false);
  const leido = leerDocumento(cuit);
  const digitos = cuit.replace(/\D/g, "");
  const valido = !("error" in leido) && leido.tipo === "cuit";
  const problema = obligatorio
    ? digitos.length >= 7 && "error" in leido
      ? leido.error
      : null
    : digitos.length >= 11 && !valido
      ? "Ese CUIT no es válido: revisá los números."
      : null;

  return (
    <div className="mt-2.5">
      <label className="block">
        <span className={obligatorio ? "text-base font-medium" : "text-base text-muted-foreground"}>
          {obligatorio
            ? `Desde ${moneda.format(MONTO_IDENTIFICAR_CONSUMIDOR_FINAL)}, DNI o CUIT del comprador`
            : "CUIT, si lo quiere a nombre de una empresa"}
        </span>
        <input
          value={cuit}
          onChange={(e) => onCuit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && valido && enLinea) {
              e.preventDefault();
              setAlta(true);
            }
          }}
          inputMode="numeric"
          data-foco="cuit"
          aria-invalid={Boolean(problema)}
          aria-required={obligatorio}

          placeholder={obligatorio ? undefined : "Consumidor final"}
          className="tabular mt-1.5 h-12 w-full rounded-lg border border-linea bg-background px-3 text-base"
        />
      </label>
      {problema && <p className="estado-problema mt-1 text-sm font-medium">{problema}</p>}
      {valido && enLinea && (
        <button
          type="button"
          onClick={() => setAlta(true)}
          className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-medium text-acento-texto hover:underline"
        >
          <UserPlus className="h-4 w-4" />
          Guardarlo como cliente
          <kbd className="rounded border border-linea px-1 text-xs text-muted-foreground">Enter</kbd>
        </button>
      )}
      {alta && (
        <AltaRapidaDeCliente
          inicial={{ nombre: "", documento: cuit }}
          enLinea={enLinea}
          onCerrar={() => setAlta(false)}
          onCreado={(c) => {
            setAlta(false);
            onCuit("");
            onCliente(c);
          }}
        />
      )}
    </div>
  );
}

/**
 * Alta de un cliente sin salir de la venta.
 *
 * Cinco campos y no trece: lo que hace falta para venderle y facturarle hoy.
 * El resto de la ficha —correo, domicilio, límite— se completa en el panel
 * cuando haga falta. Enter pasa de un campo al siguiente y en el último crea.
 */
export function AltaRapidaDeCliente({
  inicial,
  enLinea,
  onCerrar,
  onCreado,
}: {
  inicial: { nombre: string; documento: string };
  enLinea: boolean;
  onCerrar: () => void;
  onCreado: (c: Cliente) => void;
}) {
  const [nombre, setNombre] = useState(inicial.nombre);
  const [documento, setDocumento] = useState(inicial.documento);
  const [condicion, setCondicion] = useState<string | null>(null);
  const [telefono, setTelefono] = useState("");
  const [rubro, setRubro] = useState("particular");
  const [error, setError] = useState<string | null>(null);
  const [existente, setExistente] = useState<{ id: string; nombre: string } | null>(null);
  const [pendiente, empezar] = useTransition();

  const leido = leerDocumento(documento);
  const errorDeDocumento = "error" in leido && documento.trim().length >= 7 ? leido.error : null;
  // La condición sale sugerida del documento hasta que alguien la elige.
  const condicionIva = condicion ?? ("error" in leido ? "consumidor_final" : sugerirCondicionIva(leido));

  function crear() {
    setError(null);
    setExistente(null);
    empezar(async () => {
      const r = await crearClienteEnMostrador({ nombre, documento, condicionIva, telefono, rubro });
      if (r.ok) {
        toast.success(`${r.cliente.nombre} quedó cargado.`);
        onCreado(r.cliente as Cliente);
      } else {
        setError(r.error);
        setExistente(r.existente ?? null);
      }
    });
  }

  async function usarExistente() {
    if (!existente) return;
    const c = await clientePorId(existente.id);
    if (c) onCreado(c as Cliente);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <UserPlus className="h-5 w-5" />
            Cliente nuevo
          </DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            crear();
          }}
          onKeyDown={(e) => {
            // Enter avanza al campo siguiente; en el último, crea.
            if (e.key !== "Enter" || e.target instanceof HTMLButtonElement) return;
            const campos = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>("input, select"),
            );
            const i = campos.indexOf(e.target as HTMLElement);
            if (i < 0) return;
            e.preventDefault();
            if (i < campos.length - 1) campos[i + 1]!.focus();
            else e.currentTarget.requestSubmit();
          }}
          className="space-y-3.5"
        >
          {!enLinea && (
            <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
              Sin conexión no se pueden dar de alta clientes. Cobrá como consumidor final y
              cargalo después.
            </p>
          )}
          <label className="block text-sm text-muted-foreground">
            Nombre o razón social
            <input
              autoFocus={!inicial.nombre}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
              className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
            />
          </label>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block text-sm text-muted-foreground">
              CUIT o DNI <span className="font-normal">(opcional)</span>
              <input
                autoFocus={Boolean(inicial.nombre)}
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                inputMode="numeric"
                aria-invalid={Boolean(errorDeDocumento)}
                className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
              />
              {errorDeDocumento && (
                <span className="estado-problema mt-1 block text-sm">{errorDeDocumento}</span>
              )}
            </label>
            <label className="block text-sm text-muted-foreground">
              Condición de IVA
              <select
                value={condicionIva}
                onChange={(e) => setCondicion(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-2.5 text-base text-foreground"
              >
                <option value="consumidor_final">Consumidor final</option>
                <option value="monotributista">Monotributista</option>
                <option value="responsable_inscripto">Responsable inscripto</option>
                <option value="exento">Exento</option>
              </select>
            </label>
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <label className="block text-sm text-muted-foreground">
              Teléfono <span className="font-normal">(opcional)</span>
              <input
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                inputMode="tel"
                className="tabular mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
              />
            </label>
            <label className="block text-sm text-muted-foreground">
              Rubro
              <select
                value={rubro}
                onChange={(e) => setRubro(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-2.5 text-base text-foreground"
              >
                {RUBROS_CLIENTE.map((r) => (
                  <option key={r.valor} value={r.valor}>
                    {r.etiqueta}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && (
            <div className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2.5 text-base">
              {error}
              {existente && (
                <button
                  type="button"
                  autoFocus
                  onClick={usarExistente}
                  className="ml-2 font-semibold underline underline-offset-2"
                >
                  Usar esa ficha
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCerrar}
              className="h-11 rounded-lg border border-linea px-4 text-base font-medium transition-colors hover:bg-hundida"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={pendiente || !enLinea || nombre.trim().length < 2 || Boolean(errorDeDocumento)}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-semibold disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear y elegir
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
