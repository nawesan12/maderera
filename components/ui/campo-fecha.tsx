"use client";

import { useState, type ComponentProps, type ComponentType } from "react";
import { aIso, aPantalla, conBarras } from "@/lib/fecha-texto";

type Props = Omit<
  ComponentProps<"input">,
  "type" | "value" | "defaultValue" | "onChange" | "min" | "max"
> & {
  /** aaaa-mm-dd. Con `value` el campo es controlado. */
  value?: string | null;
  defaultValue?: string | null;
  min?: string;
  max?: string;
  /**
   * Con la fecha en aaaa-mm-dd, como la daba el `<input type="date">`: solo
   * cuando quedó una fecha entera y válida, o "" si se borró.
   */
  onChange?: (e: { target: { value: string } }) => void;
  /** Avisar solo con una fecha entera o el campo vacío (lo que se guarda al cambiar). */
  soloCompleta?: boolean;
  /**
   * Si lo escrito es una fecha que se puede guardar (o nada). A medio
   * escribir, `onChange` dice "" igual que el campo vacío, y el formulario
   * no sabía que había una fecha incompleta (M3S4-020).
   */
  onValidez?: (valida: boolean) => void;
  /** El campo que se dibuja: el `Input` del panel donde había uno. */
  Entrada?: ComponentType<ComponentProps<"input">> | "input";
};

/**
 * El reemplazo del `<input type="date">`: se escribe dd/mm/aaaa de corrido
 * —las barras se ponen solas— con el teclado numérico. El nativo mostraba
 * «mm/dd/yyyy» en un navegador en inglés (H267 y la tercera prueba del mes).
 *
 * Con `name`, el formulario recibe aaaa-mm-dd en un campo oculto: las
 * acciones no cambian. Una fecha fuera de `min`/`max` queda marcada y no se
 * manda, como hacía el selector nativo.
 */
export function CampoFecha({
  value,
  defaultValue,
  onChange,
  min,
  max,
  name,
  className,
  onBlur,
  Entrada = "input",
  soloCompleta = false,
  onValidez,
  ...resto
}: Props) {
  const controlado = value !== undefined;
  const inicial = (controlado ? value : defaultValue) ?? "";
  const [texto, setTexto] = useState(aPantalla(inicial));
  const [iso, setIso] = useState(inicial);
  const [deAntes, setDeAntes] = useState(inicial);
  const [tocado, setTocado] = useState(false);

  // Si el valor cambió desde afuera (otro campo, un reinicio), el campo lo sigue.
  const externo = (controlado ? value : defaultValue) ?? "";
  if (externo !== deAntes) {
    setDeAntes(externo);
    if (externo !== iso) {
      setIso(externo);
      setTexto(aPantalla(externo));
    }
  }

  const leido = aIso(texto);
  const fueraDeRango =
    leido !== null && ((min && leido < min) || (max && leido > max));
  const invalido =
    texto.trim() !== "" && (leido === null || Boolean(fueraDeRango));

  function cambiar(escrito: string) {
    const nuevo = conBarras(escrito);
    setTexto(nuevo);
    setTocado(false);
    const leida = nuevo === "" ? "" : aIso(nuevo);
    const valida =
      leida !== null && !(leida !== "" && ((min && leida < min) || (max && leida > max)));
    onValidez?.(valida);
    // A medio escribir, el formulario se entera de que no hay fecha: si no,
    // mandaba la de antes sin que se viera. Lo que guarda solo al cambiar
    // (`soloCompleta`) espera a una fecha entera o al campo vacío.
    if (!valida && soloCompleta) return;
    const fecha = valida ? leida : "";
    if (fecha === iso) return;
    setIso(fecha);
    setDeAntes(controlado ? fecha : externo);
    onChange?.({ target: { value: fecha } });
  }

  return (
    <>
      <Entrada
        {...resto}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={resto.placeholder ?? "dd/mm/aaaa"}
        maxLength={10}
        value={texto}
        aria-invalid={
          resto["aria-invalid"] || (tocado && invalido) || undefined
        }
        onChange={(e) => cambiar(e.target.value)}
        onBlur={(e) => {
          setTocado(true);
          onBlur?.(e);
        }}
        className={className}
      />
      {name && <input type="hidden" name={name} value={invalido ? "" : iso} />}
    </>
  );
}
