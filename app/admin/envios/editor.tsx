"use client";

import { useActionState, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { guardarZona, type EstadoZona } from "./actions";

const inicial: EstadoZona = {};

export interface ZonaEditable {
  id: string;
  nombre: string;
  cobertura: string;
  demoraEstimada: string | null;
  aCotizar: boolean;
  costo: string;
  envioGratisDesde: string;
  orden: string;
  activa: boolean;
}

/**
 * Una zona, con su formulario.
 *
 * El interruptor de "a cotizar" oculta los dos importes en vez de dejarlos
 * grises: si el flete se cotiza aparte, una tarifa cargada al lado invita a
 * creer que igual se cobra. Es la misma confusión que había cuando la única
 * forma de decir "depende" era poner el costo en cero.
 */
export function EditorDeZona({ zona }: { zona: ZonaEditable | null }) {
  const [estado, guardar, guardando] = useActionState(guardarZona, inicial);
  const [aCotizar, setACotizar] = useState(zona?.aCotizar ?? true);
  const id = useId();

  return (
    <form action={guardar} className="space-y-4 rounded-xl border bg-card p-5">
      {zona && <input type="hidden" name="id" value={zona.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="nombre"
          etiqueta="Zona"
          valorInicial={zona?.nombre ?? ""}
          placeholder="Mar del Plata"
          requerido
        />
        <Campo
          nombre="demoraEstimada"
          etiqueta="Plazo"
          valorInicial={zona?.demoraEstimada ?? ""}
          placeholder="Coordinamos al confirmar"
          ayuda="Lo que ve el cliente al elegir la zona."
        />
      </div>

      <Campo
        nombre="cobertura"
        etiqueta="Códigos postales o localidades"
        valorInicial={zona?.cobertura ?? ""}
        placeholder="7600, 7601"
        ayuda="Separados por coma. Es para uso interno: todavía no filtra nada solo."
      />

      <label className="flex items-start gap-2.5 text-base">
        <input
          type="checkbox"
          name="aCotizar"
          checked={aCotizar}
          onChange={(e) => setACotizar(e.target.checked)}
          className="mt-1 h-4 w-4 accent-brand-orange"
        />
        <span>
          El flete de esta zona se cotiza en cada pedido
          <span className="mt-0.5 block text-sm text-muted-foreground">
            El pedido entra sin cargo de envío y el checkout dice «A cotizar».
            Es lo que corresponde cuando el precio depende del volumen o de si
            va en camión propio.
          </span>
        </span>
      </label>

      {!aCotizar && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            nombre="costo"
            etiqueta="Costo del envío"
            valorInicial={zona?.costo ?? "0"}
            placeholder="18.000"
          />
          <Campo
            nombre="envioGratisDesde"
            etiqueta="Envío sin cargo desde"
            valorInicial={zona?.envioGratisDesde ?? "0"}
            placeholder="0"
            ayuda="Cero desactiva la promoción."
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Campo
          nombre="orden"
          etiqueta="Orden en la lista"
          valorInicial={zona?.orden ?? "0"}
        />
        <label
          htmlFor={`${id}-activa`}
          className="flex items-center gap-2.5 self-end pb-2 text-base"
        >
          <input
            id={`${id}-activa`}
            type="checkbox"
            name="activa"
            defaultChecked={zona?.activa ?? true}
            className="h-4 w-4 accent-brand-orange"
          />
          Se ofrece en el checkout
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-orange px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {zona ? "Guardar" : "Agregar zona"}
        </button>

        {estado.error && <p className="text-base text-destructive">{estado.error}</p>}
        {estado.ok && <p className="text-base text-muted-foreground">{estado.ok}</p>}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  ayuda,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
  ayuda?: string;
  requerido?: boolean;
}) {
  // Uno por campo y por zona: la pantalla dibuja varios formularios iguales, y
  // con ids derivados del nombre las etiquetas de uno enfocan los campos de otro.
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-base font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        name={nombre}
        required={requerido}
        defaultValue={valorInicial}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-lg border bg-background px-3 text-base"
      />
      {ayuda && <p className="mt-1 text-sm text-muted-foreground">{ayuda}</p>}
    </div>
  );
}
