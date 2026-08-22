import { Check } from "lucide-react";

/**
 * Recorrido de un pedido o un corte.
 *
 * Muestra las etapas que ya pasó, en cuál está y las que faltan. Un estado
 * suelto ("Preparando") dice dónde está pero no cuánto falta; el recorrido
 * completo se lee de un vistazo y es lo que se le contesta al cliente cuando
 * llama a preguntar.
 */
export function Pasos({
  etapas,
  actual,
  cancelado = false,
}: {
  etapas: { clave: string; titulo: string }[];
  actual: string;
  cancelado?: boolean;
}) {
  const indiceActual = etapas.findIndex((e) => e.clave === actual);

  if (cancelado) {
    return (
      <p className="rounded-lg bg-muted px-3 py-2.5 text-base text-muted-foreground">
        Este pedido se canceló.
      </p>
    );
  }

  return (
    <ol className="flex items-center gap-1" aria-label="Estado del recorrido">
      {etapas.map((etapa, i) => {
        const hecha = i < indiceActual;
        const activa = i === indiceActual;

        return (
          <li key={etapa.clave} className="flex flex-1 items-center gap-1">
            <div className="flex flex-1 flex-col gap-1.5">
              <span
                className={`h-1.5 rounded-full ${
                  hecha
                    ? "bg-brand-orange/40"
                    : activa
                      ? "bg-brand-orange"
                      : "bg-border"
                }`}
              />
              <span
                className={`flex items-center gap-1 text-sm ${
                  activa
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {hecha && <Check className="h-3.5 w-3.5 text-brand-orange" />}
                {etapa.titulo}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const ETAPAS_PEDIDO = [
  { clave: "pendiente", titulo: "Recibido" },
  { clave: "preparando", titulo: "Preparando" },
  { clave: "listo", titulo: "Listo" },
  { clave: "en-camino", titulo: "En camino" },
  { clave: "entregado", titulo: "Entregado" },
];

/** Un pedido de retiro no pasa por "en camino": el cliente lo busca. */
export const ETAPAS_RETIRO = [
  { clave: "pendiente", titulo: "Recibido" },
  { clave: "preparando", titulo: "Preparando" },
  { clave: "listo", titulo: "Listo para retirar" },
  { clave: "entregado", titulo: "Retirado" },
];

export const ETAPAS_CORTE = [
  { clave: "en-cola", titulo: "En cola" },
  { clave: "en-proceso", titulo: "En la máquina" },
  { clave: "terminado", titulo: "Terminado" },
  { clave: "retirado", titulo: "Retirado" },
];

export const ETAPAS_PRESUPUESTO = [
  { clave: "pendiente", titulo: "Recibido" },
  { clave: "revision", titulo: "En revisión" },
  { clave: "enviado", titulo: "Enviado" },
  { clave: "aceptado", titulo: "Aceptado" },
];
