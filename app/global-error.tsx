"use client";

import { useEffect } from "react";

/**
 * El último recurso: falló el layout raíz.
 *
 * Reemplaza el documento entero —`html` y `body` incluidos—, así que no puede
 * usar nada del sistema de diseño: si lo que se rompió es el layout, las hojas
 * de estilo pueden no estar. Va con estilos en línea a propósito.
 *
 * En la práctica casi nunca se ve. Existe para que ese "casi nunca" no sea una
 * pantalla en blanco.
 */
export default function ErrorGlobal({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Error global:", error);
  }, [error]);

  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf7f2",
          color: "#26231f",
          padding: "24px",
          textAlign: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "28px", margin: 0 }}>Se nos rompió algo</h1>
          <p style={{ color: "#6b6660", marginTop: "8px" }}>
            Probá de nuevo en un momento.
          </p>
          <button
            onClick={reset}
            style={{
              marginTop: "24px",
              height: "48px",
              padding: "0 24px",
              border: 0,
              borderRadius: "10px",
              background: "#c2570f",
              color: "#fff",
              font: "inherit",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Probar de nuevo
          </button>
          {error.digest && (
            <p style={{ marginTop: "32px", fontSize: "12px", color: "#8a7f72" }}>
              Código: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
