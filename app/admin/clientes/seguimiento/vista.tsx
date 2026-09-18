"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, Loader2, Plus } from "lucide-react";
import { ColumnaTablero, Tablero } from "@/components/admin/kanban";
import type { GestionListada } from "@/lib/dal/admin/seguimiento";
import { crearGestion, moverGestion } from "./actions";

/** Las cuatro etapas, con el color de estado que les corresponde. */
const ETAPAS = [
  {
    valor: "pendiente" as const,
    titulo: "Para hacer",
    estado: "pendiente",
    vacio: "Nada pendiente.",
  },
  {
    valor: "hablando" as const,
    titulo: "Hablando",
    estado: "en-proceso",
    vacio: "Ninguna conversación abierta.",
  },
  {
    valor: "promesa" as const,
    titulo: "Prometió",
    estado: "espera",
    vacio: "Ninguna promesa anotada.",
  },
  {
    valor: "cerrado" as const,
    titulo: "Cerrado",
    estado: "listo",
    vacio: "Nada cerrado todavía.",
  },
];

export function TableroDeSeguimiento({
  gestiones,
  clientes,
}: {
  gestiones: GestionListada[];
  clientes: { id: string; nombre: string }[];
}) {
  return (
    <>
      <NuevaGestion clientes={clientes} />

      <Tablero>
        {ETAPAS.map((etapa) => {
          const suyas = gestiones.filter((g) => g.etapa === etapa.valor);

          return (
            <ColumnaTablero
              key={etapa.valor}
              titulo={etapa.titulo}
              cantidad={suyas.length}
              estado={etapa.estado}
              vacio={etapa.vacio}
              detalle={
                suyas.filter((g) => g.vencida).length > 0
                  ? `${suyas.filter((g) => g.vencida).length} vencidas`
                  : undefined
              }
            >
              {suyas.map((gestion) => (
                <Tarjeta key={gestion.id} gestion={gestion} />
              ))}
            </ColumnaTablero>
          );
        })}
      </Tablero>
    </>
  );
}

function Tarjeta({ gestion }: { gestion: GestionListada }) {
  const [abierta, setAbierta] = useState(false);
  const [nota, setNota] = useState("");
  const [cuando, setCuando] = useState("");
  const [trabajando, empezar] = useTransition();

  function mover(etapa: GestionListada["etapa"]) {
    empezar(async () => {
      await moverGestion(gestion.id, etapa, nota || undefined, cuando || undefined);
      setNota("");
      setCuando("");
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

      {gestion.proximaAccionAt && (
        <p
          className={`mt-1.5 flex items-center gap-1.5 text-sm ${
            gestion.vencida ? "font-medium text-destructive" : "text-muted-foreground"
          }`}
        >
          <CalendarClock className="h-3.5 w-3.5" />
          {gestion.vencida ? "Vencía el" : "Volver el"}{" "}
          {gestion.proximaAccionAt.toLocaleDateString("es-AR")}
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
            <input
              type="date"
              value={cuando}
              onChange={(e) => setCuando(e.target.value)}
              className="tabular h-10 flex-1 rounded-lg border border-linea bg-background px-2 text-base"
            />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {ETAPAS.filter((e) => e.valor !== gestion.etapa).map((e) => (
              <button
                key={e.valor}
                type="button"
                disabled={trabajando}
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
          className="mt-2.5 text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
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

/** Abrir un seguimiento nuevo. */
function NuevaGestion({ clientes }: { clientes: { id: string; nombre: string }[] }) {
  const [abierto, setAbierto] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, empezar] = useTransition();

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
      action={(formData) =>
        empezar(async () => {
          const r = await crearGestion({}, formData);
          setAviso(r.error ?? r.ok ?? null);
          if (!r.error) setAbierto(false);
        })
      }
      className="tarjeta space-y-3 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium">Cliente</span>
          <select
            name="customerId"
            required
            className="mt-1 h-10 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
          >
            <option value="">Elegí un cliente</option>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">De qué se trata</span>
          <input
            name="asunto"
            required
            placeholder="Cobrar la factura 0015-00001234"
            className="mt-1 h-10 w-full rounded-lg border border-linea bg-background px-3 text-base"
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium">Volver el</span>
          <input
            name="proximaAccion"
            type="date"
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
          disabled={trabajando}
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
