"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileCheck2, Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import {
  pagarAProveedor,
  verAcumulado,
  verChequesEnCartera,
  verFacturasConSaldo,
  type EstadoPago,
} from "./actions";

interface Proveedor {
  id: string;
  nombre: string;
  cuit: string | null;
  saldo: number;
}

interface Regimen {
  id: string;
  codigo: string;
  nombre: string;
  impuesto: string;
  alicuota: number;
  minimoNoImponible: number;
}

interface FacturaConSaldo {
  id: string;
  numero: string;
  tipo: string;
  fechaEmision: Date | string | null;
  total: number;
  saldo: number;
}

interface ChequeDeCartera {
  id: string;
  numero: string;
  banco: string | null;
  fechaPago: Date | string;
  importe: number;
  cliente: string | null;
}

/** Un renglón de "con qué sale la plata". Los importes se tipean. */
interface ParteUI {
  medio: "transferencia" | "efectivo" | "cheque" | "echeq";
  importe: string;
  referencia: string;
  /** Vacío es "cheque nuevo"; un id es un cheque de la cartera que se endosa. */
  chequeId: string;
  numero: string;
  banco: string;
  fechaPago: string;
}

const parteVacia = (medio: ParteUI["medio"] = "transferencia"): ParteUI => ({
  medio,
  importe: "",
  referencia: "",
  chequeId: "",
  numero: "",
  banco: "",
  fechaPago: "",
});

/**
 * Pagarle a un proveedor.
 *
 * El proceso real: se eligen **las facturas que se están pagando**, se decide
 * **con qué sale la plata** —una transferencia, dos cheques a fecha, un
 * endoso— y las retenciones se calculan sobre eso. La pantalla sigue ese
 * orden. El importe que se carga es lo que se imputa a la deuda; lo que sale
 * del banco lo calcula el sistema restando las retenciones.
 */
export function FormularioPago({
  proveedores,
  regimenes,
  proveedorInicial,
  facturaInicial,
}: {
  proveedores: Proveedor[];
  regimenes: Regimen[];
  /**
   * Con quién arranca el formulario, cuando se llega desde una factura impaga.
   *
   * Sin esto el pago siempre empezaba en `proveedores[0]` —el primero de la
   * lista, alfabético, casi nunca el que se quiere pagar—. Se veía la factura
   * vencida en su pantalla, se apretaba Pagos, y había que volver a buscar el
   * proveedor a mano para que recién ahí aparecieran sus facturas abiertas.
   */
  proveedorInicial?: string;
  /** Qué factura viene a pagarse: se marca sola al cargar las del proveedor. */
  facturaInicial?: string;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPago>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(
    proveedorInicial ?? proveedores[0]?.id ?? "",
  );
  const [total, setTotal] = useState("");
  const [medio, setMedio] = useState("transferencia");
  const [circuito, setCircuito] = useState<"blanco" | "negro">("blanco");
  const [referencia, setReferencia] = useState("");
  const [bases, setBases] = useState<Record<string, string>>({});

  const [facturas, setFacturas] = useState<FacturaConSaldo[]>([]);
  const [imputado, setImputado] = useState<Record<string, string>>({});

  const [partes, setPartes] = useState<ParteUI[] | null>(null);
  const [cartera, setCartera] = useState<ChequeDeCartera[]>([]);

  const [acumulado, setAcumulado] = useState<
    Record<string, { base: number; retenido: number }>
  >({});

  useEffect(() => {
    if (!supplierId) return;

    let vivo = true;
    void verAcumulado(supplierId).then((filas) => {
      if (!vivo) return;
      setAcumulado(
        Object.fromEntries(
          filas.map((f) => [
            f.codigoRegimen,
            { base: Number(f.base), retenido: Number(f.retenido) },
          ]),
        ),
      );
    });
    // Las facturas abiertas del proveedor: es contra lo que se paga.
    void verFacturasConSaldo(supplierId).then((filas) => {
      if (!vivo) return;
      setFacturas(filas);
      /*
       * Si se llegó desde una factura, viene ya imputada por su saldo entero.
       * Es el caso normal —se paga lo que se debe— y deja el importe listo
       * para corregir si se paga una parte, en vez de obligar a tipearlo.
       */
      const objetivo = filas.find((f) => f.id === facturaInicial);
      setImputado(
        objetivo ? { [objetivo.id]: String(objetivo.saldo) } : {},
      );
      if (objetivo) setTotal(String(objetivo.saldo));
    });

    return () => {
      vivo = false;
    };
    // `facturaInicial` viene del URL y no cambia mientras la pantalla vive:
    // meterlo en las dependencias solo agregaría ruido a la lectura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  useEffect(() => {
    let vivo = true;
    void verChequesEnCartera().then((filas) => {
      if (vivo) setCartera(filas);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const proveedor = proveedores.find((p) => p.id === supplierId);
  const importe = Number(total || 0);
  const sumaImputada = Object.values(imputado).reduce(
    (s, v) => s + (Number(v) || 0),
    0,
  );
  const sumaPartes = (partes ?? []).reduce(
    (s, p) => s + (Number(p.importe) || 0),
    0,
  );
  const hayRetenciones = Object.values(bases).some((b) => Number(b) > 0);

  /** Reparte el total entre las facturas más viejas, como se paga de verdad. */
  function repartirEntreFacturas() {
    let resto = importe;
    const nuevo: Record<string, string> = {};
    for (const f of facturas) {
      if (resto <= 0) break;
      const cubre = Math.min(f.saldo, resto);
      nuevo[f.id] = cubre.toFixed(2);
      resto = Math.round((resto - cubre) * 100) / 100;
    }
    setImputado(nuevo);
  }

  function actualizarParte(i: number, cambios: Partial<ParteUI>) {
    setPartes((prev) =>
      prev ? prev.map((p, j) => (j === i ? { ...p, ...cambios } : p)) : prev,
    );
  }

  if (proveedores.length === 0) {
    return (
      <p className="tarjeta px-5 py-8 text-center text-base text-muted-foreground">
        No hay proveedores con saldo pendiente.
      </p>
    );
  }

  return (
    <section className="tarjeta space-y-4 p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-sm font-medium">Proveedor</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre} · debe {formatearMonto(p.saldo)}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Se le imputa</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
          />
          {proveedor && (
            <button
              type="button"
              onClick={() => setTotal(String(proveedor.saldo))}
              className="mt-1 text-sm text-muted-foreground underline"
            >
              Saldar todo: {formatearMonto(proveedor.saldo)}
            </button>
          )}
        </label>

        <label className="block">
          <span className="text-sm font-medium">Medio</span>
          <select
            value={medio}
            onChange={(e) => {
              const elegido = e.target.value;
              setMedio(elegido);
              // Un cheque necesita sus datos —número, banco, fecha de pago—,
              // así que elegirlo abre el detalle con un renglón ya armado.
              if ((elegido === "cheque" || elegido === "echeq") && !partes) {
                setPartes([
                  {
                    ...parteVacia(elegido as ParteUI["medio"]),
                    importe: total,
                  },
                ]);
              }
            }}
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          >
            <option value="transferencia">Transferencia</option>
            <option value="efectivo">Efectivo</option>
            <option value="cheque">Cheque</option>
            <option value="echeq">e-Cheq</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium">Referencia</span>
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="N.º de operación"
            className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
          />
        </label>

        {/* Por qué circuito sale el pago. Los cheques que se emitan en él lo
            heredan: salen con esa plata y por esa vía. */}
        <label className="block">
          <span className="text-sm font-medium">Circuito</span>
          <div
            className="mt-1 flex gap-1.5"
            role="group"
            aria-label="Circuito de facturación"
          >
            {(["blanco", "negro"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCircuito(c)}
                aria-pressed={circuito === c}
                className={`h-11 flex-1 rounded-lg text-base font-medium transition-colors ${
                  circuito === c
                    ? "boton-accion"
                    : "border border-linea text-muted-foreground hover:bg-hundida"
                }`}
              >
                {c === "blanco" ? "En blanco" : "En negro"}
              </button>
            ))}
          </div>
        </label>
      </div>

      {/* Qué facturas cubre. Es la relación pago↔factura que pidió la
          clienta: después, cada factura sabe si está paga entera o en parte. */}
      {facturas.length > 0 && (
        <div className="border-t border-linea pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Qué facturas paga
            </h3>
            {importe > 0 && (
              <button
                type="button"
                onClick={repartirEntreFacturas}
                className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Repartir {formatearMonto(importe)} entre las más viejas
              </button>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Opcional: sin elegir ninguna queda como pago a cuenta y se imputa
            después desde la factura.
          </p>

          <ul className="mt-3 space-y-2">
            {facturas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-3">
                <span className="tabular min-w-36 text-base font-medium">
                  {f.numero}
                </span>
                <span className="text-sm text-muted-foreground">
                  {f.saldo < f.total
                    ? `quedan ${formatearMonto(f.saldo)} de ${formatearMonto(f.total)}`
                    : formatearMonto(f.total)}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={imputado[f.id] ?? ""}
                  onChange={(e) =>
                    setImputado((prev) => ({ ...prev, [f.id]: e.target.value }))
                  }
                  placeholder="0"
                  className="tabular h-10 w-32 rounded-lg border border-linea bg-card px-3 text-right text-base"
                />
              </li>
            ))}
          </ul>

          {sumaImputada > 0 && (
            <p
              className={`mt-2 text-sm font-medium ${
                sumaImputada - importe > 0.01
                  ? "text-saldo-debe"
                  : "text-muted-foreground"
              }`}
            >
              Imputado: {formatearMonto(sumaImputada)} de{" "}
              {formatearMonto(importe)}
              {sumaImputada - importe > 0.01 && " — suma más que el pago"}
            </p>
          )}
        </div>
      )}

      {/* Con qué sale la plata: la transferencia más los cheques a fecha. Cada
          cheque queda en la cartera con su vencimiento. */}
      <div className="border-t border-linea pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Con qué sale
          </h3>
          {partes === null ? (
            <button
              type="button"
              onClick={() =>
                setPartes([
                  { ...parteVacia(medio as ParteUI["medio"]), importe: total },
                ])
              }
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Partir en varios medios o detallar cheques
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setPartes(null)}
              className="text-sm font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Un solo medio, sin detalle
            </button>
          )}
        </div>

        {partes === null ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Sale todo por {medio === "echeq" ? "e-Cheq" : medio}.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {partes.map((parte, i) => (
              <div
                key={i}
                className="space-y-2 rounded-lg border border-linea p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={parte.medio}
                    onChange={(e) =>
                      actualizarParte(i, {
                        medio: e.target.value as ParteUI["medio"],
                        chequeId: "",
                      })
                    }
                    className="h-10 rounded-lg border border-linea bg-card px-2 text-base"
                  >
                    <option value="transferencia">Transferencia</option>
                    <option value="efectivo">Efectivo</option>
                    <option value="cheque">Cheque</option>
                    <option value="echeq">e-Cheq</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={parte.importe}
                    onChange={(e) => actualizarParte(i, { importe: e.target.value })}
                    placeholder="Importe"
                    className="tabular h-10 w-32 rounded-lg border border-linea bg-card px-3 text-right text-base"
                  />
                  {parte.medio === "transferencia" && (
                    <input
                      value={parte.referencia}
                      onChange={(e) =>
                        actualizarParte(i, { referencia: e.target.value })
                      }
                      placeholder="N.º de operación"
                      className="h-10 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-base"
                    />
                  )}
                  {partes.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setPartes(partes.filter((_, j) => j !== i))
                      }
                      aria-label="Sacar este renglón"
                      className="h-10 w-9 rounded-lg border border-linea text-muted-foreground hover:bg-hundida"
                    >
                      ×
                    </button>
                  )}
                </div>

                {(parte.medio === "cheque" || parte.medio === "echeq") && (
                  <div className="space-y-2">
                    {cartera.length > 0 && parte.medio === "cheque" && (
                      <select
                        value={parte.chequeId}
                        onChange={(e) => {
                          const elegido = cartera.find(
                            (c) => c.id === e.target.value,
                          );
                          actualizarParte(i, {
                            chequeId: e.target.value,
                            // El importe del endoso es el del cheque: no se
                            // endosa medio cheque.
                            ...(elegido
                              ? { importe: String(elegido.importe) }
                              : {}),
                          });
                        }}
                        className="h-10 w-full rounded-lg border border-linea bg-card px-2 text-base"
                      >
                        <option value="">Cheque nuevo (propio)</option>
                        {cartera.map((c) => (
                          <option key={c.id} value={c.id}>
                            Endosar {c.numero}
                            {c.banco ? ` · ${c.banco}` : ""} ·{" "}
                            {formatearMonto(c.importe)}
                            {c.cliente ? ` · de ${c.cliente}` : ""}
                          </option>
                        ))}
                      </select>
                    )}

                    {!parte.chequeId && (
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          value={parte.numero}
                          onChange={(e) =>
                            actualizarParte(i, { numero: e.target.value })
                          }
                          placeholder="N.º de cheque"
                          className="tabular h-10 rounded-lg border border-linea bg-card px-2.5 text-base"
                        />
                        <input
                          value={parte.banco}
                          onChange={(e) =>
                            actualizarParte(i, { banco: e.target.value })
                          }
                          placeholder="Banco"
                          className="h-10 rounded-lg border border-linea bg-card px-2.5 text-base"
                        />
                        <label className="block">
                          <input
                            type="date"
                            value={parte.fechaPago}
                            onChange={(e) =>
                              actualizarParte(i, { fechaPago: e.target.value })
                            }
                            aria-label="Fecha de pago del cheque"
                            className="tabular h-10 w-full rounded-lg border border-linea bg-card px-2.5 text-base"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            <div className="flex flex-wrap items-center justify-between gap-2">
              {partes.length < 6 && (
                <button
                  type="button"
                  onClick={() => setPartes([...partes, parteVacia()])}
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                >
                  + Otro renglón
                </button>
              )}
              <p className="text-sm text-muted-foreground">
                Suman {formatearMonto(sumaPartes)}
                {hayRetenciones
                  ? " — tienen que dar lo que sale del banco, ya sin retenciones"
                  : importe > 0 && Math.abs(sumaPartes - importe) > 0.01
                    ? ` de ${formatearMonto(importe)}`
                    : ""}
              </p>
            </div>
          </div>
        )}
      </div>

      {regimenes.length > 0 && (
        <div className="border-t border-linea pt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Retenciones a practicar
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Poné la base de cada régimen. El sistema mira el acumulado del mes:
            puede no retener aunque cargues una base, si todavía no llega al
            mínimo.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {regimenes.map((r) => (
              <label key={r.id} className="block">
                <span className="text-sm font-medium">
                  {r.codigo} · {r.nombre}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {r.alicuota}%
                  {r.minimoNoImponible > 0 &&
                    ` · mínimo ${formatearMonto(r.minimoNoImponible)} en el mes`}
                </span>
                {acumulado[r.codigo] && (
                  <span className="block text-sm text-muted-foreground">
                    Este mes ya lleva{" "}
                    {formatearMonto(acumulado[r.codigo].base)} de base y{" "}
                    {formatearMonto(acumulado[r.codigo].retenido)} retenidos.
                  </span>
                )}
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bases[r.id] ?? ""}
                    onChange={(e) =>
                      setBases((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    placeholder="Base"
                    className="tabular h-11 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-right text-base"
                  />
                  {importe > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setBases((prev) => ({ ...prev, [r.id]: String(importe) }))
                      }
                      className="h-11 shrink-0 rounded-lg border border-linea px-3 text-sm"
                    >
                      Todo
                    </button>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {(estado.error || estado.ok) && (
        <p
          className={`text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}
        >
          {estado.error ?? estado.ok}
        </p>
      )}

      {estado.certificados && estado.certificados.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {estado.certificados.map((c) => (
            <li key={c.numero}>
              <a
                href={`/admin/compras/pagos/certificado/${c.numero}`}
                target="_blank"
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-linea px-3.5 text-sm font-medium hover:bg-hundida"
              >
                <FileCheck2 className="h-4 w-4" />
                {c.numero} · {formatearMonto(c.importe)}
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="flex justify-end border-t border-linea pt-4">
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await pagarAProveedor({
                supplierId,
                total: importe,
                medio: medio as "transferencia",
                circuito,
                referencia,
                retenciones: regimenes
                  .map((g) => ({
                    regimenId: g.id,
                    base: Number(bases[g.id] ?? 0),
                  }))
                  .filter((g) => g.base > 0),
                imputaciones: Object.entries(imputado)
                  .map(([purchaseInvoiceId, v]) => ({
                    purchaseInvoiceId,
                    importe: Number(v) || 0,
                  }))
                  .filter((x) => x.importe > 0),
                partes:
                  partes === null
                    ? undefined
                    : partes
                        .filter((p) => Number(p.importe) > 0)
                        .map((p) => ({
                          medio: p.medio,
                          importe: Number(p.importe),
                          referencia: p.referencia || null,
                          chequeId: p.chequeId || null,
                          cheque:
                            !p.chequeId &&
                            (p.medio === "cheque" || p.medio === "echeq")
                              ? {
                                  tipo:
                                    p.medio === "echeq"
                                      ? ("echeq" as const)
                                      : ("fisico" as const),
                                  numero: p.numero,
                                  banco: p.banco || null,
                                  fechaPago: new Date(`${p.fechaPago}T12:00:00`),
                                }
                              : null,
                        })),
              });
              setEstado(r);
              if (r.ok) {
                setTotal("");
                setReferencia("");
                setBases({});
                setImputado({});
                setPartes(null);
                router.refresh();
              }
            })
          }
          disabled={enCurso || importe <= 0 || sumaImputada - importe > 0.01}
          className="inline-flex h-12 items-center gap-2 rounded-xl bg-accion px-5 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          Registrar el pago
        </button>
      </div>
    </section>
  );
}
