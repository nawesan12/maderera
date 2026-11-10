"use client";

import { useId, useState, useTransition } from "react";
import {
  BadgeCheck,
  Building2,
  CircleHelp,
  Landmark,
  Loader2,
  Phone,
  ShieldCheck,
  StickyNote,
  Store,
  User,
} from "lucide-react";
import { Opciones, Seccion } from "@/components/admin/formulario";
import { guardarProveedor, type EstadoProveedor } from "./actions";

export interface FichaProveedor {
  id?: string;
  nombre: string;
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: string;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  rubro: string | null;
  cbu: string | null;
  aliasCbu: string | null;
  diasPago: number;
  notas: string | null;
}

const VACIA: FichaProveedor = {
  nombre: "",
  razonSocial: null,
  cuit: null,
  // La mayoría de los proveedores de una maderera son responsables inscriptos:
  // el valor por defecto es el que evita el error más frecuente.
  condicionIva: "responsable_inscripto",
  contacto: null,
  telefono: null,
  email: null,
  direccion: null,
  rubro: null,
  cbu: null,
  aliasCbu: null,
  diasPago: 0,
  notas: null,
};

const CONDICIONES = {
  responsable_inscripto: "Responsable inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
  consumidor_final: "Consumidor final",
  no_categorizado: "No categorizado",
};

const OPCIONES_CONDICION = [
  {
    valor: "responsable_inscripto",
    texto: CONDICIONES.responsable_inscripto,
    icono: BadgeCheck,
  },
  { valor: "monotributista", texto: CONDICIONES.monotributista, icono: Store },
  { valor: "exento", texto: CONDICIONES.exento, icono: ShieldCheck },
  {
    valor: "consumidor_final",
    texto: CONDICIONES.consumidor_final,
    icono: User,
  },
  {
    valor: "no_categorizado",
    texto: CONDICIONES.no_categorizado,
    icono: CircleHelp,
  },
];

/**
 * El mismo formulario para el alta y para la edición.
 *
 * Los datos bancarios están acá y no en una pantalla de pagos porque es al
 * cargar la ficha cuando alguien tiene el mail del proveedor abierto con el CBU
 * adentro. Pedirlo después, en el momento de pagar, es garantizar que se
 * escriba a las apuradas.
 */
export function FormularioProveedor({
  ficha = VACIA,
  onListo,
}: {
  ficha?: FichaProveedor;
  onListo?: (id: string) => void;
}) {
  const [datos, setDatos] = useState(ficha);
  const [estado, setEstado] = useState<EstadoProveedor>({});
  const [enCurso, empezar] = useTransition();
  // Las fichas de la condición son radios sin formulario: el nombre tiene que
  // ser único en la página por si hay dos fichas abiertas a la vez.
  const grupoCondicion = useId();

  function campo<K extends keyof FichaProveedor>(
    clave: K,
    valor: FichaProveedor[K],
  ) {
    setDatos((prev) => ({ ...prev, [clave]: valor }));
  }

  function guardar() {
    empezar(async () => {
      const resultado = await guardarProveedor({
        ...datos,
        razonSocial: datos.razonSocial ?? undefined,
        cuit: datos.cuit ?? undefined,
        condicionIva: datos.condicionIva as "responsable_inscripto",
        contacto: datos.contacto ?? undefined,
        telefono: datos.telefono ?? undefined,
        email: datos.email ?? undefined,
        direccion: datos.direccion ?? undefined,
        rubro: datos.rubro ?? undefined,
        cbu: datos.cbu ?? undefined,
        aliasCbu: datos.aliasCbu ?? undefined,
        notas: datos.notas ?? undefined,
      });
      setEstado(resultado);
      if (resultado.id && onListo) onListo(resultado.id);
    });
  }

  return (
    <div className="space-y-4">
      {/* Sin hoja propia: vive dentro del diálogo del alta y de la tarjeta
          «Editar la ficha», que ya son la superficie. */}
      <div className="divide-y divide-linea-suave">
        <Seccion titulo="Quién es" icono={Building2}>
          <Campo
            etiqueta="Nombre"
            valor={datos.nombre}
            onCambio={(v) => campo("nombre", v)}
            requerido
          />
          <Campo
            etiqueta="Razón social"
            valor={datos.razonSocial ?? ""}
            onCambio={(v) => campo("razonSocial", v || null)}
          />
          <Campo
            etiqueta="CUIT"
            valor={datos.cuit ?? ""}
            onCambio={(v) => campo("cuit", v || null)}
          />
          <Campo
            etiqueta="Rubro"
            valor={datos.rubro ?? ""}
            onCambio={(v) => campo("rubro", v || null)}
          />
          <div className="space-y-1 md:col-span-2">
            <span className="text-sm font-medium">Condición frente al IVA</span>
            <Opciones
              nombre={`condicion-iva-${grupoCondicion}`}
              opciones={OPCIONES_CONDICION}
              valor={datos.condicionIva}
              alCambiar={(v) => campo("condicionIva", v)}
              columnas={3}
            />
          </div>
        </Seccion>

        <Seccion titulo="Contacto" icono={Phone}>
          <Campo
            etiqueta="Con quién se habla"
            valor={datos.contacto ?? ""}
            onCambio={(v) => campo("contacto", v || null)}
          />
          <Campo
            etiqueta="Teléfono"
            valor={datos.telefono ?? ""}
            onCambio={(v) => campo("telefono", v || null)}
          />
          <Campo
            etiqueta="Correo"
            valor={datos.email ?? ""}
            onCambio={(v) => campo("email", v || null)}
          />
          <Campo
            etiqueta="Dirección"
            valor={datos.direccion ?? ""}
            onCambio={(v) => campo("direccion", v || null)}
          />
        </Seccion>

        <Seccion titulo="Pago" icono={Landmark}>
          <label className="block">
            <span className="text-sm font-medium">
              Días de pago (0 es contra entrega)
            </span>
            <input
              type="number"
              min="0"
              max="365"
              value={datos.diasPago}
              onChange={(e) => campo("diasPago", Number(e.target.value))}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          <Campo
            etiqueta="Alias"
            valor={datos.aliasCbu ?? ""}
            onCambio={(v) => campo("aliasCbu", v || null)}
          />
          <div className="md:col-span-2">
            <Campo
              etiqueta="CBU"
              valor={datos.cbu ?? ""}
              onCambio={(v) => campo("cbu", v || null)}
            />
          </div>
        </Seccion>

        <Seccion titulo="Notas" icono={StickyNote} columnas={1}>
          <label className="block">
            <span className="sr-only">Notas</span>
            <textarea
              value={datos.notas ?? ""}
              onChange={(e) => campo("notas", e.target.value || null)}
              rows={2}
              className="w-full rounded-lg border border-linea bg-card px-3 py-2 text-base"
            />
          </label>
        </Seccion>
      </div>

      {(estado.error || estado.ok) && (
        <p
          className={`text-sm ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      <button
        type="button"
        onClick={guardar}
        disabled={enCurso || !datos.nombre.trim()}
        className="inline-flex h-11 items-center gap-2 rounded-lg bg-accion px-4 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar
      </button>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  onCambio,
  requerido,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  requerido?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">
        {etiqueta}
        {requerido && (
          <span className="text-saldo-debe" aria-label="obligatorio">
            {" *"}
          </span>
        )}
      </span>
      <input
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
      />
    </label>
  );
}
