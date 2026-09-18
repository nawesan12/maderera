"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown, Landmark } from "lucide-react";
import type { PromoVigente } from "@/lib/dal/contenido";

/**
 * Las promociones bancarias, en el mostrador.
 *
 * **Están para decirlas, no para descontarlas.** Un reintegro de MODO o del
 * Hipotecario lo paga el banco: el cliente abona el total y el banco se lo
 * devuelve después. Si alguien lo descontara acá, la maderera pondría de su
 * bolsillo una plata que iba a poner otro, y sobre una venta de placas eso es
 * mucho.
 *
 * Por eso cada renglón dice **quién pone el descuento**, y el panel entero
 * aclara que no toca el total. Lo que sí se descuenta solo —el 10 % de contado
 * y transferencia— vive en `payment_discounts` y ya se aplica al elegir el
 * medio: no está acá para que no haya dos listas de descuentos.
 *
 * Va plegado porque el mostrador se usa de pie y con gente esperando: se abre
 * cuando el cliente pregunta "¿qué promociones tienen?".
 */
export function PromosDelBanco({ promos }: { promos: PromoVigente[] }) {
  const [abierto, setAbierto] = useState(false);

  if (promos.length === 0) return null;

  return (
    <section className="rounded-xl border border-linea bg-card">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
      >
        <Landmark className="h-5 w-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-base font-medium">
          Promociones vigentes
          <span className="ml-2 font-normal text-muted-foreground">
            {promos.length}
          </span>
        </span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
            abierto ? "rotate-180" : ""
          }`}
        />
      </button>

      {abierto && (
        <div className="border-t border-linea px-4 py-3">
          <p className="mb-3 text-base text-muted-foreground">
            Son para contarle al cliente.{" "}
            <strong className="text-foreground">
              Ninguna se descuenta acá
            </strong>
            : el descuento por contado o transferencia se aplica solo al elegir
            el medio de pago.
          </p>

          <ul className="space-y-2.5">
            {promos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                {/* El logo, si lo cargaron: acá el vendedor lo busca de un
                    vistazo mientras el cliente le dice con qué tarjeta paga. */}
                {p.imagenUrl && (
                  <Image
                    src={p.imagenUrl}
                    alt=""
                    width={72}
                    height={24}
                    className="h-6 w-auto max-w-[72px] self-center object-contain"
                  />
                )}
                <span className="text-base font-medium">{p.medio}</span>
                <span className="text-base">{p.titulo}</span>
                {p.dias && (
                  <span className="text-sm text-muted-foreground">
                    · {p.dias}
                  </span>
                )}
                {p.vigenciaHasta && (
                  <span className="text-sm text-muted-foreground">
                    · hasta el {p.vigenciaHasta}
                  </span>
                )}
                <span
                  className={`inline-flex items-center rounded-full bg-[var(--estado-fondo)] px-2 py-0.5 text-sm font-medium text-[var(--estado-tinta)] ${
                    p.quienPaga === "banco" ? "estado-info" : "estado-espera"
                  }`}
                >
                  {p.quienPaga === "banco"
                    ? "la paga el banco"
                    : "la pone la maderera"}
                </span>
                {p.detalle && (
                  <span className="w-full text-sm text-muted-foreground">
                    {p.detalle}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
