"use client";

import { formatearMonto } from "@/lib/formato";
import { revisarChequeDePago, type MedioDeMostrador } from "@/lib/mostrador/importes";
import {
  MEDIOS,
  type ParteDePago,
  type ChequeEnPantalla,
  CHEQUE_VACIO,
  aChequeDePago,
  CUOTAS,
} from "./medios";

/**
 * Los datos de un cheque en el mostrador: banco, número y fecha de pago.
 *
 * El número es lo que pidió la clienta —«para que la gente sepa cuál cheque es
 * en el banco»—, y la fecha es lo que ordena la cartera. Se dice qué falta
 * mientras se tipea: «Cobrar» queda apagado hasta que el cheque esté completo.
 */
export function CamposDeCheque({
  valor,
  onCambio,
}: {
  valor: ChequeEnPantalla;
  onCambio: (c: ChequeEnPantalla) => void;
}) {
  const cambiar = (campo: keyof ChequeEnPantalla, v: string) => onCambio({ ...valor, [campo]: v });
  const problema =
    valor.numero || valor.banco || valor.fechaPago
      ? revisarChequeDePago(aChequeDePago(valor))
      : null;

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-linea p-3">
      <div className="flex rounded-lg border border-linea p-0.5 text-sm" role="group">
        {(
          [
            ["fisico", "Cheque en papel"],
            ["echeq", "e-Cheq"],
          ] as const
        ).map(([tipo, texto]) => (
          <button
            key={tipo}
            type="button"
            onClick={() => onCambio({ ...valor, tipo })}
            aria-pressed={valor.tipo === tipo}
            className={`h-9 flex-1 rounded-md font-medium transition-colors ${
              valor.tipo === tipo ? "bg-hundida" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {texto}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2">
        <input
          value={valor.banco}
          onChange={(e) => cambiar("banco", e.target.value)}
          placeholder="Banco"
          aria-label="Banco del cheque"
          className="h-11 min-w-0 rounded-lg border border-linea bg-background px-2.5 text-base"
        />
        <input
          value={valor.numero}
          onChange={(e) => cambiar("numero", e.target.value)}
          inputMode="numeric"
          placeholder="N° de cheque"
          aria-label="Número del cheque"
          className="tabular h-11 min-w-0 rounded-lg border border-linea bg-background px-2.5 text-base"
        />
        <input
          type="date"
          value={valor.fechaPago}
          onChange={(e) => cambiar("fechaPago", e.target.value)}
          aria-label="Fecha de pago del cheque"
          className="tabular h-11 min-w-0 rounded-lg border border-linea bg-background px-2.5 text-base"
        />
      </div>
      <input
        value={valor.librador}
        onChange={(e) => cambiar("librador", e.target.value)}
        placeholder="Librador, si no es el cliente"
        aria-label="Librador del cheque"
        className="h-11 w-full rounded-lg border border-linea bg-background px-2.5 text-base"
      />
      {problema && <p className="estado-espera text-sm font-medium">{problema}</p>}
    </div>
  );
}

/**
 * La tarjeta de un pago de un solo medio: la marca, el lote, el cupón y, en
 * crédito, las cuotas. Con el pago partido van por renglón, en `PagoPartido`.
 */
export function DatosDeTarjeta({
  medio,
  tarjeta,
  onTarjeta,
  total,
}: {
  medio: MedioDeMostrador;
  tarjeta: { nroLote: string; nroCupon: string; marca: string; cuotas: number };
  onTarjeta: (v: {
    nroLote: string;
    nroCupon: string;
    marca: string;
    cuotas: number;
  }) => void;
  total: number;
}) {
  return (
    <>
      {/* El lote y el cupón de la terminal, cuando se paga con tarjeta y el
          pago no está partido (partido, van por renglón). Son el dato fiscal
          que después pide el contador; se pueden dejar vacíos. */}

      {(medio === "debito" || medio === "credito") && (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <input
            value={tarjeta.marca}
            onChange={(e) => onTarjeta({ ...tarjeta, marca: e.target.value })}
            data-foco="tarjeta"
            placeholder="Tarjeta"
            className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
          />
          <input
            value={tarjeta.nroLote}
            onChange={(e) => onTarjeta({ ...tarjeta, nroLote: e.target.value })}
            inputMode="numeric"
            placeholder="Lote"
            className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
          />
          <input
            value={tarjeta.nroCupon}
            onChange={(e) => onTarjeta({ ...tarjeta, nroCupon: e.target.value })}
            inputMode="numeric"
            placeholder="Cupón"
            className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
          />
        </div>
      )}

      {/* Las cuotas, solo en crédito: en débito no existen.
          **No cambian lo que se cobra.** Las sin interés las financia el
          banco y la maderera cobra el total igual; esto se guarda para el
          comprobante y para conciliar después contra la liquidación de la
          terminal. Qué bancos tienen sin interés está en el panel de
          promociones, abajo. */}
      {medio === "credito" && (
        <label className="mt-2.5 flex items-center gap-2.5">
          <span className="text-base text-muted-foreground">En</span>
          <select
            value={tarjeta.cuotas}
            onChange={(e) =>
              onTarjeta({ ...tarjeta, cuotas: Number(e.target.value) })
            }
            className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
          >
            {CUOTAS.map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 pago" : `${n} cuotas`}
              </option>
            ))}
          </select>
          {tarjeta.cuotas > 1 && (
            <span className="text-base text-muted-foreground">
              de {formatearMonto(total / tarjeta.cuotas)} · el total no cambia
            </span>
          )}
        </label>
      )}
    </>
  );
}

/**
 * El pago partido: mitad efectivo, mitad débito es una venta de todos
 * los días. Cada renglón lleva su medio y su importe, y con tarjeta,
 * su lote y cupón. Ocupa el ancho entero del panel: es el momento de
 * cobrar y los renglones se tipean mirando la plata sobre el
 * mostrador.
 */
export function PagoPartido({
  partes,
  onPartes,
  restante,
}: {
  partes: ParteDePago[];
  onPartes: (v: ParteDePago[] | null) => void;
  /** Lo que falta repartir. Cero es "cierra". */
  restante: number;
}) {
  return (
    <div className="mt-4 space-y-2 rounded-xl border border-linea p-3">
      {partes.map((parte, i) => (
        <div key={i} className="space-y-1.5">
          <div className="flex gap-2">
            <select
              value={parte.medio}
              onChange={(e) =>
                onPartes(
                  partes.map((p, j) =>
                    j === i
                      ? { ...p, medio: e.target.value as MedioDeMostrador }
                      : p,
                  ),
                )
              }
              className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-background px-2 text-base"
            >
              {MEDIOS.map(({ valor, texto }) => (
                <option key={valor} value={valor}>
                  {texto}
                </option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="0.01"
              value={parte.importe}
              onChange={(e) =>
                onPartes(
                  partes.map((p, j) =>
                    j === i ? { ...p, importe: e.target.value } : p,
                  ),
                )
              }
              data-foco={i === 0 ? "parte" : undefined}
              placeholder="0"
              className="tabular h-11 w-28 rounded-lg border border-linea bg-background px-2.5 text-right text-base"
            />
            {partes.length > 2 && (
              <button
                type="button"
                onClick={() => onPartes(partes.filter((_, j) => j !== i))}
                className="h-11 shrink-0 rounded-lg border border-linea px-3 text-base font-medium text-muted-foreground hover:bg-hundida"
              >
                Sacar
              </button>
            )}
          </div>
          {(parte.medio === "debito" || parte.medio === "credito") && (
            <div className="grid grid-cols-4 gap-2">
              <input
                value={parte.tarjeta}
                onChange={(e) =>
                  onPartes(
                    partes.map((p, j) =>
                      j === i ? { ...p, tarjeta: e.target.value } : p,
                    ),
                  )
                }
                placeholder="Tarjeta"
                className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
              />
              <input
                value={parte.nroLote}
                onChange={(e) =>
                  onPartes(
                    partes.map((p, j) =>
                      j === i ? { ...p, nroLote: e.target.value } : p,
                    ),
                  )
                }
                inputMode="numeric"
                placeholder="Lote"
                className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
              />
              <input
                value={parte.nroCupon}
                onChange={(e) =>
                  onPartes(
                    partes.map((p, j) =>
                      j === i ? { ...p, nroCupon: e.target.value } : p,
                    ),
                  )
                }
                inputMode="numeric"
                placeholder="Cupón"
                className="tabular h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
              />
              {/* Las cuotas de este renglón, solo si es crédito. */}
              {parte.medio === "credito" ? (
                <select
                  value={parte.cuotas}
                  onChange={(e) =>
                    onPartes(
                      partes.map((p, j) =>
                        j === i
                          ? { ...p, cuotas: Number(e.target.value) }
                          : p,
                      ),
                    )
                  }
                  className="h-11 rounded-lg border border-linea bg-background px-2.5 text-base"
                >
                  {CUOTAS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1 pago" : `${n} cuotas`}
                    </option>
                  ))}
                </select>
              ) : (
                <span />
              )}
            </div>
          )}
          {parte.medio === "cheque" && (
            <CamposDeCheque
              valor={parte.cheque ?? CHEQUE_VACIO}
              onCambio={(c) =>
                onPartes(partes.map((p, k) => (k === i ? { ...p, cheque: c } : p)))
              }
            />
          )}
        </div>
      ))}

      <div className="flex items-center justify-between pt-1">
        <div className="flex gap-3">
          {partes.length < 4 && (
            <button
              type="button"
              onClick={() =>
                onPartes([
                  ...partes,
                  {
                    medio: "efectivo",
                    importe: "",
                    nroLote: "",
                    nroCupon: "",
                    tarjeta: "",
                    cuotas: 1,
                  },
                ])
              }
              className="inline-flex h-11 items-center rounded-lg border border-linea px-3.5 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
            >
              + Otro pago
            </button>
          )}
          <button
            type="button"
            onClick={() => onPartes(null)}
            className="inline-flex h-11 items-center rounded-lg border border-linea px-3.5 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
          >
            Un solo medio
          </button>
        </div>
        <span
          className={`tabular text-sm font-semibold ${
            Math.abs(restante) > 0.01
              ? "text-destructive"
              : "text-saldo-favor"
          }`}
        >
          {Math.abs(restante) > 0.01
            ? restante > 0
              ? `Faltan ${formatearMonto(restante)}`
              : `Sobran ${formatearMonto(-restante)}`
            : "Cierra justo"}
        </span>
      </div>
    </div>
  );
}
