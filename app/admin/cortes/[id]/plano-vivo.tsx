"use client";

import { createContext, useContext, useState } from "react";
import type { PlanoDeCorte } from "@/lib/cortes/tipos";
import { sobraDelCliente } from "@/lib/cortes/de-quien";
import { formatearMonto } from "@/lib/formato";

/**
 * El plano que se está probando en el acomodo a mano, para las cifras de
 * arriba de la ficha: mientras se mueve una pieza, «retal mayor» y «Lo que
 * sobra» seguían diciendo lo del plano guardado, y para eso se mueve la pieza
 * (mes simulado, M2S2-138). Sin acomodo en curso, lo del servidor.
 */
type EnPrueba = { plano: PlanoDeCorte; pasadas: number };

const Contexto = createContext<{
  plano: PlanoDeCorte | null;
  pasadas: number | null;
  setPlano: (p: EnPrueba | null) => void;
} | null>(null);

export function PlanoVivo({ children }: { children: React.ReactNode }) {
  const [prueba, setPlano] = useState<EnPrueba | null>(null);
  return (
    <Contexto.Provider value={{ plano: prueba?.plano ?? null, pasadas: prueba?.pasadas ?? null, setPlano }}>
      {children}
    </Contexto.Provider>
  );
}

/**
 * Para el acomodo: publica el plano que dibuja y las pasadas que Go cobraría
 * al guardarlo (null, lo guardado). Las pasadas y la plata seguían en lo
 * guardado y cambiaban recién al recargar (M4-029: 12 pasadas y $ 14.400 al
 * girar la pieza, 8 y $ 9.600 después de guardar).
 */
export function usePublicarPlano() {
  return useContext(Contexto)?.setPlano;
}

/** Las pasadas a cobrar, con el acomodo que se está probando. */
export function PasadasVivas({ guardado }: { guardado: number }) {
  return <>{useContext(Contexto)?.pasadas ?? guardado}</>;
}

/** «pasada» o «pasadas», según las que se están probando. */
export function RotuloDePasadas({ guardado, aCobrar }: { guardado: number; aCobrar: boolean }) {
  const n = useContext(Contexto)?.pasadas ?? guardado;
  const palabra = n === 1 ? "pasada" : "pasadas";
  return <>{aCobrar ? `${palabra} a cobrar` : palabra}</>;
}

/**
 * Un importe de la cuenta con las pasadas que se están probando: el
 * guardado más la diferencia de pasadas a la tarifa.
 */
export function MontoVivo({ monto, pasadas, precioPorPasada }: { monto: number; pasadas: number; precioPorPasada: number }) {
  const vivas = useContext(Contexto)?.pasadas ?? pasadas;
  return <>{formatearMonto(monto + (vivas - pasadas) * precioPorPasada)}</>;
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
  placaDelCliente = false,
}: {
  placaDelCliente?: boolean;
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
                ({sobraDelCliente(placa.seVendeEntera || todasDelCliente, { sinCargo, placaDelCliente }) ? "del cliente" : "al stock"})
              </span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
