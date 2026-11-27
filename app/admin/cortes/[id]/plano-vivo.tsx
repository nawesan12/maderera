"use client";

import { createContext, useContext, useState } from "react";
import type { PlanoDeCorte } from "@/lib/cortes/tipos";
import { sobraDelCliente } from "@/lib/cortes/de-quien";

/**
 * El plano que se está probando en el acomodo a mano, para las cifras de
 * arriba de la ficha: mientras se mueve una pieza, «retal mayor» y «Lo que
 * sobra» seguían diciendo lo del plano guardado, y para eso se mueve la pieza
 * (mes simulado, M2S2-138). Sin acomodo en curso, lo del servidor.
 */
const Contexto = createContext<{
  plano: PlanoDeCorte | null;
  setPlano: (p: PlanoDeCorte | null) => void;
} | null>(null);

export function PlanoVivo({ children }: { children: React.ReactNode }) {
  const [plano, setPlano] = useState<PlanoDeCorte | null>(null);
  return <Contexto.Provider value={{ plano, setPlano }}>{children}</Contexto.Provider>;
}

/** Para el acomodo: publica el plano que dibuja (null, el guardado). */
export function usePublicarPlano() {
  return useContext(Contexto)?.setPlano;
}

function usePlanoVivo(guardado: PlanoDeCorte): PlanoDeCorte {
  return useContext(Contexto)?.plano ?? guardado;
}

/** La cifra del retal mayor, con el plano que se está probando. */
export function RetalMayorVivo({ guardado, ancha }: { guardado: PlanoDeCorte; ancha?: boolean }) {
  const plano = usePlanoVivo(guardado);
  return (
    <div className={`bg-card px-5 py-3.5 ${ancha ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className="tabular text-2xl font-bold leading-none">
        {plano.recorteMayor ? `${plano.recorteMayor.ancho}×${plano.recorteMayor.alto}` : "—"}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        {plano.recorteMayor ? "retal mayor, en mm" : "sin retal útil"}
      </p>
    </div>
  );
}

/** «Lo que sobra», placa por placa, con el plano que se está probando. */
export function SobrantesVivos({
  guardado,
  media,
  sinCargo,
  todasDelCliente,
}: {
  guardado: PlanoDeCorte;
  media: boolean;
  sinCargo: boolean;
  /** El pedido vende todas las placas: lo que sobra es del cliente. */
  todasDelCliente: boolean;
}) {
  const plano = usePlanoVivo(guardado);
  return (
    <ul className="mt-2 space-y-1.5">
      {plano.placas.map((placa) => (
        <li key={placa.numero} className="text-base">
          <span className="text-muted-foreground">
            {media ? "Media" : "Placa"} {placa.numero}:
          </span>{" "}
          {placa.recortes.length === 0 ? (
            <span className="text-muted-foreground">sin pedazos enteros que valga guardar</span>
          ) : (
            <>
              {placa.recortes.map((r) => `${r.ancho} × ${r.alto} mm`).join(" · ")}{" "}
              <span className="text-muted-foreground">
                ({sobraDelCliente(placa.seVendeEntera || todasDelCliente, { sinCargo }) ? "del cliente" : "al stock"})
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
