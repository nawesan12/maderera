"use client";

import { useActionState, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { solicitarAcceso, type EstadoSolicitud } from "./actions";

const inicial: EstadoSolicitud = {};

const RUBROS = [
  { valor: "arquitecto", texto: "Arquitectura" },
  { valor: "constructora", texto: "Constructora" },
  { valor: "carpintero", texto: "Carpintería" },
  { valor: "disenador", texto: "Diseño de interiores" },
  { valor: "woodframer", texto: "Wood frame" },
  { valor: "instalador", texto: "Instalación" },
  { valor: "otro", texto: "Otro" },
];

const PASOS = ["Vos", "Tu trabajo", "Contacto"] as const;

/**
 * La solicitud de acceso profesional, en tres pasos (notas del 9/11/2026:
 * «el registro es super poco intuitivo, plano»).
 *
 * Es un solo formulario: los tres pasos están siempre en el DOM y se muestra
 * uno, así la acción recibe todo junto y React no tiene que guardar nada
 * aparte. Cada paso valida lo suyo con la validación del navegador antes de
 * dejar avanzar.
 *
 * Si la acción rechaza, el servidor devuelve lo tipeado y el formulario se
 * rearma con eso (la `key` es el número de intento); vuelve al primer paso,
 * que es donde están los datos que se validan.
 */
export function FormularioProfesional({
  emailSugerido,
  nombreSugerido,
}: {
  emailSugerido?: string | null;
  nombreSugerido?: string | null;
}) {
  const [estado, accion, enviando] = useActionState(solicitarAcceso, inicial);
  const previo = estado.valores;

  if (estado.ok) {
    return (
      <div className="py-6 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-green">
          <Check className="h-7 w-7 text-white" strokeWidth={3} />
        </span>
        <p className="text-xl font-bold">Recibimos tu pedido</p>
        <p className="mt-1.5 text-texto-2">{estado.ok}</p>
      </div>
    );
  }

  return (
    <Pasos key={estado.intento ?? 0} accion={accion} enviando={enviando} error={estado.error}>
      {(paso) => (
        <>
          <fieldset hidden={paso !== 0} className="space-y-4">
            <Campo nombre="nombre" etiqueta="Nombre y apellido" requerido defecto={previo?.nombre || nombreSugerido} autoComplete="name" />
            <div>
              <label htmlFor="documentoNumero" className="block text-sm font-medium">
                DNI o CUIT
              </label>
              <div className="mt-1 flex gap-2">
                <select
                  id="documentoTipo"
                  name="documentoTipo"
                  defaultValue={previo?.documentoTipo || "cuit"}
                  aria-label="Tipo de documento"
                  className="h-12 rounded-[10px] border border-linea bg-background px-3 text-base"
                >
                  <option value="cuit">CUIT</option>
                  <option value="dni">DNI</option>
                </select>
                <input
                  id="documentoNumero"
                  name="documentoNumero"
                  required
                  defaultValue={previo?.documentoNumero}
                  placeholder="30-71234567-1"
                  inputMode="numeric"
                  className="h-12 w-full rounded-[10px] border border-linea bg-background px-3 text-base"
                />
              </div>
              <p className="mt-1 text-sm text-texto-3">Con DNI la factura sale B.</p>
            </div>
            <Campo nombre="razonSocial" etiqueta="Empresa (opcional)" defecto={previo?.razonSocial} autoComplete="organization" />
          </fieldset>

          <fieldset hidden={paso !== 1} className="space-y-4">
            <legend className="mb-2 block text-sm font-medium">A qué te dedicás</legend>
            <div className="grid grid-cols-2 gap-2">
              {RUBROS.map((r) => (
                <label
                  key={r.valor}
                  className="flex h-12 cursor-pointer items-center rounded-[10px] border border-linea px-3.5 text-[15px] transition-colors hover:bg-sitio-alt has-[:checked]:border-accion has-[:checked]:bg-naranja-claro has-[:checked]:font-semibold has-[:checked]:text-acento-sobre-claro"
                >
                  <input
                    type="radio"
                    name="rubro"
                    value={r.valor}
                    required
                    defaultChecked={(previo?.rubro || "arquitecto") === r.valor}
                    className="sr-only"
                  />
                  {r.texto}
                </label>
              ))}
            </div>
            <Campo nombre="redSocial" etiqueta="Instagram o web (opcional)" defecto={previo?.redSocial} placeholder="@tutaller" />
            <Campo
              nombre="volumenEstimado"
              etiqueta="Qué comprás habitualmente (opcional)"
              defecto={previo?.volumenEstimado}
              placeholder="Placas y molduras, unas 40 por mes"
            />
          </fieldset>

          <fieldset hidden={paso !== 2} className="space-y-4">
            <Campo nombre="email" etiqueta="Correo" tipo="email" requerido defecto={previo?.email || emailSugerido} autoComplete="email" />
            <Campo nombre="telefono" etiqueta="WhatsApp" requerido defecto={previo?.telefono} autoComplete="tel" inputMode="tel" />
            <div>
              <label htmlFor="mensaje" className="block text-sm font-medium">
                Algo más (opcional)
              </label>
              <textarea
                id="mensaje"
                name="mensaje"
                defaultValue={previo?.mensaje}
                rows={3}
                className="mt-1 w-full rounded-[10px] border border-linea bg-background px-3 py-2 text-base"
              />
            </div>
          </fieldset>
        </>
      )}
    </Pasos>
  );
}

function Pasos({
  accion,
  enviando,
  error,
  children,
}: {
  accion: (datos: FormData) => void;
  enviando: boolean;
  error?: string;
  children: (paso: number) => React.ReactNode;
}) {
  const [paso, setPaso] = useState(0);
  const formulario = useRef<HTMLFormElement>(null);
  const ultimo = paso === PASOS.length - 1;

  // Valida solo lo que se ve: los campos de los otros pasos están ocultos y
  // el navegador no los puede señalar.
  function pasoValido() {
    const visible = formulario.current?.querySelectorAll("fieldset")[paso];
    const campos = visible ? Array.from(visible.querySelectorAll<HTMLInputElement>("input, select, textarea")) : [];
    for (const c of campos) {
      if (!c.checkValidity()) {
        c.reportValidity();
        return false;
      }
    }
    return true;
  }

  return (
    <form
      ref={formulario}
      action={accion}
      onSubmit={(e) => {
        if (!pasoValido()) {
          e.preventDefault();
        } else if (!ultimo) {
          e.preventDefault();
          setPaso(paso + 1);
        }
      }}
      noValidate
      className="space-y-6"
    >
      <ol className="grid grid-cols-3 gap-2" aria-label="Pasos">
        {PASOS.map((nombre, i) => (
          <li key={nombre} aria-current={i === paso ? "step" : undefined}>
            <span className={`block h-1.5 rounded-full ${i <= paso ? "bg-accion" : "bg-linea"}`} />
            <span className={`mt-1.5 block text-[13px] ${i === paso ? "font-semibold text-foreground" : "text-texto-3"}`}>
              {nombre}
            </span>
          </li>
        ))}
      </ol>

      {children(paso)}

      {error && (
        <p className="flex items-start gap-2 rounded-[10px] bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <div className="flex gap-2">
        {paso > 0 && (
          <button
            type="button"
            onClick={() => setPaso(paso - 1)}
            aria-label="Paso anterior"
            className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-linea transition-colors hover:bg-sitio-alt"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <button
          type="submit"
          disabled={enviando}
          className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[10px] bg-accion text-base font-semibold text-white transition-colors hover:bg-accion-hover disabled:opacity-60"
        >
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {ultimo ? "Pedir mi cuenta" : "Seguir"}
          {!ultimo && <ArrowRight className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}

function Campo({
  nombre,
  etiqueta,
  tipo = "text",
  requerido = false,
  placeholder,
  defecto,
  autoComplete,
  inputMode,
}: {
  nombre: string;
  etiqueta: string;
  tipo?: string;
  requerido?: boolean;
  placeholder?: string;
  defecto?: string | null;
  autoComplete?: string;
  inputMode?: "numeric" | "tel" | "text";
}) {
  return (
    <div>
      <label htmlFor={nombre} className="block text-sm font-medium">
        {etiqueta}
      </label>
      <input
        id={nombre}
        name={nombre}
        type={tipo}
        required={requerido}
        placeholder={placeholder}
        defaultValue={defecto ?? undefined}
        autoComplete={autoComplete}
        inputMode={inputMode}
        className="mt-1 h-12 w-full rounded-[10px] border border-linea bg-background px-3 text-base"
      />
    </div>
  );
}
