"use client";

import { useActionState, useEffect, useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Confirmar } from "@/components/admin/confirmar";
import { ETIQUETA_ROL, type RolStaff } from "@/lib/roles";
import { cambiarPuesto, darDeAlta, darDeBaja, type EstadoPersonal } from "./actions";

const PUESTOS = Object.entries(ETIQUETA_ROL) as [RolStaff, string][];

const CAMPO = "mt-1 h-11 w-full rounded-lg border bg-background px-3 text-base";

interface Persona {
  id: string;
  nombre: string;
  correo: string;
  rol: RolStaff;
}

/**
 * Un renglón: quién es y su puesto, que se cambia ahí mismo. La baja pregunta
 * antes (cierra las sesiones de esa persona). El renglón propio no se toca:
 * un admin que se saca el puesto se queda afuera de esta pantalla.
 */
export function FilaDePersona({ persona, esVos }: { persona: Persona; esVos: boolean }) {
  const [cambiando, empezar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  // Entrar o salir de Administración da o saca todo el panel: se confirma.
  // Antes se aplicaba al soltar el desplegable (mes simulado, M2S1-132).
  const [puestoAConfirmar, setPuestoAConfirmar] = useState<RolStaff | null>(null);
  const id = useId();

  function hacer(fn: () => Promise<EstadoPersonal>) {
    empezar(async () => {
      const r = await fn();
      setConfirmando(false);
      setPuestoAConfirmar(null);
      if (r.error) toast.error(r.error);
      else toast.success(r.ok ?? "Listo.");
    });
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
      <div className="min-w-0 flex-1">
        <p className="text-base font-semibold">{persona.nombre}</p>
        <p className="break-all text-sm text-texto-2">{persona.correo}</p>
      </div>
      {esVos ? (
        <p className="text-base font-medium text-texto-2">{ETIQUETA_ROL[persona.rol]}</p>
      ) : (
        <div className="flex items-center gap-2">
          <label htmlFor={`${id}-rol`} className="sr-only">
            Puesto de {persona.nombre}
          </label>
          <select
            id={`${id}-rol`}
            value={persona.rol}
            disabled={cambiando}
            onChange={(e) => {
              const rol = e.target.value as RolStaff;
              if (rol === "admin" || persona.rol === "admin") setPuestoAConfirmar(rol);
              else hacer(() => cambiarPuesto(persona.id, rol));
            }}
            className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-2.5 text-base sm:flex-none"
          >
            {PUESTOS.map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
          {cambiando && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          <button
            type="button"
            disabled={cambiando}
            onClick={() => setConfirmando(true)}
            className="inline-flex h-11 shrink-0 items-center px-2 text-base text-destructive underline-offset-2 hover:underline disabled:opacity-60"
          >
            Dar de baja
          </button>
        </div>
      )}
      <Confirmar
        abierto={puestoAConfirmar !== null}
        alCerrar={() => setPuestoAConfirmar(null)}
        titulo={
          puestoAConfirmar === "admin"
            ? `Pasar a ${persona.nombre} a ${ETIQUETA_ROL.admin}`
            : `Sacar a ${persona.nombre} de ${ETIQUETA_ROL.admin}`
        }
        detalle={
          puestoAConfirmar === "admin"
            ? "Ve y cambia todo el panel, también precios, personal y reglas."
            : "Deja de ver lo de Administración."
        }
        confirmar={puestoAConfirmar ? `Sí, ${ETIQUETA_ROL[puestoAConfirmar]}` : "Sí"}
        pendiente={cambiando}
        alConfirmar={() => {
          const rol = puestoAConfirmar;
          if (rol) hacer(() => cambiarPuesto(persona.id, rol));
        }}
      />
      <Confirmar
        abierto={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`Dar de baja a ${persona.nombre}`}
        detalle="Deja de entrar al panel ahora mismo. Lo que cargó sigue a su nombre."
        confirmar="Sí, dar de baja"
        peligro
        pendiente={cambiando}
        alConfirmar={() => hacer(() => darDeBaja(persona.id))}
      />
    </li>
  );
}

const inicial: EstadoPersonal = {};

/** El alta: nombre, correo, puesto y la contraseña con la que entra la primera vez. */
export function FormularioDeAlta() {
  const [estado, enviar, enviando] = useActionState(darDeAlta, inicial);
  const [verClave, setVerClave] = useState(false);
  const formulario = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    if (estado.ok) {
      toast.success(estado.ok);
      formulario.current?.reset();
    }
  }, [estado]);

  return (
    <form ref={formulario} action={enviar} className="tarjeta grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
      <div>
        <label htmlFor={`${id}-nombre`} className="block text-base font-medium">
          Nombre
        </label>
        <input id={`${id}-nombre`} name="nombre" required autoComplete="off" className={CAMPO} />
      </div>
      <div>
        <label htmlFor={`${id}-correo`} className="block text-base font-medium">
          Correo
        </label>
        <input
          id={`${id}-correo`}
          name="correo"
          type="email"
          required
          autoComplete="off"
          inputMode="email"
          className={CAMPO}
        />
      </div>
      <div>
        <label htmlFor={`${id}-rol`} className="block text-base font-medium">
          Puesto
        </label>
        <select id={`${id}-rol`} name="rol" defaultValue="vendedor" className={CAMPO}>
          {PUESTOS.map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-clave`} className="block text-base font-medium">
          Contraseña inicial
        </label>
        <div className="relative">
          <input
            id={`${id}-clave`}
            name="clave"
            type={verClave ? "text" : "password"}
            required
            minLength={8}
            autoComplete="new-password"
            spellCheck={false}
            className={`${CAMPO} pr-12`}
          />
          <button
            type="button"
            onClick={() => setVerClave((v) => !v)}
            aria-label={verClave ? "Ocultar la contraseña" : "Mostrar la contraseña"}
            aria-pressed={verClave}
            className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground"
          >
            {verClave ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
      </div>
      {estado.error && (
        <p role="alert" className="estado-problema text-base font-medium sm:col-span-2">
          {estado.error}
        </p>
      )}
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={enviando}
          className="boton-accion inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg px-5 text-base font-medium disabled:opacity-60 sm:w-auto"
        >
          {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
          Dar de alta
        </button>
      </div>
    </form>
  );
}
