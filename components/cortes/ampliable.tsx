"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * El dibujo de una placa que se toca para verlo a pantalla completa. En el
 * teléfono, vertical, la placa (que es apaisada) se gira para que ocupe todo
 * el alto: a 375 px el plano medía 120 px y sus medidas no se leían (mes
 * simulado, M2S2-105). En papel no cambia nada.
 */
export function Ampliable({
  etiqueta,
  proporcion,
  children,
}: {
  etiqueta: string;
  /** Ancho sobre alto del dibujo, para que entre entero en la pantalla. */
  proporcion: number;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);
  const [vertical, setVertical] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const consulta = window.matchMedia("(orientation: portrait)");
    const leer = () => setVertical(consulta.matches);
    leer();
    consulta.addEventListener("change", leer);
    const alEscape = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    window.addEventListener("keydown", alEscape);
    return () => {
      consulta.removeEventListener("change", leer);
      window.removeEventListener("keydown", alEscape);
    };
  }, [abierto]);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`Ver ${etiqueta} a pantalla completa`}
        style={{ display: "block", width: "100%", padding: 0, border: 0, background: "none", cursor: "zoom-in" }}
      >
        {children}
      </button>
      {abierto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={etiqueta}
          className="no-imprimir"
          onClick={() => setAbierto(false)}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "#fff", overflow: "hidden" }}
        >
          <div
            style={
              vertical
                ? {
                    position: "absolute",
                    top: 0,
                    left: "100vw",
                    width: "100dvh",
                    height: "100vw",
                    transform: "rotate(90deg)",
                    transformOrigin: "top left",
                    display: "flex",
                    alignItems: "center",
                    padding: 12,
                    boxSizing: "border-box",
                  }
                : { position: "absolute", inset: 0, display: "flex", alignItems: "center", padding: 12 }
            }
          >
            <div
              style={{
                margin: "0 auto",
                width: vertical
                  ? `min(100dvh - 24px, (100vw - 24px) * ${proporcion})`
                  : `min(100vw - 24px, (100dvh - 24px) * ${proporcion})`,
              }}
            >
              {children}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAbierto(false)}
            aria-label="Cerrar"
            style={{
              position: "absolute",
              top: 12,
              right: 12,
              width: 44,
              height: 44,
              borderRadius: 22,
              border: "1px solid #ccc",
              background: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X style={{ width: 22, height: 22 }} />
          </button>
        </div>
      )}
    </>
  );
}
