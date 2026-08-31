"use client";

import { useActionState, useMemo, useState } from "react";
import { AlertCircle, Loader2, Send, X } from "lucide-react";
import { enviarPlantilla, type EstadoWhatsapp } from "./actions";
import { previsualizar } from "@/lib/whatsapp/plantillas-base";
import type { PlantillaAprobada } from "@/lib/whatsapp/tipos";

const estadoInicial: EstadoWhatsapp = {};

/**
 * Envío de una plantilla aprobada.
 *
 * Se muestra el texto final ya armado, con los datos puestos, antes de mandar.
 * Es la única forma de escribirle a alguien fuera de la ventana de 24 h, cada
 * envío se factura, y el texto no se puede corregir después: mandar a ciegas
 * "Hola {{1}}" es un error caro y visible para el cliente.
 *
 * Las variables vienen precargadas con lo que ya sabemos —el nombre, el número
 * de pedido, la sucursal— porque tipear eso a mano en cada mensaje es donde
 * aparecen los errores.
 */
export function CompositorPlantilla({
  conversacionId,
  nombre,
  plantillas,
  pedidoNumero,
  sucursal,
  onCerrar,
}: {
  conversacionId: string;
  nombre: string;
  plantillas: PlantillaAprobada[];
  pedidoNumero: string;
  sucursal: string;
  onCerrar: () => void;
}) {
  const [estado, accion, enviando] = useActionState(
    enviarPlantilla,
    estadoInicial,
  );

  const [elegida, setElegida] = useState(plantillas[0]?.nombre ?? "");
  const plantilla = plantillas.find((p) => p.nombre === elegida);

  // Lo que ya sabemos, en el orden en que las plantillas usan las variables:
  // primero el nombre, después el comprobante, después la sucursal.
  const sugeridos = useMemo(
    () => [nombre.split(/\s+/)[0] ?? "", pedidoNumero, sucursal],
    [nombre, pedidoNumero, sucursal],
  );

  const [valores, setValores] = useState<string[]>(sugeridos);

  function cambiar(indice: number, valor: string) {
    setValores((previos) => {
      const copia = [...previos];
      copia[indice] = valor;
      return copia;
    });
  }

  const cantidad = plantilla?.variables ?? 0;
  const usados = valores.slice(0, cantidad);
  const vistaPrevia = plantilla
    ? previsualizar(plantilla.cuerpo, usados)
    : "";
  const faltan = usados.some((v) => !v.trim());

  return (
    <form action={accion} className="border-t bg-muted/30 p-3">
      <input type="hidden" name="conversacionId" value={conversacionId} />
      <input type="hidden" name="plantilla" value={elegida} />
      <input
        type="hidden"
        name="idioma"
        value={plantilla?.idioma ?? "es_AR"}
      />
      {usados.map((valor, i) => (
        <input key={i} type="hidden" name="variable" value={valor} />
      ))}

      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">Mensaje preparado</h3>
        <button
          type="button"
          onClick={onCerrar}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Volver a escribir libremente"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {plantillas.length === 0 ? (
        <p className="estado-espera rounded-lg bg-[var(--estado-fondo)] px-3 py-2.5 text-base text-[var(--estado-tinta)]">
          No hay plantillas aprobadas todavía. Hay que cargarlas en Meta y
          esperar la aprobación.
        </p>
      ) : (
        <div className="space-y-2.5">
          <select
            value={elegida}
            onChange={(e) => setElegida(e.target.value)}
            className="h-10 w-full rounded-lg border bg-background px-2.5 text-base"
            aria-label="Elegir el mensaje preparado"
          >
            {plantillas.map((p) => (
              <option key={`${p.nombre}-${p.idioma}`} value={p.nombre}>
                {p.nombre.replace(/_/g, " ")}
              </option>
            ))}
          </select>

          {cantidad > 0 && (
            <div className="grid gap-2 sm:grid-cols-3">
              {Array.from({ length: cantidad }).map((_, i) => (
                <input
                  key={i}
                  value={valores[i] ?? ""}
                  onChange={(e) => cambiar(i, e.target.value)}
                  placeholder={`Dato ${i + 1}`}
                  maxLength={200}
                  className="h-10 rounded-lg border bg-background px-2.5 text-base"
                  aria-label={`Dato ${i + 1} del mensaje`}
                />
              ))}
            </div>
          )}

          <p className="rounded-lg bg-brand-green/10 px-3.5 py-2.5 text-base">
            {vistaPrevia}
          </p>

          {estado.error && (
            <p
              role="alert"
              className="estado-problema flex items-start gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base text-[var(--estado-tinta)]"
            >
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              {estado.error}
            </p>
          )}

          <button
            type="submit"
            disabled={enviando || faltan}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-green px-4 text-base font-medium text-white transition-colors hover:bg-brand-green/90 disabled:opacity-50"
          >
            {enviando ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Send className="h-5 w-5" />
            )}
            {faltan ? "Faltan datos" : "Enviar mensaje preparado"}
          </button>
        </div>
      )}
    </form>
  );
}
