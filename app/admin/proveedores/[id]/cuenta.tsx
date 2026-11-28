"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { formatearMonto, importeDelCampo, importeIlegible } from "@/lib/formato";
import { Opciones } from "@/components/admin/formulario";
import {
  registrarMovimientoDeProveedor,
  type EstadoProveedor,
} from "../actions";

interface Movimiento {
  id: string;
  tipo: string;
  monto: number;
  detalle: string | null;
  referencia: string | null;
  createdAt: Date;
  saldo: number;
  purchaseInvoiceId: string | null;
  supplierPaymentId: string | null;
  goodsReceiptId?: string | null;
  facturaDelRemito?: string | null;
  chequeId?: string | null;
  aplicaA?: string | null;
}

/** Una factura con saldo, a la que se puede aplicar un ajuste que baja la deuda. */
interface FacturaPendiente {
  id: string;
  numero: string;
  saldo: number;
  /** Un ajuste que subió la deuda: el que la baja se le aplica (M4-036). */
  ajuste?: boolean;
}

const TIPOS: Record<string, string> = {
  factura: "Factura",
  pago: "Pago",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
  ajuste: "Ajuste",
};

/** A dónde lleva un movimiento: a la factura o al pago del que salió. */
function destino(m: Movimiento): string | null {
  if (m.purchaseInvoiceId) return `/admin/compras/facturas/${m.purchaseInvoiceId}`;
  if (m.supplierPaymentId) return `/admin/compras/pagos/${m.supplierPaymentId}`;
  if (m.goodsReceiptId) return `/admin/recepciones/${m.goodsReceiptId}`;
  if (m.chequeId) return "/admin/cheques";
  return null;
}

/**
 * Cómo se llama un ajuste que no anotó nadie a mano: el cheque que rebotó,
 * la anulación de un pago o de una factura, la corrección de una factura.
 * Todos decían «Ajuste», igual que uno manual (M2S3-055).
 */
function nombreDelAjuste(m: Movimiento): string {
  if (m.chequeId) return "Cheque rechazado";
  if (m.supplierPaymentId) return "Anulación del pago";
  if (m.purchaseInvoiceId && m.detalle?.startsWith("Anulación")) return "Anulación";
  if (m.purchaseInvoiceId && m.detalle?.startsWith("Corrección")) return "Corrección";
  if (m.purchaseInvoiceId) return "Diferencia";
  return "Ajuste";
}

/**
 * Cómo se llama el renglón. Lo que cargó una recepción es un remito, no una
 * factura (mes simulado, H070: decía «Factura · 0001-00000877» con el número
 * del remito); si ya llegó la factura que lo cubre, se nombra.
 */
function nombreDelMovimiento(m: Movimiento): { titulo: string; numero: string | null } {
  if (m.goodsReceiptId) {
    return {
      titulo: m.tipo === "nota_credito" ? "Remito anulado" : "Remito",
      numero: [m.referencia, m.facturaDelRemito && `factura ${m.facturaDelRemito}`].filter(Boolean).join(" · ") || null,
    };
  }
  if (m.tipo === "ajuste") {
    return {
      titulo: nombreDelAjuste(m),
      numero:
        [m.referencia, m.aplicaA && (m.aplicaA.startsWith("ajuste") ? `al ${m.aplicaA}` : `a la factura ${m.aplicaA}`)]
          .filter(Boolean)
          .join(" · ") || null,
    };
  }
  return { titulo: TIPOS[m.tipo] ?? m.tipo, numero: m.referencia };
}

const fechaDelRenglon = (d: Date) =>
  new Date(d).toLocaleDateString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });

/**
 * El libro de la cuenta, con el saldo de cada renglón.
 *
 * Cada renglón lleva a la factura o al pago del que salió (Go lo sabe desde
 * la 00101). Lo que se anota a mano es **solo un ajuste** —un saldo inicial,
 * una bonificación acordada, un redondeo— con su motivo. Bug arreglado: acá
 * se podía anotar una «Factura» o un «Pago» que no pasaba por compras ni por
 * el libro IVA: la deuda bajaba sin pago (ni retenciones, ni caja, ni
 * cheque) y subía sin crédito fiscal.
 *
 * El monto se carga siempre en positivo y el lado lo dice la opción. Pedirle
 * a alguien que escriba "-45000" es pedirle que se olvide el menos una vez
 * cada veinte, y esa vez la deuda sube el doble en vez de bajar.
 */
export function CuentaDelProveedor({
  supplierId,
  movimientos,
  facturas = [],
}: {
  supplierId: string;
  movimientos: Movimiento[];
  /** Las facturas con saldo: un ajuste que baja la deuda se aplica a una (M3S2-028). */
  facturas?: FacturaPendiente[];
}) {
  const router = useRouter();
  const [estado, setEstado] = useState<EstadoProveedor>({});
  const [enCurso, empezar] = useTransition();

  const [ajustando, setAjustando] = useState(false);
  const [sentido, setSentido] = useState<"sube" | "baja">("baja");
  const [monto, setMonto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [detalle, setDetalle] = useState("");
  // Si hay un ajuste que subió la deuda y sigue abierto, el que la baja se
  // le aplica salvo que se elija otra cosa: con «Ninguna» por defecto, el
  // primero quedaba para pagarse con el saldo en cero (M4-036).
  const ajusteAbierto = facturas.find((f) => f.ajuste)?.id ?? "";
  const [elegida, setElegida] = useState<string | null>(null);
  const aplicaA = elegida !== null && (elegida === "" || facturas.some((f) => f.id === elegida)) ? elegida : ajusteAbierto;

  function anotar() {
    empezar(async () => {
      const resultado = await registrarMovimientoDeProveedor({
        supplierId,
        sentido,
        monto: importeDelCampo(monto),
        referencia,
        detalle,
        aplicaA: sentido === "baja" && aplicaA ? aplicaA : undefined,
      });
      setEstado(resultado);
      if (resultado.ok) {
        setMonto("");
        setReferencia("");
        setDetalle("");
        setElegida(null);
        setAjustando(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="tarjeta overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <h2 className="text-[19px] font-bold tracking-tight">Cuenta corriente</h2>
        {!ajustando && (
          <button
            type="button"
            onClick={() => setAjustando(true)}
            className="tarjeta-hundida inline-flex h-11 items-center gap-2 rounded-xl px-4 text-base font-medium"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Anotar un ajuste
          </button>
        )}
      </header>

      {ajustando && (
        <div className="tarjeta-hundida mx-5 mt-4 grid gap-4 rounded-xl p-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <Opciones
              nombre="ajuste-sentido"
              opciones={[
                { valor: "baja", texto: "Baja lo que le debemos" },
                { valor: "sube", texto: "Sube lo que le debemos" },
              ]}
              valor={sentido}
              alCambiar={(v) => setSentido(v as "sube" | "baja")}
              columnas={2}
            />
          </div>
          <label className="block">
            <span className="text-base font-medium">Monto</span>
            <input
              type="text"
              inputMode="decimal"
              value={monto}
              aria-invalid={importeIlegible(monto) || undefined}
              onChange={(e) => setMonto(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-right text-base"
            />
          </label>
          <label className="block">
            <span className="text-base font-medium">Comprobante</span>
            <input
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              className="tabular mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          <label className="block md:col-span-2">
            <span className="text-base font-medium">Motivo</span>
            <input
              value={detalle}
              onChange={(e) => setDetalle(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
            />
          </label>
          {/* Una bonificación se aplica a su factura, como una nota de
              crédito: la factura queda pagada por lo que cubre. */}
          {sentido === "baja" && facturas.length > 0 && (
            <label className="block md:col-span-2">
              <span className="text-base font-medium">Aplica a</span>
              <select
                value={aplicaA}
                onChange={(e) => setElegida(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-linea bg-card px-3 text-base"
              >
                <option value="">Ninguna</option>
                {facturas.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.numero} · {formatearMonto(f.saldo)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <button
              type="button"
              onClick={anotar}
              disabled={enCurso || importeIlegible(monto) || !(importeDelCampo(monto) > 0) || detalle.trim() === ""}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-xl px-5 text-base font-semibold disabled:opacity-50"
            >
              {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
              Anotar
            </button>
            <button
              type="button"
              onClick={() => setAjustando(false)}
              className="tarjeta h-11 rounded-xl px-4 text-base font-medium"
            >
              Volver
            </button>
          </div>
        </div>
      )}

      {(estado.error || estado.ok) && (
        <p className={`px-5 pt-3 text-base ${estado.error ? "text-saldo-debe" : "text-saldo-favor"}`}>
          {estado.error ?? estado.ok}
        </p>
      )}

      {movimientos.length === 0 ? (
        <p className="px-5 py-10 text-center text-base text-muted-foreground">Sin movimientos</p>
      ) : (
        /* Un renglón por movimiento, sin tabla (M3S4-021): con la tabla, a
           1280 el detalle se apilaba palabra por palabra contra columnas
           vacías y a 375 los rótulos se cortaban («D…», «Movimi…») y la
           referencia se salía de la tarjeta. En el teléfono: el tipo y el
           monto arriba, la referencia en su renglón (se corta donde haga
           falta), el detalle y al pie la fecha y el saldo. Desde 640 de
           ancho de la tarjeta, una fila con el detalle tomando el espacio. */
        <ul className="@container mt-3 divide-y divide-linea border-t border-linea">
          {movimientos.map((m) => {
            const href = destino(m);
            const n = nombreDelMovimiento(m);
            const titulo = href ? (
              <Link href={href} className="font-semibold hover:underline">
                {n.titulo}
              </Link>
            ) : (
              <span className="font-semibold">{n.titulo}</span>
            );
            return (
              <li
                key={m.id}
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-5 py-3 @2xl:grid-cols-[5.5rem_minmax(9rem,14rem)_1fr_8rem_8rem] @2xl:items-baseline"
              >
                <span className="tabular order-4 text-sm text-muted-foreground @2xl:order-none @2xl:text-base">
                  {fechaDelRenglon(m.createdAt)}
                </span>
                <span className="order-1 min-w-0 @2xl:order-none">
                  {titulo}
                  {/* `.codigo` no parte (va sin @layer y le gana a las utilidades):
                      una referencia de un pago partido o de un ajuste aplicado
                      se montaba sobre el detalle a 1280 y se salía de la
                      tarjeta a 375 (mes 23). Parte en los espacios y, si no
                      alcanza, donde haga falta. */}
                  {n.numero && (
                    <span className="codigo mt-0.5 block w-fit max-w-full text-sm text-muted-foreground [overflow-wrap:anywhere] !whitespace-normal">
                      {n.numero}
                    </span>
                  )}
                </span>
                <span className="order-3 col-span-2 min-w-0 text-base text-muted-foreground @2xl:order-none @2xl:col-span-1">
                  {/* Las notas cargadas antes decían «Factura de compra». */}
                  {m.tipo !== "factura" && m.detalle === "Factura de compra" ? "" : (m.detalle ?? "")}
                </span>
                <span
                  className={`tabular order-2 text-right font-semibold @2xl:order-none ${
                    m.monto > 0 ? "text-saldo-debe" : "text-saldo-favor"
                  }`}
                >
                  {formatearMonto(m.monto)}
                </span>
                <span className="tabular order-5 text-right text-sm text-muted-foreground @2xl:order-none @2xl:text-base @2xl:text-foreground">
                  {formatearMonto(m.saldo)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
