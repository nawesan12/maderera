"use client";

import {
  startTransition,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { Switch } from "@/components/ui/switch";

type Icono = ComponentType<{ className?: string }>;

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
      const datos = new FormData(
        e.currentTarget,
        (e.nativeEvent as SubmitEvent).submitter,
      );
      startTransition(() => accion(datos));
    },
  };
}

/**
 * La hoja del formulario: una sola superficie con sus secciones separadas por
 * una línea suave, en vez de una caja por grupo (10/11/2026, Nahuel: «los
 * formularios todos también están horribles»).
 */
export function Hoja({
  children,
  hidden,
}: {
  children: ReactNode;
  hidden?: boolean;
}) {
  return (
    <div
      hidden={hidden}
      className="tarjeta divide-y divide-linea-suave px-5 sm:px-8"
    >
      {children}
    </div>
  );
}

/**
 * Un grupo de campos: el título a la izquierda y los campos a la derecha, así
 * el ojo recorre los títulos para encontrar el grupo y no lee campo por campo.
 * En pantallas angostas el título va arriba. Sin bajada: el título alcanza.
 * Un campo que tiene que ir a lo ancho lleva `md:col-span-2` (o `-3`).
 */
export function Seccion({
  titulo,
  icono: IconoSeccion,
  children,
  columnas = 2,
  hidden,
}: {
  titulo: string;
  icono?: Icono;
  children: ReactNode;
  columnas?: 1 | 2 | 3;
  hidden?: boolean;
}) {
  const grilla = { 1: "", 2: "md:grid-cols-2", 3: "md:grid-cols-3" }[columnas];
  return (
    <section
      hidden={hidden}
      className="grid gap-x-10 gap-y-5 py-8 2xl:grid-cols-[11rem_minmax(0,1fr)]"
    >
      <h2 className="flex items-center gap-3 text-[19px] font-bold tracking-tight 2xl:flex-col 2xl:items-start">
        {IconoSeccion && (
          <span className="ficha-icono flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
            <IconoSeccion className="h-6 w-6" />
          </span>
        )}
        {titulo}
      </h2>
      <div className={`grid gap-x-5 gap-y-5 ${grilla}`}>{children}</div>
    </section>
  );
}

/**
 * Una elección entre pocas opciones, como fichas para tocar en vez de un
 * desplegable: se ven todas de una vez y la elegida queda hundida y naranja.
 * Son radios de verdad, así que viajan con el formulario.
 */
export function Opciones({
  nombre,
  opciones,
  valor,
  defecto,
  alCambiar,
  columnas = 4,
}: {
  nombre: string;
  opciones: readonly { valor: string; texto: string; icono?: Icono }[];
  valor?: string;
  defecto?: string;
  alCambiar?: (valor: string) => void;
  columnas?: 2 | 3 | 4 | 5;
}) {
  const grilla = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
    5: "grid-cols-3 sm:grid-cols-5",
  }[columnas];
  return (
    <div role="radiogroup" className={`grid gap-2.5 ${grilla}`}>
      {opciones.map((o) => (
        <label
          key={o.valor}
          className="ficha-opcion flex cursor-pointer flex-col items-start gap-2 rounded-xl p-3.5 text-[15px] font-semibold leading-tight"
        >
          <input
            type="radio"
            name={nombre}
            value={o.valor}
            className="sr-only"
            {...(valor !== undefined
              ? {
                  checked: valor === o.valor,
                  onChange: () => alCambiar?.(o.valor),
                }
              : {
                  defaultChecked: defecto === o.valor,
                  onChange: () => alCambiar?.(o.valor),
                })}
          />
          {o.icono && <o.icono className="h-6 w-6 opacity-80" />}
          {o.texto}
        </label>
      ))}
    </div>
  );
}

/**
 * Un interruptor grande, con ícono: la tarjeta se enciende con él. Manda «on»
 * como una casilla, o `valor` si la acción espera otra cosa («si»). Con
 * `marcado` y `alCambiar` es controlado.
 */
export function Interruptor({
  nombre,
  etiqueta,
  icono: IconoInterruptor,
  defecto,
  valor,
  marcado,
  alCambiar,
}: {
  nombre?: string;
  etiqueta: string;
  icono: Icono;
  defecto?: boolean;
  valor?: string;
  marcado?: boolean;
  alCambiar?: (marcado: boolean) => void;
}) {
  const control =
    marcado !== undefined
      ? { checked: marcado, onCheckedChange: (v: boolean) => alCambiar?.(v) }
      : {
          defaultChecked: defecto,
          onCheckedChange: (v: boolean) => alCambiar?.(v),
        };
  return (
    <label className="ficha-interruptor flex cursor-pointer items-center gap-3 rounded-xl p-3.5">
      <span className="ficha-icono flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
        <IconoInterruptor className="h-5 w-5" />
      </span>
      <span className="flex-1 text-[15px] font-semibold leading-tight">
        {etiqueta}
      </span>
      <Switch name={nombre} value={valor} {...control} />
    </label>
  );
}

/**
 * La barra de guardar, fija abajo: en un formulario largo el botón quedaba al
 * final de todo, y para guardar un cambio de arriba había que bajar hasta ahí.
 */
export function BarraGuardar({
  children,
  error,
}: {
  children: ReactNode;
  error?: string | null;
}) {
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
    <div
      role="tablist"
      className="flex gap-1 overflow-x-auto border-b border-linea"
    >
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
          {conError.includes(p.id) && (
            <span
              className="ml-1.5 inline-block h-2 w-2 rounded-full bg-destructive"
              aria-label="con errores"
            />
          )}
        </button>
      ))}
    </div>
  );
}
