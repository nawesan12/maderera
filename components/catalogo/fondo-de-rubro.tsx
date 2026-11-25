import type { CSSProperties } from "react";
import { TONOS, tonoDePlaca } from "@/lib/catalogo/placa";
import { cn } from "@/lib/utils";

/**
 * El fondo de la tarjeta de un rubro sin portada (comité final, M18).
 *
 * La misma regla que los productos sin foto (placa-de-producto.tsx): el tono
 * de madera del rubro y la veta, en vez de una foto de banco que muestra otra
 * cosa. Sin el rubro estampado: la tarjeta ya lo dice encima, sobre el velo.
 */
export function FondoDeRubro({ rubro, className }: { rubro: string; className?: string }) {
  const tono = TONOS[tonoDePlaca(rubro)];
  const estilo = {
    "--placa-fondo": tono.claro.fondo,
    "--placa-texto": tono.claro.texto,
    "--placa-fondo-oscuro": tono.oscuro.fondo,
    "--placa-texto-oscuro": tono.oscuro.texto,
  } as CSSProperties;
  return (
    <span
      aria-hidden
      data-fondo-de-rubro={rubro}
      style={estilo}
      className={cn("placa absolute inset-0", tono.veta && "placa-veta", className)}
    />
  );
}
