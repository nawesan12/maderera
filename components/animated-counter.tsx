"use client";

import { useEffect, useRef } from "react";
import { useInView, useReducedMotion } from "framer-motion";
import { moneda } from "@/lib/formato";

function escribir(valor: number, formato?: "moneda", suffix = "") {
  const n = Math.round(valor);
  return (formato === "moneda" ? moneda.format(n) : String(n)) + suffix;
}

/**
 * Número que cuenta desde cero al entrar en pantalla.
 *
 * **El servidor renderiza el valor final, no el cero.** La animación se monta
 * encima después: si el componente arrancara en cero, ese cero sería lo que
 * queda en el HTML, y lo vería cualquiera que tenga el JavaScript desactivado,
 * una conexión lenta o un lector que no ejecuta scripts. Un panel que dice
 * "$ 0" de ventas no es una animación a medio empezar: es un dato falso.
 *
 * Por eso la cuenta se escribe directo en el nodo con `requestAnimationFrame`
 * en vez de pasar por estado de React: así no hay un render con el valor en
 * cero en ninguna parte del ciclo.
 *
 * Con `prefers-reduced-motion` no anima: el valor ya está puesto y se queda.
 * Para algunas personas el movimiento marea, y un número que salta es de lo
 * peor.
 */
export function AnimatedCounter({
  target,
  suffix = "",
  duration = 1.5,
  formato,
}: {
  target: number;
  suffix?: string;
  duration?: number;
  /** Cómo se escribe el número. Por omisión, entero. */
  formato?: "moneda";
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-50px" });
  const sinMovimiento = useReducedMotion();

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo || !isInView || sinMovimiento) return;

    let vivo = true;
    const inicio = performance.now();

    const animar = (ahora: number) => {
      if (!vivo) return;
      const avance = Math.min((ahora - inicio) / (duration * 1000), 1);
      const suavizado = 1 - Math.pow(1 - avance, 3);
      nodo.textContent = escribir(suavizado * target, formato, suffix);
      if (avance < 1) requestAnimationFrame(animar);
    };
    requestAnimationFrame(animar);

    return () => {
      vivo = false;
      // Si el componente se va a mitad de la cuenta, queda el número real.
      nodo.textContent = escribir(target, formato, suffix);
    };
  }, [isInView, target, duration, sinMovimiento, formato, suffix]);

  return <span ref={ref}>{escribir(target, formato, suffix)}</span>;
}
