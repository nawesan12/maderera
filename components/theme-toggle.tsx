"use client";

import { useSyncExternalStore } from "react";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Interruptor de modo oscuro.
 *
 * El tema vive en una sola parte —la clase `dark` del `<html>`— y este
 * componente la lee, no la duplica. La versión anterior guardaba un `useState`
 * y lo sincronizaba desde un efecto al montar, lo que traía dos problemas: un
 * `setState` sincrónico dentro de un efecto (que React 19 marca como error, y
 * encadena un render de más), y dos fuentes de verdad que se podían separar si
 * algo más tocaba la clase.
 *
 * `useSyncExternalStore` es exactamente la herramienta para esto: se suscribe
 * al DOM con un `MutationObserver` y devuelve el valor real en cada render. El
 * `getServerSnapshot` es lo que evita el error de hidratación: en el servidor
 * no hay DOM y el HTML se genera siempre en modo claro.
 */

function suscribir(alCambiar: () => void): () => void {
  const observador = new MutationObserver(alCambiar);

  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observador.disconnect();
}

function leerDelDom(): boolean {
  return document.documentElement.classList.contains("dark");
}

function leerEnElServidor(): boolean {
  return false;
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(suscribir, leerDelDom, leerEnElServidor);

  function alternar() {
    const siguiente = !dark;
    document.documentElement.classList.toggle("dark", siguiente);
    localStorage.setItem("theme", siguiente ? "dark" : "light");
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
      onClick={alternar}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      aria-pressed={dark}
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}
