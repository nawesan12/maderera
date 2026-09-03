"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { leer } from "@/lib/mostrador/offline/db";
import type { DocumentoTicket } from "@/lib/mostrador/ticket";
import { TicketImpreso } from "@/components/impresion/ticket";

/**
 * El ticket de una venta que todavía vive en esta máquina.
 *
 * La ruta es fija con la clave en la query —y no `/ticket/[clave]`— para que el
 * ayudante la pueda guardar de antemano: una ruta dinámica no se puede
 * precachear, y sin eso el papel no se imprime justo el día que no hay
 * internet.
 *
 * Lee de IndexedDB y no del servidor, por lo mismo.
 */
export default function TicketLocalPage() {
  const parametros = useSearchParams();
  const clave = parametros.get("clave");

  const [documento, setDocumento] = useState<DocumentoTicket | null>(null);
  const [buscado, setBuscado] = useState(false);

  useEffect(() => {
    let vivo = true;

    // Sin clave no hay nada que buscar, pero el estado se marca fuera del
    // pulso del efecto: escribirlo acá dispara un render en cascada.
    if (!clave) {
      void Promise.resolve().then(() => {
        if (vivo) setBuscado(true);
      });
      return () => {
        vivo = false;
      };
    }

    void leer<{ clave: string; documento: DocumentoTicket }>("tickets", clave)
      .then((fila) => {
        if (!vivo) return;
        setDocumento(fila?.documento ?? null);
        setBuscado(true);
      })
      .catch(() => {
        if (vivo) setBuscado(true);
      });

    return () => {
      vivo = false;
    };
  }, [clave]);

  // Imprimir apenas está dibujado: se llega acá desde el botón "imprimir".
  useEffect(() => {
    if (documento) {
      const t = setTimeout(() => window.print(), 300);
      return () => clearTimeout(t);
    }
  }, [documento]);

  if (!buscado) return null;

  if (!documento) {
    return (
      <div className="comprobante-hoja">
        <div className="hoja">
          <p className="leyenda">
            No encontré ese ticket en esta máquina. Los tickets de ventas hechas
            sin conexión se guardan en la computadora donde se cobraron.
          </p>
        </div>
      </div>
    );
  }

  return <TicketImpreso documento={documento} />;
}
