"use client";

import { startTransition, useActionState, useState } from "react";
import { Confirmar } from "@/components/admin/confirmar";
import { BellRing, Loader2, Trash2 } from "lucide-react";
import {
  borrarEvento,
  cambiarEstadoEvento,
  mandarRecordatorios,
  recordarEvento,
  type EstadoEvento,
} from "./actions";

const inicial: EstadoEvento = {};

/**
 * Publicar, cerrar o cancelar un evento, y borrar un borrador vacío.
 *
 * Solo aparecen las transiciones que tienen sentido desde el estado actual:
 * ofrecer "publicar" sobre algo ya publicado es cómo se pierde la confianza en
 * los botones de una pantalla. «Volver a borrador» con gente anotada pregunta
 * antes (M2S1-129).
 */
export function AccionesEvento({
  id,
  titulo,
  estado,
  anotados,
}: {
  id: string;
  titulo: string;
  estado: string;
  anotados: number;
}) {
  const [resultado, cambiar, cambiando] = useActionState(
    cambiarEstadoEvento,
    inicial,
  );
  const [, borrar, borrando] = useActionState(borrarEvento, inicial);
  const [confirmando, setConfirmando] = useState<"borrador" | "borrar" | null>(null);

  const opciones: { valor: string; texto: string; principal?: boolean }[] =
    estado === "borrador"
      ? [{ valor: "publicado", texto: "Publicar", principal: true }]
      : estado === "publicado"
        ? [
            { valor: "cerrado", texto: "Cerrar inscripciones" },
            { valor: "borrador", texto: "Volver a borrador" },
          ]
        : estado === "cerrado"
          ? [{ valor: "publicado", texto: "Reabrir" }]
          : [];

  function aplicar(valor: string) {
    const datos = new FormData();
    datos.set("id", id);
    datos.set("estado", valor);
    startTransition(() => cambiar(datos));
  }

  // Sin caja propia: los botones van en la fila de la tarjeta, con Editar y
  // Recordar (M4-075).
  return (
    <div className="contents">
      {opciones.map((opcion) => (
        <button
          key={opcion.valor}
          type="button"
          disabled={cambiando}
          onClick={() =>
            opcion.valor === "borrador" && anotados > 0 ? setConfirmando("borrador") : aplicar(opcion.valor)
          }
          className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-base font-medium transition-colors disabled:opacity-60 ${
            opcion.principal
              ? "bg-accion text-white hover:bg-brand-orange-dark"
              : "border hover:bg-muted"
          }`}
        >
          {cambiando && <Loader2 className="h-4 w-4 animate-spin" />}
          {opcion.texto}
        </button>
      ))}

      {estado === "borrador" && anotados === 0 && (
        <button
          type="button"
          disabled={borrando}
          onClick={() => setConfirmando("borrar")}
          aria-label={`Borrar ${titulo}`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg border text-texto-3 transition-colors hover:text-destructive disabled:opacity-60"
        >
          {borrando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      )}

      <Confirmar
        abierto={confirmando === "borrador"}
        alCerrar={() => setConfirmando(null)}
        titulo={`Pasar «${titulo}» a borrador`}
        detalle={`Deja de verse en el sitio. ${anotados === 1 ? "Hay 1 anotado" : `Hay ${anotados} anotados`}.`}
        confirmar="Volver a borrador"
        alConfirmar={() => {
          setConfirmando(null);
          aplicar("borrador");
        }}
      />
      <Confirmar
        abierto={confirmando === "borrar"}
        alCerrar={() => setConfirmando(null)}
        titulo={`Borrar «${titulo}»`}
        detalle="No se puede deshacer."
        confirmar="Borrar"
        peligro
        alConfirmar={() => {
          setConfirmando(null);
          const datos = new FormData();
          datos.set("id", id);
          startTransition(() => borrar(datos));
        }}
      />

      {resultado.ok && (
        <p className="w-full text-base text-muted-foreground sm:text-right">
          {resultado.ok}
        </p>
      )}
      {resultado.error && (
        <p className="w-full text-base text-destructive sm:text-right">
          {resultado.error}
        </p>
      )}
    </div>
  );
}

/**
 * Dispara los recordatorios de los eventos de mañana. Dice a cuántos les llega
 * y sin nadie a quién avisar no se ofrece: pedía confirmar y después decía
 * que no había nadie (M2S1-130).
 */
export function Recordatorios({ porRecordar }: { porRecordar: number }) {
  return (
    <BotonRecordar
      porRecordar={porRecordar}
      texto="Recordar los de mañana"
      titulo="Recordarles a los anotados de mañana"
      accion={mandarRecordatorios}
    />
  );
}

/** El recordatorio de un evento, desde su tarjeta. */
export function RecordarEvento({ id, titulo, porRecordar }: { id: string; titulo: string; porRecordar: number }) {
  return (
    <BotonRecordar
      porRecordar={porRecordar}
      texto="Recordar"
      titulo={`Recordarles a los anotados de «${titulo}»`}
      accion={recordarEvento.bind(null, id)}
    />
  );
}

function BotonRecordar({
  porRecordar,
  texto,
  titulo,
  accion,
}: {
  porRecordar: number;
  texto: string;
  titulo: string;
  accion: (previo: EstadoEvento) => Promise<EstadoEvento>;
}) {
  const [estado, mandar, mandando] = useActionState(accion, inicial);
  const [confirmando, setConfirmando] = useState(false);

  if (porRecordar === 0 && !estado.ok) return null;

  return (
    <div className="flex items-center gap-3">
      {estado.ok && (
        <span className="text-base text-muted-foreground">{estado.ok}</span>
      )}
      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={titulo}
        detalle={`Les llega a ${porRecordar === 1 ? "1 persona" : `${porRecordar} personas`}. Una vez enviado no se puede retirar.`}
        confirmar="Mandar el recordatorio"
        alConfirmar={() => {
          setConfirmando(false);
          startTransition(() => mandar());
        }}
      />
      {porRecordar > 0 && (
        <button
          type="button"
          onClick={() => setConfirmando(true)}
          disabled={mandando}
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-60"
        >
          {mandando ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <BellRing className="h-5 w-5" />
          )}
          {texto}
          <span className="tabular text-sm text-muted-foreground">{porRecordar}</span>
        </button>
      )}
    </div>
  );
}
