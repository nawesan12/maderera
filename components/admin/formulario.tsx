"use client";

import { startTransition, type FormEvent, type ReactNode } from "react";

/**
 * La base de los formularios del panel (notas del 9/11/2026: «los formularios
 * son re planos, infinitos, miles de campos desorganizados y sueltos»).
 */

/**
 * Manda el formulario a la acción **sin vaciarlo**.
 *
 * Con `<form action={accion}>`, React 19 reinicia los campos no controlados
 * apenas termina la acción, también cuando falla: un precio mal tipeado en un
 * producto de veinte campos obligaba a cargarlo todo de nuevo. Se usa en
 * lugar de `action`: `<form {...sinReiniciar(accion)}>`.
 *
 * El botón que mandó el formulario viaja con su nombre y su valor, como con
 * `action`.
 */
export function sinReiniciar(accion: (datos: FormData) => void) {
  return {
    onSubmit: (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const datos = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
      startTransition(() => accion(datos));
    },
  };
}

/** Un grupo de campos con su título. Sin bajada: el título alcanza. */
export function Seccion({
  titulo,
  children,
  columnas = 2,
  hidden,
}: {
  titulo: string;
  children: ReactNode;
  columnas?: 1 | 2 | 3;
  hidden?: boolean;
}) {
  const grilla = { 1: "", 2: "md:grid-cols-2", 3: "md:grid-cols-3" }[columnas];
  return (
    <section hidden={hidden} className="tarjeta p-6">
      <h2 className="mb-5 text-lg font-semibold">{titulo}</h2>
      <div className={`grid gap-x-5 gap-y-4 ${grilla}`}>{children}</div>
    </section>
  );
}

/**
 * La barra de guardar, fija abajo: en un formulario largo el botón quedaba al
 * final de todo, y para guardar un cambio de arriba había que bajar hasta ahí.
 */
export function BarraGuardar({ children, error }: { children: ReactNode; error?: string | null }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 border-t border-linea bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        {children}
        {error && <p className="text-base text-destructive">{error}</p>}
      </div>
    </div>
  );
}

/**
 * Pestañas para partir un formulario largo. Los paneles quedan montados (con
 * `hidden`) para que todos los campos viajen al guardar.
 */
export function Pestanas<T extends string>({
  pestanas,
  activa,
  alCambiar,
  conError = [],
}: {
  pestanas: readonly { id: T; nombre: string }[];
  activa: T;
  alCambiar: (id: T) => void;
  /** Las que tienen un campo con error: se marcan para saber dónde ir. */
  conError?: T[];
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-linea">
      {pestanas.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          aria-selected={activa === p.id}
          onClick={() => alCambiar(p.id)}
          className={`relative h-12 shrink-0 px-4 text-base font-medium transition-colors ${
            activa === p.id
              ? "text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-full after:bg-accion"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {p.nombre}
          {conError.includes(p.id) && <span className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive" aria-label="con errores" />}
        </button>
      ))}
    </div>
  );
}
