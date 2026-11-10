"use client";

import { useActionState, useId, useState } from "react";
import {
  Banknote,
  Eye,
  Loader2,
  MapPin,
  MessageCircleQuestion,
  ShoppingCart,
  Truck,
} from "lucide-react";
import {
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
} from "@/components/admin/formulario";
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

  return (
    <form action={guardar} className="space-y-4">
      {zona && <input type="hidden" name="id" value={zona.id} />}

      <Hoja>
        <Seccion titulo="Zona" icono={MapPin}>
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
          />
          <div className="md:col-span-2">
            <Campo
              nombre="cobertura"
              etiqueta="Códigos postales o localidades"
              valorInicial={zona?.cobertura ?? ""}
              placeholder="7600, 7601"
            />
          </div>
        </Seccion>

        <Seccion titulo="Flete" icono={Truck}>
          {/* Antes era una casilla: viaja igual que ella, `aCotizar=on` solo
              cuando se cotiza. Las fichas llevan otro nombre. */}
          {aCotizar && <input type="hidden" name="aCotizar" value="on" />}
          <div className="md:col-span-2">
            <Opciones
              nombre="tipo-de-flete"
              columnas={2}
              valor={aCotizar ? "cotizar" : "tarifa"}
              alCambiar={(v) => setACotizar(v === "cotizar")}
              opciones={[
                {
                  valor: "cotizar",
                  texto: "Se cotiza en cada pedido",
                  icono: MessageCircleQuestion,
                },
                { valor: "tarifa", texto: "Tarifa fija", icono: Banknote },
              ]}
            />
          </div>

          {!aCotizar && (
            <>
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
              />
            </>
          )}
        </Seccion>

        <Seccion titulo="En el carrito" icono={ShoppingCart}>
          <Campo
            nombre="orden"
            etiqueta="Orden en la lista"
            valorInicial={zona?.orden ?? "0"}
          />
          <div className="self-end">
            <Interruptor
              nombre="activa"
              etiqueta="Se ofrece en el carrito"
              icono={Eye}
              defecto={zona?.activa ?? true}
            />
          </div>
        </Seccion>
      </Hoja>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={guardando}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accion px-4 text-base font-medium text-white transition-colors hover:bg-brand-orange-dark disabled:opacity-60"
        >
          {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
          {zona ? "Guardar" : "Agregar zona"}
        </button>

        {estado.error && (
          <p className="text-base text-destructive">{estado.error}</p>
        )}
        {estado.ok && (
          <p className="text-base text-muted-foreground">{estado.ok}</p>
        )}
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  valorInicial,
  placeholder,
  requerido = false,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string;
  placeholder?: string;
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
    </div>
  );
}
