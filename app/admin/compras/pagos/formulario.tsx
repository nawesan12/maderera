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
import {
  diasHasta,
  fechaCorta,
  formatearMonto,
  hoyEnArgentina,
  importeDelCampo,
  importeParaElCampo,
  importeIlegible,
} from "@/lib/formato";
import { CIRCUITOS } from "@/lib/circuito";
import { useEtiquetasDelCircuito } from "@/components/admin/circuito";
import { type ChequeDeCartera, chequesParaEndosar, sinEndososDelOtroCircuito } from "./endoso";
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
  simularRetenciones,
  verAcumulado,
  verChequesEnCartera,
  verFacturasConSaldo,
  type EstadoPago,
  type RetencionSimulada,
} from "./actions";
import { CampoFecha } from "@/components/ui/campo-fecha";

interface Proveedor {
  id: string;
  nombre: string;
  saldo: number;
  condicionIva: string;
  condicionGanancias: string | null;
  exentoGananciasHasta: string | null;
}

/**
 * Si el régimen le corresponde al proveedor: la misma regla que Go
 * (compras.SujetoARetencion), para no ofrecer lo que después se rechaza.
 * Ganancias sin condición cargada se ofrece igual: el rechazo dice qué
 * cargar.
 */
function leCorresponde(r: Regimen, p: Proveedor | undefined, hoy: string): boolean {
  if (!p) return true;
  if (r.impuesto === "iva") return p.condicionIva === "responsable_inscripto";
  if (r.impuesto === "ganancias") {
    if (p.condicionIva === "monotributista") return false;
    if (p.condicionGanancias === "exento" && p.exentoGananciasHasta && hoy <= p.exentoGananciasHasta) return false;
  }
  return true;
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
  /**
   * El tipo del comprobante. Además de las facturas vienen las notas de
   * crédito a favor (restan: se aplican a una factura del pago) y los
   * cheques que le dimos y rebotaron («cheque_rechazado»: se reponen).
   */
  tipo: string;
  fechaEmision: Date | string;
  fechaVencimiento: Date | string | null;
  total: number;
  saldo: number;
  /** Neto gravado + no gravado/exento, sin IVA ni percepciones. */
  netoSinIva: number;
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
  /**
   * El renglón único que abre «Partir»: su importe sigue al neto hasta que
   * alguien lo toca. Si se partía antes de que llegara la simulación de la
   * retención, arrancaba en el bruto y quedaba ahí (mes 23).
   */
  auto?: boolean;
}

const MEDIOS = [
  { valor: "transferencia", texto: "Transferencia", icono: ArrowRightLeft },
  { valor: "efectivo", texto: "Efectivo", icono: Banknote },
  { valor: "cheque", texto: "Cheque", icono: FileText },
  { valor: "echeq", texto: "e-Cheq", icono: FileDigit },
];

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
  chequeInicial,
  ivaSobreTotal = false,
}: {
  proveedores: Proveedor[];
  regimenes: Regimen[];
  sucursales: Sucursal[];
  /** La regla base_retencion_iva: la de IVA sobre el total con IVA. */
  ivaSobreTotal?: boolean;
  /** Con quién arranca, cuando se llega desde una factura o la ficha del proveedor. */
  proveedorInicial?: string;
  /** Qué factura viene a pagarse: se tilda sola al cargar las del proveedor. */
  facturaInicial?: string;
  /** El cheque rechazado que viene a reponerse, igual que una factura. */
  chequeInicial?: string;
}) {
  const etiquetasCircuito = useEtiquetasDelCircuito();
  const opcionesCircuito = CIRCUITOS.map((c) => ({ valor: c, texto: etiquetasCircuito[c] }));
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
  /**
   * De qué proveedor son las facturas cargadas. Mientras no son del elegido,
   * se están trayendo: mostraba «No tiene facturas pendientes» medio segundo
   * antes de que llegaran (mes 23).
   */
  const [facturasDe, setFacturasDe] = useState<string | null>(null);
  /** Las tildadas, con cuánto se paga de cada una. */
  const [aplicado, setAplicado] = useState<Record<string, string>>({});
  /** null: el total es la suma de lo tildado. Si se escribe, manda. */
  const [totalTocado, setTotalTocado] = useState<string | null>(null);

  const [retener, setRetener] = useState<Record<string, boolean>>({});
  const [basesAMano, setBasesAMano] = useState<Record<string, string>>({});

  const [partesGuardadas, setPartes] = useState<ParteUI[] | null>(null);
  const [cartera, setCartera] = useState<ChequeDeCartera[]>([]);

  /** La cuenta de cada retención prendida, como la va a hacer el certificado. */
  const [simuladas, setSimuladas] = useState<Record<string, RetencionSimulada>>({});
  /** El renglón del cheque al que le falta la fecha, para marcarlo. */
  const [sinFecha, setSinFecha] = useState<number | null>(null);

  useEffect(() => {
    if (!supplierId) return;
    let vivo = true;
    // El acumulado del mes lo trae la simulación (con el cálculo entero);
    // acá solo decide qué interruptores arrancan prendidos.
    void verAcumulado(supplierId).then((filas) => {
      if (!vivo) return;
      // Si el proveedor ya tuvo base este mes en un régimen, el interruptor
      // arranca prendido: un pago con los dos apagados no retenía y el
      // acumulado quedaba mal para el siguiente (M2S2-013).
      const conBase = new Set(filas.filter((f) => Number(f.base) > 0).map((f) => f.codigoRegimen));
      setRetener((prev) => ({
        ...Object.fromEntries(regimenes.filter((r) => conBase.has(r.codigo)).map((r) => [r.id, true])),
        ...prev,
      }));
    });
    void verFacturasConSaldo(supplierId).then((filas) => {
      if (!vivo) return;
      setFacturas(filas);
      setFacturasDe(supplierId);
      // Si se llegó desde una factura, viene tildada por su saldo entero.
      const objetivo = filas.find((f) => f.id === facturaInicial || f.id === chequeInicial);
      setAplicado(objetivo ? { [objetivo.id]: importeParaElCampo(objetivo.saldo) } : {});
      // El total que ya se escribió no se borra: si las facturas tardaban en
      // llegar, el importe tipeado desaparecía y «Pagar» quedaba apagado sin
      // decir por qué. Cambiar de proveedor ya lo limpia (`elegirProveedor`).
      if (objetivo) setTotalTocado(null);
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

  const esNota = (f: FacturaConSaldo) => f.tipo.startsWith("nota_credito");
  const esCheque = (f: FacturaConSaldo) => f.tipo === "cheque_rechazado";
  // Un ajuste que subió la deuda (un saldo inicial): se paga como una factura.
  const esAjuste = (f: FacturaConSaldo) => f.tipo === "ajuste";
  // Lo que se paga (facturas y cheques a reponer) y las notas que restan.
  const tildadas = facturas.filter((f) => f.id in aplicado && !esNota(f));
  const notas = facturas.filter((f) => f.id in aplicado && esNota(f));
  const sumaNotas = redondear(notas.reduce((s, f) => s + f.saldo, 0));
  /*
   * Cada nota se aplica a la primera factura tildada a la que le entra (la
   * misma regla que Go): lo que se imputa de esa factura baja en lo que la
   * nota cubre. Una nota que no entra en ninguna queda marcada.
   */
  const imputado: Record<string, number> = Object.fromEntries(
    tildadas.map((f) => [f.id, importeDelCampo(aplicado[f.id])]),
  );
  const notasSinLugar: string[] = [];
  for (const nota of notas) {
    const destino = tildadas.find((f) => !esCheque(f) && !esAjuste(f) && imputado[f.id] - nota.saldo > -0.009);
    if (destino) imputado[destino.id] = redondear(imputado[destino.id] - nota.saldo);
    else notasSinLugar.push(nota.id);
  }
  const sumaAplicada = redondear(
    tildadas.reduce((s, f) => s + importeDelCampo(aplicado[f.id]), 0) - sumaNotas,
  );
  const total = totalTocado === null ? sumaAplicada : importeDelCampo(totalTocado);
  const aCuenta = redondear(total - sumaAplicada);

  /*
   * La base de las retenciones: el neto de IVA de lo que se paga de cada
   * factura tildada (pagar la mitad de una factura es pagar la mitad de su
   * neto). Sin facturas, a mano.
   */
  const baseDeLasFacturas = redondear(
    tildadas.reduce((s, f) => {
      const pagado = importeDelCampo(aplicado[f.id]);
      return f.total > 0 ? s + (pagado * f.netoSinIva) / f.total : s;
    }, 0),
  );
  const conFacturas = tildadas.some((f) => !esCheque(f) && !esAjuste(f));
  // Con la regla base_retencion_iva en «total», la de IVA va sobre lo que se
  // paga de las facturas con su IVA (M3S2-027).
  const totalDeLasFacturas = redondear(
    tildadas.filter((f) => !esCheque(f) && !esAjuste(f)).reduce((s, f) => s + (imputado[f.id] ?? 0), 0),
  );
  const baseDe = (r: Regimen) =>
    conFacturas
      ? r.impuesto === "iva" && ivaSobreTotal
        ? totalDeLasFacturas
        : baseDeLasFacturas
      : importeDelCampo(basesAMano[r.id]);
  const proveedor = proveedores.find((p) => p.id === supplierId);
  const hoy = hoyEnArgentina();
  const regimenesDelProveedor = regimenes.filter((r) => leCorresponde(r, proveedor, hoy));
  const retenciones = regimenesDelProveedor
    .filter((r) => retener[r.id])
    .map((r) => ({ regimenId: r.id, base: baseDe(r) }))
    .filter((r) => r.base > 0);
  const basePasada = retenciones.some((r) => r.base - total > 0.009);
  // Lo que sale de verdad: el total menos lo que se retiene. El botón dice
  // esto y no el total (M2S1-026): quien transfería el número del botón le
  // pagaba de más al proveedor.
  const retenido = redondear(
    retenciones.reduce((s, r) => s + (simuladas[r.regimenId]?.retencion ?? 0), 0),
  );
  const neto = redondear(total - retenido);
  const partes =
    partesGuardadas &&
    partesGuardadas.map((p) => (p.auto ? { ...p, importe: neto ? importeParaElCampo(neto) : "" } : p));
  const sumaPartes = redondear(
    (partes ?? []).reduce((s, p) => s + importeDelCampo(p.importe), 0),
  );
  const faltanPartes = redondear(neto - sumaPartes);
  const claveSimulacion = JSON.stringify([supplierId, fechaPago, retenciones]);

  useEffect(() => {
    const pedidas = JSON.parse(claveSimulacion)[2] as { regimenId: string; base: number }[];
    // Sin retenciones prendidas no hay nada que pedir: lo simulado de antes
    // no cuenta (el retenido suma solo las prendidas).
    if (pedidas.length === 0) return;
    let vivo = true;
    const t = setTimeout(() => {
      void simularRetenciones(supplierId, fechaPago, pedidas).then((filas) => {
        if (vivo) setSimuladas(Object.fromEntries(filas.map((f) => [f.regimenId, f])));
      });
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
    // claveSimulacion resume proveedor, fecha y retenciones pedidas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveSimulacion]);

  const hayEfectivo =
    partes === null
      ? medio === "efectivo"
      : partes.some((p) => p.medio === "efectivo" && importeDelCampo(p.importe) > 0);
  const sucursal = sucursales.find((s) => s.id === branchId);

  /** Tilda o destilda una factura; tildada, se paga entera (la nota resta entera). */
  function tildar(f: FacturaConSaldo, si: boolean) {
    setTotalTocado(null);
    setAplicado((prev) => {
      const nuevo = { ...prev };
      if (si) nuevo[f.id] = importeParaElCampo(f.saldo);
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
    // Lo que se escribe es lo que sale: las notas tildadas se suman a lo
    // que cubren las facturas.
    let resto = redondear(importeDelCampo(valor) + sumaNotas);
    const nuevo: Record<string, string> = {};
    for (const f of tildadas) {
      const cubre = Math.max(0, Math.min(f.saldo, resto));
      nuevo[f.id] = importeParaElCampo(cubre);
      resto = redondear(resto - cubre);
    }
    setAplicado({ ...nuevo, ...Object.fromEntries(notas.map((n) => [n.id, aplicado[n.id]])) });
  }

  function actualizarParte(i: number, cambios: Partial<ParteUI>) {
    setPartes((prev) =>
      prev ? prev.map((p, j) => (j === i ? { ...p, ...cambios, ...("importe" in cambios ? { auto: false } : {}) } : p)) : prev,
    );
  }

  function elegirProveedor(id: string) {
    setSupplierId(id);
    setFacturas([]);
    setAplicado({});
    setTotalTocado(null);
    setBasesAMano({});
    // Los regímenes tildados eran del proveedor anterior.
    setRetener({});
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
            {facturasDe !== supplierId ? (
              <div aria-busy="true" className="space-y-2">
                <div className="h-16 animate-pulse rounded-xl bg-hundida" />
                <div className="h-16 animate-pulse rounded-xl bg-hundida" />
              </div>
            ) : facturas.length === 0 ? (
              <p className="text-base text-muted-foreground">No tiene facturas pendientes</p>
            ) : (
              <ul className="space-y-2">
                {facturas.map((f) => {
                  const tildada = f.id in aplicado;
                  const vence = f.fechaVencimiento ? fecha(f.fechaVencimiento) : null;
                  const dias = diasHasta(vence);
                  const nota = esNota(f);
                  const sinLugar = notasSinLugar.includes(f.id);
                  return (
                    <li
                      key={f.id}
                      data-sin-lugar={sinLugar || undefined}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl px-4 py-3 ${
                        tildada ? "tarjeta-hundida" : ""
                      } ${sinLugar ? "ring-2 ring-saldo-debe" : ""}`}
                    >
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input
                          type="checkbox"
                          checked={tildada}
                          onChange={(e) => tildar(f, e.target.checked)}
                          className="h-5 w-5 shrink-0 accent-[var(--accion)]"
                        />
                        <span className="min-w-0">
                          <span className="tabular block text-base font-medium">
                            {nota ? `Nota de crédito ${f.numero}` : f.numero}
                          </span>
                          <span className="block text-sm text-muted-foreground">
                            {esCheque(f) ? (
                              <span className="font-semibold text-saldo-debe">Rechazado</span>
                            ) : (
                              <>del {fechaCorta.format(fecha(f.fechaEmision))}</>
                            )}
                            {vence && dias === 0 ? (
                              <span className="font-semibold text-brand-orange-dark"> · vence hoy</span>
                            ) : vence && (
                              <span className={dias !== null && dias < 0 ? "font-semibold text-saldo-debe" : undefined}>
                                {" · "}
                                {dias !== null && dias < 0 ? "venció" : "vence"} el {fechaCorta.format(vence)}
                              </span>
                            )}
                          </span>
                        </span>
                      </label>
                      <span className={`tabular text-base ${nota ? "font-medium text-saldo-favor" : "text-muted-foreground"}`}>
                        {nota
                          ? `−${formatearMonto(f.saldo)}`
                          : f.saldo < f.total
                            ? `quedan ${formatearMonto(f.saldo)} de ${formatearMonto(f.total)}`
                            : formatearMonto(f.saldo)}
                      </span>
                      {tildada && !nota && (
                        <input
                          type="text"
                          inputMode="decimal"
                          value={aplicado[f.id]}
                          aria-invalid={importeIlegible(aplicado[f.id]) || undefined}
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
                  type="text"
                  inputMode="decimal"
                  value={totalTocado ?? (sumaAplicada ? importeParaElCampo(sumaAplicada) : "")}
                  aria-invalid={importeIlegible(totalTocado) || undefined}
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
                  <CampoFecha
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
            {partes === null && (
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
                    setPartes([{ ...parteVacia(elegido as ParteUI["medio"]), auto: true }]);
                  }
                }}
              />
            </div>
            )}

            {/* Por qué circuito sale el pago. Los cheques que se emitan en él lo
              heredan: salen con esa plata y por esa vía. */}
            <div className="space-y-1">
              <span className="text-base font-medium">Circuito</span>
              <Opciones
                nombre="pago-circuito"
                opciones={opcionesCircuito}
                valor={circuito}
                columnas={2}
                alCambiar={(v) => {
                  const c = v as "blanco" | "negro";
                  setCircuito(c);
                  // Los endosos de un cheque del otro circuito vuelven a «cheque
                  // nuevo» antes de guardar, no al rechazo.
                  setPartes((previas) => (previas ? sinEndososDelOtroCircuito(previas, cartera, c) : previas));
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

            {partes === null && (
              <label className="block">
                <span className="text-base font-medium">Referencia</span>
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  placeholder="N.º de operación"
                  className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
                />
              </label>
            )}

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
                        type="text"
                        inputMode="decimal"
                        value={parte.importe}
                        aria-invalid={importeIlegible(parte.importe) || undefined}
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
                          aria-label="Referencia de la transferencia"
                          // Con un mínimo baja a su renglón: a 375 quedaba en
                          // 50 px al lado del importe y cortaba «V3-TRF».
                          className="h-11 min-w-[12rem] flex-1 rounded-lg border border-linea bg-card px-3 text-base"
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
                      <div className="space-y-2" data-sin-fecha={sinFecha === i || undefined}>
                        {/* Endosar uno de la cartera, del mismo tipo y del
                          circuito del pago. Los del otro circuito se ven
                          apagados bajo el nombre de su circuito: así se ve por
                          qué no se pueden elegir. */}
                        {(() => {
                          const { endosables, delOtroCircuito, esperanCae } = chequesParaEndosar(cartera, parte.medio, circuito);
                          if (endosables.length + delOtroCircuito.length + esperanCae.length === 0) return null;
                          const elegido = cartera.find((c) => c.id === parte.chequeId);
                          return (
                          <>
                          <select
                            value={parte.chequeId}
                            onChange={(e) => {
                              const elegido = cartera.find((c) => c.id === e.target.value);
                              actualizarParte(i, {
                                chequeId: e.target.value,
                                // El importe del endoso es el del cheque: no se endosa medio cheque.
                                ...(elegido ? { importe: importeParaElCampo(elegido.importe) } : {}),
                              });
                            }}
                            aria-label="Cheque"
                            className="h-11 w-full rounded-lg border border-linea bg-card px-2 text-base"
                          >
                            <option value="">Cheque nuevo (propio)</option>
                            {endosables.map((c) => (
                              <option key={c.id} value={c.id}>
                                {textoDelEndoso(c)}
                              </option>
                            ))}
                            {delOtroCircuito.length > 0 && (
                              <optgroup label={etiquetasCircuito[circuito === "negro" ? "blanco" : "negro"]}>
                                {delOtroCircuito.map((c) => (
                                  <option key={c.id} value={c.id} disabled>
                                    {textoDelEndoso(c)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {esperanCae.length > 0 && (
                              <optgroup label="Espera CAE">
                                {esperanCae.map((c) => (
                                  <option key={c.id} value={c.id} disabled>
                                    {textoDelEndoso(c)}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          {/* El elegido entero: en el teléfono el selector se
                              corta y dos cheques con el mismo número se veían
                              iguales (M2S3-015). */}
                          {elegido && (
                            <p className="tabular px-1 text-base">
                              <span className="font-semibold">{formatearMonto(elegido.importe)}</span>
                              <span className="text-muted-foreground">
                                {" · "}N.º {elegido.numero}
                                {elegido.banco ? ` · ${elegido.banco}` : ""}
                                {elegido.cliente ? ` · de ${elegido.cliente}` : ""}
                              </span>
                            </p>
                          )}
                          </>
                          );
                        })()}

                        {!parte.chequeId && (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1.4fr_1fr]">
                            <label className="block">
                              <span className="text-sm text-muted-foreground">N.º</span>
                              <input
                                value={parte.numero}
                                onChange={(e) => actualizarParte(i, { numero: e.target.value })}
                                className="tabular mt-0.5 h-11 w-full rounded-lg border border-linea bg-card px-2.5 text-base"
                              />
                            </label>
                            <label className="col-span-2 row-start-2 block sm:col-span-1 sm:row-start-auto">
                              <span className="text-sm text-muted-foreground">Banco</span>
                              <input
                                value={parte.banco}
                                onChange={(e) => actualizarParte(i, { banco: e.target.value })}
                                className="mt-0.5 h-11 w-full rounded-lg border border-linea bg-card px-2.5 text-base"
                              />
                            </label>
                            <label className="block">
                              <span className={`text-sm ${sinFecha === i ? "font-semibold text-saldo-debe" : "text-muted-foreground"}`}>
                                Fecha de pago
                              </span>
                              <CampoFecha
                                value={parte.fechaPago}
                                onChange={(e) => {
                                  if (sinFecha === i) setSinFecha(null);
                                  actualizarParte(i, { fechaPago: e.target.value });
                                }}
                                aria-invalid={sinFecha === i || undefined}
                                data-foco={`fecha-cheque-${i}`}
                                className="tabular mt-0.5 h-11 w-full rounded-lg border border-linea bg-card px-2.5 text-base"
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
                      onClick={() => setPartes([...partes.map((p) => ({ ...p, auto: false })), parteVacia()])}
                      className="tarjeta-hundida h-11 rounded-xl px-4 text-base font-medium"
                    >
                      + Otro renglón
                    </button>
                  )}
                  {/* Contra lo que sale: hubo que calcular la retención a
                      mano para que el e-Cheq cerrara (M2S1-036). */}
                  <p className="tabular text-base">
                    <span className="text-muted-foreground">
                      Suman {formatearMonto(sumaPartes)} de {formatearMonto(neto)}
                    </span>
                    {Math.abs(faltanPartes) > 0.009 && (
                      <span className="font-semibold text-saldo-debe">
                        {" · "}
                        {faltanPartes > 0 ? `faltan ${formatearMonto(faltanPartes)}` : `sobran ${formatearMonto(-faltanPartes)}`}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

            <div className="md:col-span-2">
              <button
                type="button"
                onClick={() =>
                  setPartes(
                    partes === null
                      ? [{ ...parteVacia(medio as ParteUI["medio"]), auto: true }]
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

        {supplierId && regimenesDelProveedor.length > 0 && (
          <Seccion titulo="Retenciones" icono={Landmark} columnas={1}>
            <div className="grid gap-4 md:grid-cols-2">
              {regimenesDelProveedor.map((r) => {
                const sim = simuladas[r.id];
                // Sin acumulado ni mínimo, «$ X = $ X × 8,68 %» repetía la
                // base: va directo a la alícuota (mes 23).
                const conPasos = Boolean(sim && (sim.acumulado - sim.base > 0.009 || sim.minimo > 0));
                return (
                  <div key={r.id} className="space-y-2">
                    <Interruptor
                      etiqueta={`${r.nombre} · ${r.alicuota.toLocaleString("es-AR")}%`}
                      icono={Landmark}
                      marcado={Boolean(retener[r.id])}
                      alCambiar={(v) => setRetener((prev) => ({ ...prev, [r.id]: v }))}
                    />
                    {retener[r.id] &&
                      (conFacturas ? null : (
                        <label className="block">
                          <span className="text-base font-medium">Base</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={basesAMano[r.id] ?? ""}
                            aria-invalid={importeIlegible(basesAMano[r.id] ?? "") || undefined}
                            onChange={(e) => setBasesAMano((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
                          />
                        </label>
                      ))}
                    {/* La misma cuenta que el certificado (M2S1-110): base del
                        mes − mínimo = sujeto × alícuota − lo ya retenido. */}
                    {retener[r.id] && sim && (
                      <div className="tabular px-1">
                        <p className="text-sm text-muted-foreground">
                          {conPasos && formatearMonto(sim.base)}
                          {sim.acumulado - sim.base > 0.009 && ` + ${formatearMonto(sim.acumulado - sim.base)} del mes`}
                          {sim.minimo > 0 && ` − ${formatearMonto(sim.minimo)} mínimo`}
                          {`${conPasos ? " = " : ""}${formatearMonto(sim.imponible)} × ${sim.alicuota.toLocaleString("es-AR")} %`}
                          {sim.retenidoAntes > 0.009 && ` − ${formatearMonto(sim.retenidoAntes)} ya retenido`}
                        </p>
                        <p className="text-base">
                          Retiene <strong>{formatearMonto(sim.retencion)}</strong>
                          {sim.retencion <= 0 && sim.motivo && (
                            <span className="text-muted-foreground"> · {sim.motivo}</span>
                          )}
                        </p>
                      </div>
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
              // Un cheque nuevo sin fecha: se marca su campo y se dice cuál.
              // Antes el error llegaba de la API como «Fecha pago: falta o no
              // es válido», sin decir de qué renglón (M2S4-036).
              const falta = (partes ?? []).findIndex(
                (p) =>
                  importeDelCampo(p.importe) > 0 &&
                  !p.chequeId &&
                  (p.medio === "cheque" || p.medio === "echeq") &&
                  !p.fechaPago,
              );
              if (falta >= 0) {
                const p = partes![falta];
                setSinFecha(falta);
                setEstado({ error: `Falta la fecha del ${p.medio === "echeq" ? "e-Cheq" : "cheque"}${p.numero ? ` ${p.numero}` : ""}.` });
                document.querySelector<HTMLInputElement>(`[data-foco="fecha-cheque-${falta}"]`)?.focus();
                return;
              }
              const r = await pagarAProveedor({
                supplierId,
                total,
                fecha: fechaPago,
                branchId: hayEfectivo && branchId ? branchId : undefined,
                medio: medio as "transferencia",
                circuito,
                referencia: partes === null ? referencia : "",
                retenciones,
                imputaciones: tildadas
                  .filter((f) => !esCheque(f) && !esAjuste(f))
                  .map((f) => ({ purchaseInvoiceId: f.id, importe: imputado[f.id] }))
                  .filter((x) => x.importe > 0),
                cheques: tildadas
                  .filter(esCheque)
                  .map((f) => ({ chequeId: f.id, importe: importeDelCampo(aplicado[f.id]) }))
                  .filter((x) => x.importe > 0),
                ajustes: tildadas
                  .filter(esAjuste)
                  .map((f) => ({ movimientoId: f.id, importe: importeDelCampo(aplicado[f.id]) }))
                  .filter((x) => x.importe > 0),
                notasDeCredito: notas.map((n) => n.id),
                partes:
                  partes === null
                    ? undefined
                    : partes
                        .filter((p) => importeDelCampo(p.importe) > 0)
                        .map((p) => ({
                          medio: p.medio,
                          importe: importeDelCampo(p.importe),
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
                // El cheque que se entregó ya no está en la cartera.
                void verChequesEnCartera().then(setCartera);
              }
            })
          }
          disabled={
            enCurso ||
            !supplierId ||
            total <= 0 ||
            aCuenta < -0.01 ||
            notasSinLugar.length > 0 ||
            basePasada ||
            importeIlegible(totalTocado) ||
            Object.values(aplicado).some(importeIlegible) ||
            Object.values(basesAMano).some(importeIlegible) ||
            (partes ?? []).some((p) => importeIlegible(p.importe))
          }
          className="boton-accion inline-flex h-12 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
        >
          {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
          {total > 0
            ? `${partes === null && medio === "transferencia" ? "Transferir" : "Pagar"} ${formatearMonto(neto)}`
            : "Pagar"}
        </button>
      </BarraGuardar>
    </div>
  );
}

/**
 * Cómo se lee un cheque de la cartera en la lista de endosos: el importe
 * primero, que es lo que distingue dos cheques con el mismo número cuando el
 * selector se corta en el teléfono (M2S3-015).
 */
function textoDelEndoso(c: ChequeDeCartera): string {
  return `${formatearMonto(c.importe)} · ${c.numero}${c.banco ? ` · ${c.banco}` : ""}${c.cliente ? ` · de ${c.cliente}` : ""}`;
}
