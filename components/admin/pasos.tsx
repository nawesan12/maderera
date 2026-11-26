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

  /*
   * En el teléfono no entran cinco nombres en una fila (a 375 px «En camino»
   * se partía en dos renglones y «Recibido Preparando Listo» quedaban
   * pegados): las barras van solas y debajo, entero, el paso en que está y
   * cuántos faltan. Desde `sm` vuelve cada nombre bajo su barra.
   */
  const actualTitulo = etapas[indiceActual]?.titulo;

  return (
    <div>
      <ol className="flex items-center gap-1" aria-label="Estado del recorrido">
        {etapas.map((etapa, i) => {
          const hecha = i < indiceActual;
          const activa = i === indiceActual;

          return (
            <li key={etapa.clave} className="flex min-w-0 flex-1 items-center gap-1" aria-current={activa ? "step" : undefined}>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
                  className={`flex items-center gap-1 text-sm leading-tight max-sm:sr-only ${
                    activa
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {hecha && <Check className="h-3.5 w-3.5 shrink-0 text-brand-orange" />}
                  {etapa.titulo}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
      {actualTitulo && (
        <p className="mt-2 flex items-baseline justify-between gap-3 text-base sm:hidden" aria-hidden="true">
          <span className="font-medium">{actualTitulo}</span>
          <span className="tabular text-sm text-muted-foreground">
            {indiceActual + 1} de {etapas.length}
          </span>
        </p>
      )}
    </div>
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
