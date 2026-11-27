"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarClock, Loader2, MessageSquareText, Plus } from "lucide-react";
import { ColumnaTablero, Tablero } from "@/components/admin/kanban";
import {
  ElegirCliente,
  type ClienteElegido,
} from "@/components/admin/elegir-cliente";
import type { GestionListada } from "@/lib/dal/admin/seguimiento";
import { crearGestion, moverGestion } from "./actions";
import { fechaCorta, formatearMonto, plural } from "@/lib/formato";
import { CampoFecha } from "@/components/ui/campo-fecha";

/** Las cuatro etapas, con el color de estado que les corresponde. */
const ETAPAS = [
  {
    valor: "pendiente" as const,
    titulo: "Para hacer",
    estado: "pendiente",
  },
  {
    valor: "hablando" as const,
    titulo: "Hablando",
    estado: "en-proceso",
  },
  {
    valor: "promesa" as const,
    titulo: "Prometió",
    estado: "espera",
  },
  {
    valor: "cerrado" as const,
    titulo: "Cerrado",
    estado: "listo",
  },
];

export interface Deudor {
  id: string;
  nombre: string;
  saldo: number;
  vencido: number;
  dias: number | null;
  razonSocial: string | null;
  cuit: string | null;
  seguido: boolean;
}

export function TableroDeSeguimiento({
  gestiones,
  nueva,
  deudores = [],
}: {
  gestiones: GestionListada[];
  /** Llegando desde lo que se debe: el cliente y el asunto ya puestos. */
  nueva?: { cliente: ClienteElegido; asunto: string };
  /** Los que deben, del de más prioridad al de menos. */
  deudores?: Deudor[];
}) {
  const atraso = new Map(deudores.map((d) => [d.id, d]));
  // A quién llamar primero: los que deben y nadie sigue.
  const sinSeguir = deudores.filter((d) => !d.seguido);
  return (
    <>
      {/* Con la llave del cliente: «+ Seguir» navega a ?cliente= y, sin
          ella, el formulario guardaba su estado inicial y no se abría
          (M3S2-021). */}
      <NuevaGestion
        key={nueva ? `${nueva.cliente.id}-${nueva.asunto}` : "nueva"}
        cliente={nueva?.cliente}
        asunto={nueva?.asunto}
        abierto={Boolean(nueva)}
      />

      {sinSeguir.length > 0 && (
        <section>
          <h2 className="mb-2.5 text-base font-semibold">
            Deben y nadie los sigue <span className="tabular font-normal text-muted-foreground">{sinSeguir.length}</span>
          </h2>
          <ul className="tarjeta divide-y divide-linea-suave overflow-hidden">
            {sinSeguir.slice(0, 8).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
                <span className="min-w-0 flex-1 basis-48">
                  <Link href={`/admin/clientes/${d.id}`} className="block truncate text-base font-medium hover:text-brand-orange">
                    {d.nombre}
                  </Link>
                  <Deuda saldo={d.saldo} vencido={d.vencido} dias={d.dias} />
                </span>
                <Link
                  href={`/admin/clientes/seguimiento?cliente=${d.id}`}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-hundida px-3 text-base font-medium hover:bg-muted"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Seguir
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Tablero>
        {ETAPAS.map((etapa) => {
          const suyas = gestiones.filter((g) => g.etapa === etapa.valor);
          // Lo cerrado, plegado: las últimas tres en un renglón, sin botón
          // (mes simulado 2: crecía con cada gestión cerrada).
          if (etapa.valor === "cerrado") {
            return (
              <ColumnaTablero key={etapa.valor} titulo={etapa.titulo} cantidad={suyas.length} estado={etapa.estado}>
                {suyas.length > 0 && (
                  <ul className="tarjeta-hundida divide-y divide-linea-suave rounded-xl text-sm">
                    {suyas.slice(0, 3).map((g) => (
                      <li key={g.id} className="truncate px-3 py-2">
                        <Link href={`/admin/clientes/${g.customerId}`} className="hover:text-foreground">
                          <span className="font-medium">{g.cliente}</span>
                          <span className="text-muted-foreground"> · {g.asunto}</span>
                        </Link>
                      </li>
                    ))}
                    {suyas.length > 3 && (
                      <li className="px-3 py-2 text-muted-foreground">{plural(suyas.length - 3, "más", "más")}</li>
                    )}
                  </ul>
                )}
              </ColumnaTablero>
            );
          }

          return (
            <ColumnaTablero
              key={etapa.valor}
              titulo={etapa.titulo}
              cantidad={suyas.length}
              estado={etapa.estado}
              detalle={
                suyas.filter((g) => g.vencida).length > 0
                  ? plural(suyas.filter((g) => g.vencida).length, "vencida")
                  : undefined
              }
            >
              {suyas.map((gestion) => (
                <Tarjeta key={gestion.id} gestion={gestion} deuda={atraso.get(gestion.customerId) ?? null} />
              ))}
            </ColumnaTablero>
          );
        })}
      </Tablero>
    </>
  );
}

/** Lo que debe y cuánto hace: el saldo, lo vencido y los días. */
function Deuda({ saldo, vencido, dias }: { saldo: number; vencido: number; dias: number | null }) {
  if (!(saldo > 0.004)) return null;
  return (
    <span className="block text-sm">
      <span className="tabular font-semibold text-saldo-debe">{formatearMonto(saldo)}</span>
      {vencido > 0.004 && dias != null && dias > 0 && (
        <span className="text-muted-foreground"> · {plural(dias, "día", "días")} de atraso</span>
      )}
    </span>
  );
}

function Tarjeta({ gestion, deuda }: { gestion: GestionListada; deuda: Deudor | null }) {
  const [abierta, setAbierta] = useState(false);
  const [nota, setNota] = useState("");
  const [cuando, setCuando] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();
  // «Prometió» es para cuándo, y una vencida que se sigue moviendo necesita
  // la fecha nueva: sin ella seguía «Vencía el 26/11» (mes simulado 2).
  const faltaFecha = (etapa: GestionListada["etapa"]) =>
    etapa !== "cerrado" && !cuando && (etapa === "promesa" || gestion.vencida);

  function mover(etapa: GestionListada["etapa"]) {
    empezar(async () => {
      const r = await moverGestion(gestion.id, etapa, nota || undefined, cuando || undefined);
      if (r.error) {
        setError(r.error);
        return;
      }
      setNota("");
      setCuando("");
      setError(null);
      setAbierta(false);
    });
  }

  return (
    <article
      className={`tarjeta p-3.5 ${gestion.vencida ? "border-l-[3px] border-l-destructive" : ""}`}
    >
      <p className="text-base font-medium leading-snug">{gestion.asunto}</p>

      <Link
        href={`/admin/clientes/${gestion.customerId}`}
        className="text-sm text-muted-foreground hover:text-foreground hover:underline"
      >
        {gestion.cliente}
      </Link>
      <Deuda saldo={deuda?.saldo ?? gestion.saldo ?? 0} vencido={deuda?.vencido ?? 0} dias={deuda?.dias ?? null} />

      {gestion.proximaAccionAt && (
        <p
          className={`mt-1.5 flex items-center gap-1.5 text-sm ${
            gestion.vencida ? "font-medium text-destructive" : "text-muted-foreground"
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {gestion.vencida ? "Vencía el" : "Volver el"}{" "}
          {fechaCorta.format(gestion.proximaAccionAt)}
        </p>
      )}

      {gestion.notas && (
        <p className="mt-2 whitespace-pre-line border-t border-linea-suave pt-2 text-sm text-muted-foreground">
          {gestion.notas}
        </p>
      )}

      {abierta ? (
        <div className="mt-2.5 space-y-2 border-t border-linea-suave pt-2.5">
          <input
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Qué pasó"
            className="h-10 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Volver el
            <CampoFecha
              value={cuando}
              onChange={(e) => {
                setCuando(e.target.value);
                setError(null);
              }}
              aria-invalid={Boolean(error) || undefined}
              className="tabular h-10 flex-1 rounded-lg border border-linea bg-background px-2 text-base"
            />
          </label>
          {error && <p role="alert" className="estado-problema text-sm font-medium">{error}</p>}
          <div className="flex flex-wrap gap-1.5">
            {ETAPAS.filter((e) => e.valor !== gestion.etapa).map((e) => (
              <button
                key={e.valor}
                type="button"
                disabled={trabajando || faltaFecha(e.valor)}
                onClick={() => mover(e.valor)}
                className="h-9 rounded-lg border border-linea px-2.5 text-sm font-medium transition-colors hover:bg-hundida disabled:opacity-50"
              >
                {e.titulo}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAbierta(false)}
              className="h-9 px-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAbierta(true)}
          className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-lg bg-hundida px-3 text-sm font-medium transition-colors hover:bg-muted"
        >
          <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          Anotar y mover
        </button>
      )}

      {trabajando && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Guardando…
        </p>
      )}
    </article>
  );
}

/**
 * Abrir un seguimiento nuevo. Desde la ficha o desde «Por cobrar» llega con
 * el cliente y el asunto ya puestos (lo que debe), y abierto.
 */
export function NuevaGestion({
  cliente: clienteInicial,
  asunto,
  abierto: abiertoInicial = false,
  fijo = false,
}: {
  cliente?: ClienteElegido;
  asunto?: string;
  abierto?: boolean;
  /** En la ficha el cliente es ese: no se elige otro. */
  fijo?: boolean;
}) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [cliente, setCliente] = useState<ClienteElegido | null>(clienteInicial ?? null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sinAsunto, setSinAsunto] = useState(false);
  const [trabajando, empezar] = useTransition();
  const router = useRouter();
  const campoAsunto = useRef<HTMLInputElement>(null);
  const formulario = useRef<HTMLFormElement>(null);
  // Llegando desde «+ Seguir» de la lista, el formulario queda arriba: a
  // 375 px no se veía.
  useEffect(() => {
    if (abiertoInicial && clienteInicial && !fijo) formulario.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [abiertoInicial, clienteInicial, fijo]);

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg boton-accion px-3.5 text-base font-medium"
      >
        <Plus className="h-4 w-4" />
        Nuevo seguimiento
      </button>
    );
  }

  return (
    <form
      ref={formulario}
      // Sin el globo del navegador (en inglés): el campo vacío se marca acá.
      noValidate
      action={(formData) => {
        if (!String(formData.get("asunto") ?? "").trim()) {
          setSinAsunto(true);
          campoAsunto.current?.focus();
          return;
        }
        empezar(async () => {
          const r = await crearGestion({}, formData);
          setAviso(r.error ?? r.ok ?? null);
          if (!r.error) {
            setAbierto(false);
            if (!fijo) setCliente(null);
            // El tablero se vuelve a pedir ya: quedaba con el formulario y
            // «0 gestiones abiertas» hasta recargar (mes simulado).
            router.refresh();
          }
        });
      }}
      className="tarjeta scroll-mt-20 space-y-3 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fijo && cliente ? (
          <input type="hidden" name="customerId" value={cliente.id} />
        ) : (
          <ElegirCliente
            elegido={cliente}
            onElegir={setCliente}
            nombre="customerId"
            chico
          />
        )}

        <label className="block">
          <span className="text-sm font-medium">De qué se trata</span>
          <input
            ref={campoAsunto}
            name="asunto"
            required
            aria-invalid={sinAsunto || undefined}
            onChange={() => setSinAsunto(false)}
            autoFocus={Boolean(clienteInicial) && !asunto}
            defaultValue={asunto}
            placeholder="Cobrar la factura"
            className="mt-1 h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Volver el</span>
          <CampoFecha
            name="proximaAccion"
            className="tabular mt-1 h-10 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
          />
          <span className="mt-1 block text-sm text-muted-foreground">
            Sin fecha queda en el tablero, pero no avisa solo.
          </span>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Notas</span>
          <input
            name="notas"
            className="mt-1 h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={trabajando || !cliente}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg boton-accion px-3.5 text-base font-medium disabled:opacity-60"
        >
          {trabajando && <Loader2 className="h-4 w-4 animate-spin" />}
          Anotarlo
        </button>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          className="h-10 px-2 text-base text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
        {aviso && <span className="text-sm text-muted-foreground">{aviso}</span>}
      </div>
    </form>
  );
}
