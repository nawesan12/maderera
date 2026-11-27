"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { DatosParaTransferir } from "@/lib/dal/pagos";
import { cn } from "@/lib/utils";

/**
 * Los datos para transferir o depositar, con «Copiar» al lado del CBU, el
 * alias y el CUIT.
 *
 * Había tres copias de esta lista: la de «Pagar tu cuenta» no tenía con qué
 * copiar, la del pedido llevaba un ícono de 14 px que no se encontraba, y
 * las tres ponían el titular en monoespaciada (mes 23, M2S1-070). Los
 * números van en `.tabular`; los nombres, en la letra del texto.
 */
export function DatosBancarios({
  banco,
  className,
}: {
  banco: DatosParaTransferir;
  className?: string;
}) {
  const [copiado, setCopiado] = useState<string | null>(null);

  async function copiar(etiqueta: string, valor: string) {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(etiqueta);
      setTimeout(() => setCopiado((c) => (c === etiqueta ? null : c)), 2000);
    } catch {
      // Sin portapapeles el dato sigue a la vista para copiarlo a mano.
    }
  }

  const filas: [string, string, boolean][] = [
    ["Titular", banco.titular, false],
    ["Banco", banco.banco, false],
    ["CBU", banco.cbu, true],
    ["Alias", banco.alias, true],
    ["CUIT", banco.cuit, true],
  ];

  return (
    <dl className={cn("divide-y divide-linea rounded-lg bg-hundida px-3.5 text-sm", className)}>
      {filas
        .filter(([, valor]) => Boolean(valor))
        .map(([etiqueta, valor, copiable]) => (
          <div key={etiqueta} className="flex min-h-11 items-center gap-3 py-1.5">
            <dt className="w-16 shrink-0 text-muted-foreground">{etiqueta}</dt>
            <dd
              className={cn(
                "min-w-0 flex-1 font-medium [overflow-wrap:anywhere]",
                copiable && etiqueta !== "Alias" && "tabular",
              )}
            >
              {valor}
            </dd>
            {copiable && (
              <button
                type="button"
                onClick={() => copiar(etiqueta, valor)}
                aria-label={`Copiar ${etiqueta}`}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-linea bg-card px-3 text-sm font-medium"
              >
                {copiado === etiqueta ? (
                  <Check className="h-4 w-4 text-brand-green" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground" />
                )}
                <span aria-live="polite">{copiado === etiqueta ? "Copiado" : "Copiar"}</span>
              </button>
            )}
          </div>
        ))}
      {banco.instrucciones && (
        <p className="py-2.5 text-xs text-muted-foreground">{banco.instrucciones}</p>
      )}
    </dl>
  );
}
