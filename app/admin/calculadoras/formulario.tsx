"use client";

import { useActionState } from "react";
import { AlertCircle, Check, Loader2, Save } from "lucide-react";
import type { ParametrosDeCalculo } from "@/lib/calculations";
import { guardarParametros, type EstadoCalculadoras } from "./actions";

const inicial: EstadoCalculadoras = {};

/**
 * Los parámetros con los que calculan las cuatro calculadoras.
 *
 * Tres de estos números el brief no los contestó y estaban anotados en
 * `docs/CAMBIOS.md` esperando: el desperdicio por material, la pendiente del
 * techo y el solape de la membrana. Ahora se cargan acá, sin esperar a nadie.
 *
 * Los porcentajes se escriben como porcentaje —20, no 0,20— porque es como se
 * dicen. La conversión la hace el servidor.
 */
export function FormularioParametros({
  parametros,
}: {
  parametros: ParametrosDeCalculo;
}) {
  const [estado, guardar, guardando] = useActionState(
    guardarParametros,
    inicial,
  );

  return (
    <form action={guardar} className="space-y-5">
      {estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-base text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}
      {estado.ok && !estado.error && (
        <p className="flex items-start gap-2 rounded-lg bg-brand-green/10 p-3 text-base text-brand-green">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.ok}
        </p>
      )}

      <Grupo
        titulo="Techos"
        detalle="Lo que se pierde y cuánto rinde cada rollo."
      >
        <Campo
          nombre="factorPendiente"
          etiqueta="Pendiente del techo"
          sufijo="%"
          valor={parametros.factorPendiente * 100}
          ayuda="Cuánta superficie de más tiene el techo respecto de lo que mide la planta. A mayor pendiente, más material."
        />
        <Campo
          nombre="mermaMachimbre"
          etiqueta="Merma del machimbre"
          sufijo="%"
          valor={parametros.mermaMachimbre * 100}
          ayuda="Lo que se pierde en el encastre de cada tabla."
        />
        <Campo
          nombre="separacionTechoM"
          etiqueta="Separación entre tirantes"
          sufijo="m"
          valor={parametros.separacionTechoM}
          ayuda="Cada cuánto va un tirante en el techo."
        />
        <Campo
          nombre="rindeRolloMembrana"
          etiqueta="Rinde de un rollo de membrana"
          sufijo="m²"
          valor={parametros.rindeRolloMembrana}
          ayuda="Cuántos metros cubre un rollo, ya descontado el solape entre paños."
        />
        <Campo
          nombre="rindeRolloAislacion"
          etiqueta="Rinde de un rollo de lana"
          sufijo="m²"
          valor={parametros.rindeRolloAislacion}
          ayuda="Cuántos metros cubre un rollo entero."
        />
      </Grupo>

      <Grupo titulo="Placas" detalle="El corte y lo que se descarta.">
        <Campo
          nombre="anchoSierraMm"
          etiqueta="Ancho de la sierra"
          sufijo="mm"
          valor={parametros.anchoSierraMm}
          ayuda="El espesor del disco: lo que se pierde en cada pasada."
        />
        <Campo
          nombre="margenSeguridad"
          etiqueta="Desperdicio de seguridad"
          sufijo="%"
          valor={parametros.margenSeguridad * 100}
          ayuda="Aparte de lo que se lleva la sierra: los recortes que quedan chicos para todo. Subilo si el material viene con más fallas."
        />
      </Grupo>

      <Grupo titulo="Pisos y decks" detalle="Estructura y medida de la tabla.">
        <Campo
          nombre="separacionPisoM"
          etiqueta="Separación entre tirantes de entrepiso"
          sufijo="m"
          valor={parametros.separacionPisoM}
          ayuda="Cada cuánto va un tirante en el piso. Es la misma separación que se usa para las alfajías del deck."
        />
        <Campo
          nombre="deckGrandisLargoM"
          etiqueta="Tabla de grandis — largo"
          sufijo="m"
          valor={parametros.deck.grandis.largoM}
        />
        <Campo
          nombre="deckGrandisAnchoM"
          etiqueta="Tabla de grandis — ancho"
          sufijo="m"
          valor={parametros.deck.grandis.anchoM}
          ayuda="En metros: una tabla de 10 cm se carga como 0,1."
        />
        <Campo
          nombre="deckPvcLargoM"
          etiqueta="Tabla de PVC — largo"
          sufijo="m"
          valor={parametros.deck.pvc.largoM}
        />
        <Campo
          nombre="deckPvcAnchoM"
          etiqueta="Tabla de PVC — ancho"
          sufijo="m"
          valor={parametros.deck.pvc.anchoM}
        />
      </Grupo>

      <button
        type="submit"
        disabled={guardando}
        className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-medium disabled:opacity-60"
      >
        {guardando ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Save className="h-4 w-4" />
        )}
        Guardar parámetros
      </button>
    </form>
  );
}

function Grupo({
  titulo,
  detalle,
  children,
}: {
  titulo: string;
  detalle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tarjeta">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-base font-medium">{titulo}</h2>
        <p className="text-base text-muted-foreground">{detalle}</p>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Campo({
  nombre,
  etiqueta,
  sufijo,
  valor,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  sufijo: string;
  valor: number;
  ayuda?: string;
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={nombre}
          name={nombre}
          inputMode="decimal"
          // `defaultValue` y no `value`: es un formulario sin estado, lo que se
          // manda es lo que quedó escrito.
          defaultValue={String(Number(valor.toFixed(4)))}
          className="tabular h-10 w-full rounded-lg border bg-background px-3 text-base"
        />
        <span className="text-base text-muted-foreground">{sufijo}</span>
      </div>
      {ayuda && (
        <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>
      )}
    </div>
  );
}
