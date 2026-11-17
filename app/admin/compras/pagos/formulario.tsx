"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRightLeft,
  Banknote,
  CalendarDays,
  FileCheck2,
  FileDigit,
  FileText,
  Landmark,
  Loader2,
  ReceiptText,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { diasHasta, fechaCorta, formatearMonto, hoyEnArgentina } from "@/lib/formato";
import { CIRCUITOS, ETIQUETA_CIRCUITO } from "@/lib/circuito";
import {
  BarraGuardar,
  Hoja,
  Interruptor,
  Opciones,
  Seccion,
} from "@/components/admin/formulario";
import { sucursalPropuesta } from "../sucursal-propuesta";
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
  saldo: number;
}

interface Regimen {
  id: string;
  /** El código («IIBB-MI»): no se muestra, el acumulado del mes viene por él. */
  codigo: string;
  nombre: string;
  impuesto: string;
  alicuota: number;
  minimoNoImponible: number;
}

interface Sucursal {
  id: string;
  nombre: string;
  turnoAbierto: string | null;
  deLaSesion: boolean;
}

interface FacturaConSaldo {
  id: string;
  numero: string;
  fechaEmision: Date | string;
  fechaVencimiento: Date | string | null;
  total: number;
  saldo: number;
  /** Neto gravado + no gravado/exento, sin IVA ni percepciones. */
  netoSinIva: number;
}

interface ChequeDeCartera {
  id: string;
  numero: string;
  banco: string | null;
  fechaPago: Date | string;
  importe: number;
  /** Físico o e-Cheq: al endosar hay que ofrecer el que corresponde. */
  tipo: string;
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

const MEDIOS = [
  { valor: "transferencia", texto: "Transferencia", icono: ArrowRightLeft },
  { valor: "efectivo", texto: "Efectivo", icono: Banknote },
  { valor: "cheque", texto: "Cheque", icono: FileText },
  { valor: "echeq", texto: "e-Cheq", icono: FileDigit },
];

const OPCIONES_CIRCUITO = CIRCUITOS.map((c) => ({
  valor: c,
  texto: ETIQUETA_CIRCUITO[c],
}));

const parteVacia = (medio: ParteUI["medio"] = "transferencia"): ParteUI => ({
  medio,
  importe: "",
  referencia: "",
  chequeId: "",
  numero: "",
  banco: "",
  fechaPago: "",
});

const redondear = (n: number) => Math.round(n * 100) / 100;
const fecha = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);

/**
 * Pagarle a un proveedor.
 *
 * **El gesto es «estoy pagando estas facturas».** Antes la pantalla pedía el
 * proveedor (venía puesto el primero de la lista), un «Se le imputa» a mano
 * y recién después mostraba las facturas, sin fecha ni vencimiento. Ahora: se
 * elige el proveedor (ninguno de entrada), se ven sus facturas pendientes por
 * vencimiento y se tildan. El total sale de lo tildado; tocarlo reparte entre
 * las tildadas de la que vence antes a la que vence después (un pago
 * parcial), y lo que pase de lo tildado queda a cuenta.
 *
 * **La base de la retención sale de las facturas elegidas.** Para Ganancias e
 * IIBB es el neto de IVA de lo que se paga, en proporción a cuánto se paga de
 * cada factura. Antes se escribía a mano, y un total con IVA retenía de más.
 * Solo un pago a cuenta, sin facturas, la pide escrita.
 *
 * **El efectivo sale de una caja**, como un gasto: se elige la sucursal (se
 * propone la del turno abierto por quien carga) y Go lo descuenta del turno.
 *
 * Con qué sale la plata —una transferencia, dos cheques a fecha, un endoso—
 * sigue igual: el importe que se carga es lo que baja la deuda; lo que sale
 * del banco lo calcula Go restando las retenciones.
 */
export function FormularioPago({
  proveedores,
  regimenes,
  sucursales,
  proveedorInicial,
  facturaInicial,
}: {
  proveedores: Proveedor[];
  regimenes: Regimen[];
  sucursales: Sucursal[];
  /** Con quién arranca, cuando se llega desde una factura o la ficha del proveedor. */
  proveedorInicial?: string;
  /** Qué factura viene a pagarse: se tilda sola al cargar las del proveedor. */
  facturaInicial?: string;
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoPago>({});
  const [enCurso, empezar] = useTransition();

  const [supplierId, setSupplierId] = useState(
    proveedores.some((p) => p.id === proveedorInicial) ? proveedorInicial! : "",
  );
  const [fechaPago, setFechaPago] = useState(hoyEnArgentina);
  const [medio, setMedio] = useState("transferencia");
  const [circuito, setCircuito] = useState<"blanco" | "negro">("blanco");
  const [referencia, setReferencia] = useState("");
  const [branchId, setBranchId] = useState(() => sucursalPropuesta(sucursales));

  const [facturas, setFacturas] = useState<FacturaConSaldo[]>([]);
  /** Las tildadas, con cuánto se paga de cada una. */
  const [aplicado, setAplicado] = useState<Record<string, string>>({});
  /** null: el total es la suma de lo tildado. Si se escribe, manda. */
  const [totalTocado, setTotalTocado] = useState<string | null>(null);

  const [retener, setRetener] = useState<Record<string, boolean>>({});
  const [basesAMano, setBasesAMano] = useState<Record<string, string>>({});

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
    void verFacturasConSaldo(supplierId).then((filas) => {
      if (!vivo) return;
      setFacturas(filas);
      // Si se llegó desde una factura, viene tildada por su saldo entero.
      const objetivo = filas.find((f) => f.id === facturaInicial);
      setAplicado(objetivo ? { [objetivo.id]: String(objetivo.saldo) } : {});
      setTotalTocado(null);
    });
    return () => {
      vivo = false;
    };
    // `facturaInicial` viene del URL y no cambia mientras la pantalla vive.
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

  const tildadas = facturas.filter((f) => f.id in aplicado);
  const sumaAplicada = redondear(
    tildadas.reduce((s, f) => s + (Number(aplicado[f.id]) || 0), 0),
  );
  const total = totalTocado === null ? sumaAplicada : Number(totalTocado) || 0;
  const aCuenta = redondear(total - sumaAplicada);
  const sumaPartes = redondear(
    (partes ?? []).reduce((s, p) => s + (Number(p.importe) || 0), 0),
  );

  /*
   * La base de las retenciones: el neto de IVA de lo que se paga de cada
   * factura tildada (pagar la mitad de una factura es pagar la mitad de su
   * neto). Sin facturas, a mano.
   */
  const baseDeLasFacturas = redondear(
    tildadas.reduce((s, f) => {
      const pagado = Number(aplicado[f.id]) || 0;
      return f.total > 0 ? s + (pagado * f.netoSinIva) / f.total : s;
    }, 0),
  );
  const conFacturas = tildadas.length > 0;
  const baseDe = (r: Regimen) =>
    conFacturas ? baseDeLasFacturas : Number(basesAMano[r.id]) || 0;
  const retenciones = regimenes
    .filter((r) => retener[r.id])
    .map((r) => ({ regimenId: r.id, base: baseDe(r) }))
    .filter((r) => r.base > 0);
  const basePasada = retenciones.some((r) => r.base - total > 0.009);

  const hayEfectivo =
    partes === null
      ? medio === "efectivo"
      : partes.some((p) => p.medio === "efectivo" && Number(p.importe) > 0);
  const sucursal = sucursales.find((s) => s.id === branchId);

  /** Tilda o destilda una factura; tildada, se paga entera. */
  function tildar(f: FacturaConSaldo, si: boolean) {
    setTotalTocado(null);
    setAplicado((prev) => {
      const nuevo = { ...prev };
      if (si) nuevo[f.id] = String(f.saldo);
      else delete nuevo[f.id];
      return nuevo;
    });
  }

  /**
   * Escribir el total reparte entre las tildadas, de la que vence antes a la
   * que vence después, como se paga de verdad; lo que sobra queda a cuenta.
   */
  function escribirTotal(valor: string) {
    setTotalTocado(valor);
    if (tildadas.length === 0) return;
    let resto = Number(valor) || 0;
    const nuevo: Record<string, string> = {};
    for (const f of tildadas) {
      const cubre = Math.max(0, Math.min(f.saldo, resto));
      nuevo[f.id] = cubre.toFixed(2);
      resto = redondear(resto - cubre);
    }
    setAplicado(nuevo);
  }

  function actualizarParte(i: number, cambios: Partial<ParteUI>) {
    setPartes((prev) =>
      prev ? prev.map((p, j) => (j === i ? { ...p, ...cambios } : p)) : prev,
    );
  }

  function elegirProveedor(id: string) {
    setSupplierId(id);
    setFacturas([]);
    setAplicado({});
    setTotalTocado(null);
    setBasesAMano({});
    setEstado({});
  }

  return (
    <div className="space-y-4">
      <Hoja>
        <Seccion titulo="Proveedor" icono={Truck}>
          <label className="block md:col-span-2">
            <span className="text-base font-medium">A quién se le paga</span>
            <select
              value={supplierId}
              onChange={(e) => elegirProveedor(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            >
              <option value="" disabled>
                Elegí el proveedor
              </option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.saldo > 0.005 ? ` · se le deben ${formatearMonto(p.saldo)}` : ""}
                </option>
              ))}
            </select>
          </label>
        </Seccion>

        {supplierId && (
          <Seccion titulo="Qué facturas se pagan" icono={ReceiptText} columnas={1}>
            {facturas.length === 0 ? (
              <p className="text-base text-muted-foreground">No tiene facturas pendientes</p>
            ) : (
              <ul className="space-y-2">
                {facturas.map((f) => {
                  const tildada = f.id in aplicado;
                  const vence = f.fechaVencimiento ? fecha(f.fechaVencimiento) : null;
                  const dias = diasHasta(vence);
                  return (
                    <li
                      key={f.id}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 ${
                        tildada ? "tarjeta-hundida" : ""
                      }`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={tildada}
                          onChange={(e) => tildar(f, e.target.checked)}
                          className="h-5 w-5 shrink-0 accent-[var(--accion)]"
                        />
                        <span className="min-w-0">
                          <span className="tabular block text-base font-medium">{f.numero}</span>
                          <span className="block text-sm text-muted-foreground">
                            del {fechaCorta.format(fecha(f.fechaEmision))}
                            {vence && (
                              <span className={dias !== null && dias < 0 ? "font-semibold text-saldo-debe" : undefined}>
                                {" · "}
                                {dias !== null && dias < 0 ? "venció" : "vence"} el {fechaCorta.format(vence)}
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                      <span className="tabular text-base text-muted-foreground">
                        {f.saldo < f.total
                          ? `quedan ${formatearMonto(f.saldo)} de ${formatearMonto(f.total)}`
                          : formatearMonto(f.saldo)}
                      </span>
                      {tildada && (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          max={f.saldo}
                          value={aplicado[f.id]}
                          aria-label={`Cuánto se paga de la ${f.numero}`}
                          onChange={(e) => {
                            setTotalTocado(null);
                            setAplicado((prev) => ({ ...prev, [f.id]: e.target.value }));
                          }}
                          className="tabular h-11 w-36 rounded-lg border border-linea bg-card px-3 text-right text-base"
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="grid gap-5 md:grid-cols-2">
              <label className="block">
                <span className="text-base font-medium">Total del pago</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={totalTocado ?? (sumaAplicada ? sumaAplicada.toFixed(2) : "")}
                  onChange={(e) => escribirTotal(e.target.value)}
                  className="tabular mt-1 h-12 w-full rounded-lg border border-linea bg-card px-3 text-right text-xl font-semibold"
                />
                {aCuenta > 0.009 && (
                  <span className="mt-1 block text-base text-muted-foreground">
                    {formatearMonto(aCuenta)} a cuenta
                  </span>
                )}
              </label>
              <label className="block">
                <span className="text-base font-medium">Fecha del pago</span>
                <span className="relative mt-1 block">
                  <CalendarDays className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="date"
                    value={fechaPago}
                    max={hoyEnArgentina()}
                    onChange={(e) => setFechaPago(e.target.value)}
                    className="tabular h-12 w-full rounded-lg border border-linea bg-card pl-10 pr-3 text-base"
                  />
                </span>
              </label>
            </div>
          </Seccion>
        )}

        {supplierId && (
          <Seccion titulo="Con qué sale" icono={Wallet}>
            <div className="space-y-1 md:col-span-2">
              <span className="text-base font-medium">Forma de pago</span>
              <Opciones
                nombre="pago-medio"
                /* El e-Cheq solo en el circuito de facturas: es electrónico y
                 queda a nombre de la empresa en el banco, así que por el otro
                 circuito cruzaría las dos cajas. El servidor lo rechaza igual. */
                opciones={MEDIOS.filter((m) => m.valor !== "echeq" || circuito !== "negro")}
                valor={medio}
                alCambiar={(elegido) => {
                  setMedio(elegido);
                  // Un cheque necesita sus datos, así que abre el detalle.
                  if ((elegido === "cheque" || elegido === "echeq") && !partes) {
                    setPartes([{ ...parteVacia(elegido as ParteUI["medio"]), importe: total ? String(total) : "" }]);
                  }
                }}
              />
            </div>

            {/* Por qué circuito sale el pago. Los cheques que se emitan en él lo
              heredan: salen con esa plata y por esa vía. */}
            <div className="space-y-1">
              <span className="text-base font-medium">Circuito</span>
              <Opciones
                nombre="pago-circuito"
                opciones={OPCIONES_CIRCUITO}
                valor={circuito}
                columnas={2}
                alCambiar={(v) => {
                  const c = v as "blanco" | "negro";
                  setCircuito(c);
                  // Pasar al circuito B saca los e-Cheq antes de guardar, no al rechazo.
                  if (c === "negro") {
                    if (medio === "echeq") setMedio("cheque");
                    setPartes((previas) =>
                      previas
                        ? previas.map((p) => (p.medio === "echeq" ? { ...p, medio: "cheque", chequeId: "" } : p))
                        : previas,
                    );
                  }
                }}
              />
            </div>

            <label className="block">
              <span className="text-base font-medium">Referencia</span>
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="N.º de operación"
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              />
            </label>

            {partes !== null && (
              <div className="space-y-3 md:col-span-2">
                {partes.map((parte, i) => (
                  <div key={i} className="tarjeta-hundida space-y-2 rounded-xl p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={parte.medio}
                        onChange={(e) =>
                          actualizarParte(i, { medio: e.target.value as ParteUI["medio"], chequeId: "" })
                        }
                        aria-label="Medio"
                        className="h-11 rounded-lg border border-linea bg-card px-2 text-base"
                      >
                        <option value="transferencia">Transferencia</option>
                        <option value="efectivo">Efectivo</option>
                        <option value="cheque">Cheque</option>
                        {circuito !== "negro" && <option value="echeq">e-Cheq</option>}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={parte.importe}
                        onChange={(e) => actualizarParte(i, { importe: e.target.value })}
                        placeholder="Importe"
                        aria-label="Importe"
                        className="tabular h-11 w-36 rounded-lg border border-linea bg-card px-3 text-right text-base"
                      />
                      {parte.medio === "transferencia" && (
                        <input
                          value={parte.referencia}
                          onChange={(e) => actualizarParte(i, { referencia: e.target.value })}
                          placeholder="N.º de operación"
                          className="h-11 min-w-0 flex-1 rounded-lg border border-linea bg-card px-3 text-base"
                        />
                      )}
                      {partes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPartes(partes.filter((_, j) => j !== i))}
                          aria-label="Sacar este renglón"
                          className="tarjeta h-11 w-11 rounded-lg text-lg text-muted-foreground"
                        >
                          ×
                        </button>
                      )}
                    </div>

                    {(parte.medio === "cheque" || parte.medio === "echeq") && (
                      <div className="space-y-2">
                        {/* Endosar uno de la cartera, del mismo tipo: un e-Cheq
                          recibido no se endosa como cheque de papel. */}
                        {chequesParaEndosar(cartera, parte.medio).length > 0 && (
                          <select
                            value={parte.chequeId}
                            onChange={(e) => {
                              const elegido = cartera.find((c) => c.id === e.target.value);
                              actualizarParte(i, {
                                chequeId: e.target.value,
                                // El importe del endoso es el del cheque: no se endosa medio cheque.
                                ...(elegido ? { importe: String(elegido.importe) } : {}),
                              });
                            }}
                            aria-label="Cheque"
                            className="h-11 w-full rounded-lg border border-linea bg-card px-2 text-base"
                          >
                            <option value="">Cheque nuevo (propio)</option>
                            {chequesParaEndosar(cartera, parte.medio).map((c) => (
                              <option key={c.id} value={c.id}>
                                Endosar {c.numero}
                                {c.banco ? ` · ${c.banco}` : ""} · {formatearMonto(c.importe)}
                                {c.cliente ? ` · de ${c.cliente}` : ""}
                              </option>
                            ))}
                          </select>
                        )}

                        {!parte.chequeId && (
                          <div className="grid grid-cols-3 gap-2">
                            <input
                              value={parte.numero}
                              onChange={(e) => actualizarParte(i, { numero: e.target.value })}
                              placeholder="N.º de cheque"
                              className="tabular h-11 rounded-lg border border-linea bg-card px-2.5 text-base"
                            />
                            <input
                              value={parte.banco}
                              onChange={(e) => actualizarParte(i, { banco: e.target.value })}
                              placeholder="Banco"
                              className="h-11 rounded-lg border border-linea bg-card px-2.5 text-base"
                            />
                            <input
                              type="date"
                              value={parte.fechaPago}
                              onChange={(e) => actualizarParte(i, { fechaPago: e.target.value })}
                              aria-label="Fecha de pago del cheque"
                              className="tabular h-11 w-full rounded-lg border border-linea bg-card px-2.5 text-base"
                            />
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
                      className="tarjeta-hundida h-11 rounded-xl px-4 text-base font-medium"
                    >
                      + Otro renglón
                    </button>
                  )}
                  <p className="tabular text-base text-muted-foreground">Suman {formatearMonto(sumaPartes)}</p>
                </div>
              </div>
            )}

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() =>
                  setPartes(
                    partes === null
                      ? [{ ...parteVacia(medio as ParteUI["medio"]), importe: total ? String(total) : "" }]
                      : null,
                  )
                }
                className="tarjeta-hundida h-11 rounded-xl px-4 text-base font-medium"
              >
                {partes === null ? "Partir en varios medios o detallar cheques" : "Un solo medio"}
              </button>
            </div>

            {hayEfectivo && (
              <div className="space-y-1 md:col-span-2">
                <span className="text-base font-medium">De qué caja sale el efectivo</span>
                <Opciones
                  nombre="pago-caja"
                  opciones={sucursales.map((s) => ({
                    valor: s.id,
                    texto: s.turnoAbierto ? s.nombre : `${s.nombre} · sin turno abierto`,
                    icono: Store,
                  }))}
                  valor={branchId}
                  alCambiar={setBranchId}
                  columnas={sucursales.length >= 3 ? 3 : 2}
                />
                {sucursal && !sucursal.turnoAbierto && (
                  <span className="block text-base text-saldo-debe">
                    Sin turno abierto: el efectivo no va a salir de ninguna caja
                  </span>
                )}
              </div>
            )}
          </Seccion>
        )}

        {supplierId && regimenes.length > 0 && (
          <Seccion titulo="Retenciones" icono={Landmark} columnas={1}>
            <div className="grid gap-4 md:grid-cols-2">
              {regimenes.map((r) => {
                const mes = acumulado[r.codigo];
                return (
                  <div key={r.id} className="space-y-2">
                    <Interruptor
                      etiqueta={`${r.nombre} · ${r.alicuota.toLocaleString("es-AR")}%`}
                      icono={Landmark}
                      marcado={Boolean(retener[r.id])}
                      alCambiar={(v) => setRetener((prev) => ({ ...prev, [r.id]: v }))}
                    />
                    {retener[r.id] &&
                      (conFacturas ? (
                        <p className="tabular px-1 text-base">
                          Base: <strong>{formatearMonto(baseDeLasFacturas)}</strong>
                          <span className="text-muted-foreground"> · neto de las facturas elegidas</span>
                        </p>
                      ) : (
                        <label className="block">
                          <span className="text-base font-medium">Base</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={basesAMano[r.id] ?? ""}
                            onChange={(e) => setBasesAMano((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
                          />
                        </label>
                      ))}
                    {retener[r.id] && mes && (
                      <p className="tabular px-1 text-sm text-muted-foreground">
                        Este mes: {formatearMonto(mes.base)} de base, {formatearMonto(mes.retenido)} retenidos
                      </p>
                    )}
                    {retener[r.id] && baseDe(r) - total > 0.009 && (
                      <p className="px-1 text-base text-saldo-debe">La base no puede ser mayor al pago</p>
                    )}
                  </div>
                );
              })}
            </div>
          </Seccion>
        )}
      </Hoja>

      {(estado.ok || estado.aviso || (estado.certificados?.length ?? 0) > 0) && (
        <div className="tarjeta space-y-3 p-5">
          {estado.ok && <p className="text-base font-medium text-saldo-favor">{estado.ok}</p>}
          {estado.aviso && <p className="text-base text-saldo-debe">{estado.aviso}</p>}
          <div className="flex flex-wrap gap-2">
            {estado.id && (
              <>
                <Link
                  href={`/admin/compras/pagos/${estado.id}`}
                  className="tarjeta-hundida inline-flex h-11 items-center rounded-xl px-4 text-base font-medium"
                >
                  Ver el pago
                </Link>
                <a
                  href={`/admin/compras/pagos/${estado.id}/orden`}
                  target="_blank"
                  className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
                >
                  <FileText className="h-4 w-4" />
                  Orden de pago
                </a>
              </>
            )}
            {estado.certificados?.map((c) => (
              <a
                key={c.numero}
                href={`/admin/compras/pagos/certificado/${c.numero}`}
                target="_blank"
                className="tarjeta-hundida inline-flex h-11 items-center gap-1.5 rounded-xl px-4 text-base font-medium"
              >
                <FileCheck2 className="h-4 w-4" />
                {c.numero} · {formatearMonto(c.importe)}
              </a>
            ))}
          </div>
        </div>
      )}

      <BarraGuardar error={estado.error}>
        <button
          type="button"
          onClick={() =>
            empezar(async () => {
              const r = await pagarAProveedor({
                supplierId,
                total,
                fecha: fechaPago,
                branchId: hayEfectivo && branchId ? branchId : undefined,
                medio: medio as "transferencia",
                circuito,
                referencia,
                retenciones,
                imputaciones: tildadas
                  .map((f) => ({ purchaseInvoiceId: f.id, importe: Number(aplicado[f.id]) || 0 }))
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
                            !p.chequeId && (p.medio === "cheque" || p.medio === "echeq")
                              ? {
                                  tipo: p.medio === "echeq" ? ("echeq" as const) : ("fisico" as const),
                                  numero: p.numero,
                                  banco: p.banco || null,
                                  fechaPago: new Date(`${p.fechaPago}T12:00:00`),
                                }
                              : null,
                        })),
              });
              setEstado(r);
              if (r.ok) {
                setAplicado({});
                setTotalTocado(null);
                setReferencia("");
                setRetener({});
                setBasesAMano({});
                setPartes(null);
                router.refresh();
                void verFacturasConSaldo(supplierId).then(setFacturas);
              }
            })
          }
          disabled={enCurso || !supplierId || total <= 0 || aCuenta < -0.01 || basePasada}
          className="boton-accion inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          {total > 0 ? `Pagar ${formatearMonto(total)}` : "Pagar"}
        </button>
      </BarraGuardar>
    </div>
  );
}

/**
 * Los cheques de cartera que se pueden endosar en un renglón: del mismo tipo
 * que el medio elegido. Un e-Cheq recibido no se puede entregar como cheque de
 * papel ni al revés: son dos instrumentos distintos.
 */
function chequesParaEndosar(
  cartera: ChequeDeCartera[],
  medio: ParteUI["medio"],
): ChequeDeCartera[] {
  if (medio !== "cheque" && medio !== "echeq") return [];
  const buscado = medio === "echeq" ? "echeq" : "fisico";
  return cartera.filter((c) => c.tipo === buscado);
}
