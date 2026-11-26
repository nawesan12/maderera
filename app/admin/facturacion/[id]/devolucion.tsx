"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { formatearMonto } from "@/lib/formato";
import { leerCantidad } from "@/lib/unidades";
import { Switch } from "@/components/ui/switch";
import { Opciones } from "@/components/admin/opciones";
import { Confirmar } from "@/components/admin/confirmar";
import type { DatosDeDevolucion } from "@/lib/dal/admin/facturacion";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { calcularDevolucion, devolver, type EstadoFactura } from "../actions";

type Destino = "caja" | "cuenta" | "afuera" | "deuda";
type SinStock = "rota" | "otro";
type Renglon = DatosDeDevolucion["renglones"][number];

/**
 * La devolución de una venta: la nota, el stock y la plata en una sola
 * operación (Go, facturacion.DevolucionParcial).
 *
 * Las opciones que no corresponden se ven deshabilitadas y no se explican:
 * la caja cuando la venta no entró en efectivo (o no alcanza), la cuenta
 * cuando no hay cliente o no se le cargó, «otro medio» cuando no se cobró
 * con tarjeta, transferencia ni cheque. «Al stock» viene encendido en todo lo
 * que tiene producto detrás; apagarlo pide el motivo de una lista, porque «se
 * rompió» es la excusa del que se lleva plata sin devolver nada.
 *
 * El importe lo calcula Go (con la percepción y el resto exacto del renglón
 * que se cierra) y es el que se confirma: si al hacerla dio otro, Go no la
 * hace. Un renglón con una parte retirada y otra en acopio pide cuánto sale
 * del acopio; el resto es lo que trae el cliente.
 */
/** Lo que se le pide a la devolución: la del panel o la del mostrador. */
export interface AccionesDeDevolucion {
  calcular: (renglones: RenglonPedido[]) => Promise<{ importe?: number; error?: string }>;
  devolver: (
    pedido: PedidoDeDevolucion,
    pin?: string,
  ) => Promise<{ ok?: string; error?: string; autorizacion?: Autorizacion } | EstadoFactura | undefined>;
}
type RenglonPedido = { itemId: string; cantidad: number; alStock: boolean; delAcopio: number | null };
type PedidoDeDevolucion = {
  clave: string;
  destino: Destino;
  motivo: string;
  sinStock: SinStock | null;
  sucursalId: string | null;
  importe: number;
  renglones: RenglonPedido[];
};

export function Devolucion({
  invoiceId,
  datos,
  alCancelar,
  acciones,
  alTerminar,
}: {
  invoiceId: string;
  datos: DatosDeDevolucion;
  alCancelar: () => void;
  /**
   * Desde el mostrador (mes simulado, H270): las acciones van por la venta y
   * piden el PIN de un admin al vendedor. Sin esto, las del panel.
   */
  acciones?: AccionesDeDevolucion;
  /** Hecha desde el mostrador: el mensaje, en vez de ir a la nota. */
  alTerminar?: (mensaje: string) => void;
}) {
  const hacer: AccionesDeDevolucion = acciones ?? {
    calcular: (renglones) => calcularDevolucion(invoiceId, renglones),
    devolver: (pedido) => devolver(invoiceId, pedido),
  };
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const id = useId();
  // Una clave por intento: el doble clic y el reintento devuelven la misma.
  const [clave] = useState(() => crypto.randomUUID());
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [delAcopio, setDelAcopio] = useState<Record<string, string>>({});
  const [alStock, setAlStock] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(datos.renglones.map((r) => [r.itemId, r.alStock])),
  );
  const [sinStock, setSinStock] = useState<SinStock | null>(null);
  const [sucursal, setSucursal] = useState<string | null>(datos.sucursal ?? datos.sucursales[0]?.id ?? null);
  const [motivo, setMotivo] = useState("");
  const [elegido, setElegido] = useState<Destino | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [estado, setEstado] = useState<EstadoFactura>({});
  const [enCurso, empezar] = useTransition();

  /** Parte retirada y parte en acopio: hay que decir de dónde sale. */
  const mixto = (r: Renglon) => r.alStock && r.enAcopio > 1e-9 && r.enAcopio < r.queda - 1e-9;

  const pedidos = datos.renglones
    .map((r) => ({ r, cantidad: leerCantidad(cantidades[r.itemId] ?? "") }))
    .filter((x) => x.cantidad > 0);
  const pasado = pedidos.find((x) => x.cantidad > x.r.queda + 1e-9);
  const acopioDe = (r: Renglon, cantidad: number): number | null => {
    if (!r.alStock) return null;
    if (!mixto(r)) return Math.min(cantidad, r.enAcopio);
    const v = delAcopio[r.itemId] ?? "";
    return v === "" ? 0 : leerCantidad(v);
  };
  const acopioMal = pedidos.find((x) => {
    const a = acopioDe(x.r, x.cantidad);
    return a !== null && (!(a >= 0) || a > x.cantidad + 1e-9 || a > x.r.enAcopio + 1e-9);
  });
  const renglones = pedidos.map((x) => ({
    itemId: x.r.itemId,
    cantidad: x.cantidad,
    alStock: alStock[x.r.itemId] ?? false,
    delAcopio: acopioDe(x.r, x.cantidad),
  }));

  // El importe de Go, para las cantidades que se están cargando (no depende
  // de dónde sale ni de si vuelve al stock). La firma es la que se pidió: una
  // respuesta vieja no pisa a la nueva.
  const [calculo, setCalculo] = useState<{ para: string; importe?: number; error?: string } | null>(null);
  const firma = pasado ? "" : JSON.stringify(renglones.map((r) => [r.itemId, r.cantidad]));
  useEffect(() => {
    const pares = JSON.parse(firma || "[]") as [string, number][];
    if (pares.length === 0) return;
    let vigente = true;
    const t = setTimeout(async () => {
      const r = await hacer.calcular(pares.map(([itemId, cantidad]) => ({ itemId, cantidad, alStock: false, delAcopio: null })));
      if (vigente) setCalculo({ para: firma, ...r });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
    // `hacer` cambia en cada render y no cambia lo que se calcula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firma, invoiceId]);
  const vale = calculo?.para === firma && renglones.length > 0 && !pasado ? calculo : null;
  const importe = vale?.importe ?? null;

  const alStockCuantos = pedidos.filter((x) => alStock[x.r.itemId]).reduce((s, x) => s + x.cantidad, 0);
  const hayFueraDeStock = pedidos.some((x) => x.r.alStock && !alStock[x.r.itemId]);
  const cajaAbierta = datos.sucursales.find((s) => s.id === sucursal)?.cajaAbierta ?? false;

  const entra = (tope: number) => tope > 0.005 && (importe === null || importe <= tope + 0.005);
  const cajaPosible = cajaAbierta && entra(datos.caja);
  const cuentaPosible = datos.conCliente && entra(datos.cuenta);
  const afueraPosible = entra(datos.afuera);
  // Lo que no se cobró se devuelve bajando lo que se debe: no sale plata.
  const deudaPosible = entra(datos.deuda);
  // Lo elegido, mientras siga valiendo; si no, el primero que vale.
  const posibles: Record<Destino, boolean> = {
    caja: cajaPosible,
    cuenta: cuentaPosible,
    afuera: afueraPosible,
    deuda: deudaPosible,
  };
  const destino: Destino | null =
    elegido && posibles[elegido]
      ? elegido
      : (["caja", "cuenta", "afuera", "deuda"] as const).find((d) => posibles[d]) ?? null;

  const listo =
    pedidos.length > 0 &&
    !pasado &&
    !acopioMal &&
    importe !== null &&
    destino !== null &&
    motivo.trim().length >= 4 &&
    (!hayFueraDeStock || sinStock !== null) &&
    (alStockCuantos === 0 || sucursal !== null);

  const resumen =
    importe === null
      ? ""
      : [
          `Nota ${formatearMonto(importe)}`,
          alStockCuantos > 0 ? `${alStockCuantos.toLocaleString("es-AR")} al stock` : null,
          destino === "caja"
            ? `${formatearMonto(importe)} de la caja`
            : destino === "cuenta"
              ? `${formatearMonto(importe)} a la cuenta`
              : destino === "afuera"
                ? `${formatearMonto(importe)} por el medio de pago`
                : destino === "deuda"
                  ? `${formatearMonto(importe)} menos de deuda`
                  : null,
        ]
          .filter(Boolean)
          .join(" · ");

  function mandar(pin?: string) {
    if (importe === null || destino === null) return;
    const pedido: PedidoDeDevolucion = {
      clave,
      destino,
      motivo,
      sinStock: hayFueraDeStock ? sinStock : null,
      sucursalId: sucursal,
      importe,
      renglones,
    };
    empezar(async () => {
      // Desde el panel, si sale bien, la acción lleva a la nota emitida.
      const r = (await hacer.devolver(pedido, pin)) ?? {};
      if ("autorizacion" in r && r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      setPidePin(null);
      setEstado({ error: r.error });
      if ("ok" in r && r.ok && !r.error) alTerminar?.(r.ok);
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (listo && !enCurso) setConfirmando(true);
      }}
    >
      <h3 className="text-base font-semibold">Devolución · {datos.pedido}</h3>

      <ul className="divide-y divide-linea rounded-lg bg-hundida">
        {datos.renglones.map((r) => {
          const valor = cantidades[r.itemId] ?? "";
          const cantidad = leerCantidad(valor);
          const mal = valor !== "" && (!(cantidad >= 0) || cantidad > r.queda + 1e-9);
          const acopio = delAcopio[r.itemId] ?? "";
          const acopioN = leerCantidad(acopio);
          const malAcopio = acopio !== "" && (!(acopioN >= 0) || acopioN > r.enAcopio + 1e-9 || acopioN > cantidad + 1e-9);
          return (
            <li key={r.itemId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <span className="min-w-0 flex-1 basis-48">
                <span className="block text-base">{r.descripcion}</span>
                <span className="tabular block text-sm text-muted-foreground">
                  {r.queda.toLocaleString("es-AR")} × {formatearMonto(r.unitario)}
                  {r.enAcopio > 1e-9 && ` · ${r.enAcopio.toLocaleString("es-AR")} en acopio`}
                </span>
              </span>
              <input
                aria-label={`Cuánto devuelve de ${r.descripcion}`}
                aria-invalid={mal || undefined}
                inputMode="decimal"
                autoComplete="off"
                disabled={r.queda <= 0}
                value={valor}
                onChange={(e) => setCantidades((prev) => ({ ...prev, [r.itemId]: e.target.value }))}
                placeholder="0"
                className={`tabular h-11 w-24 shrink-0 rounded-lg bg-background px-2 text-right text-base disabled:opacity-40 ${
                  mal ? "ring-2 ring-saldo-debe" : ""
                }`}
              />
              {mixto(r) && cantidad > 0 && (
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  Del acopio
                  <input
                    aria-invalid={malAcopio || undefined}
                    inputMode="decimal"
                    autoComplete="off"
                    value={acopio}
                    onChange={(e) => setDelAcopio((prev) => ({ ...prev, [r.itemId]: e.target.value }))}
                    placeholder="0"
                    className={`tabular h-11 w-20 rounded-lg bg-background px-2 text-right text-base ${
                      malAcopio ? "ring-2 ring-saldo-debe" : ""
                    }`}
                  />
                </label>
              )}
              <label className="flex shrink-0 items-center gap-2 text-sm">
                <Switch
                  checked={alStock[r.itemId] ?? false}
                  disabled={!r.alStock}
                  onCheckedChange={(v) => setAlStock((prev) => ({ ...prev, [r.itemId]: v }))}
                />
                Al stock
              </label>
            </li>
          );
        })}
      </ul>

      {hayFueraDeStock && (
        <div className="space-y-1.5">
          <span className="text-sm font-medium">No vuelve al stock</span>
          <Opciones<SinStock>
            etiqueta="Por qué no vuelve al stock"
            valor={sinStock}
            alCambiar={setSinStock}
            opciones={[
              { valor: "rota", texto: "Rota" },
              { valor: "otro", texto: "Otro" },
            ]}
          />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {datos.sucursales.length > 1 && (
          <label className="block">
            <span className="text-sm font-medium">Entra a</span>
            <select
              value={sucursal ?? ""}
              onChange={(e) => setSucursal(e.target.value || null)}
              className="mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base"
            >
              {datos.sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">La plata</span>
          <Opciones<Destino>
            etiqueta="Por dónde vuelve la plata"
            valor={destino}
            alCambiar={setElegido}
            opciones={[
              { valor: "caja", texto: "Caja", deshabilitada: !cajaPosible },
              { valor: "cuenta", texto: "Cuenta", deshabilitada: !cuentaPosible },
              { valor: "afuera", texto: "Otro medio", deshabilitada: !afueraPosible },
              { valor: "deuda", texto: "Baja la deuda", deshabilitada: !deudaPosible },
            ]}
          />
        </div>
      </div>

      <label className="block" htmlFor={`${id}-motivo`}>
        <span className="text-sm font-medium">Motivo</span>
        <input
          id={`${id}-motivo`}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Le sobraron dos placas"
          className="mt-1 h-11 w-full rounded-lg bg-hundida px-3 text-base"
        />
      </label>

      {resumen && <p className="tabular text-base font-medium">{resumen}</p>}
      {(estado.error ?? vale?.error) && (
        <p role="alert" className="text-base text-saldo-debe">
          {estado.error ?? vale?.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Confirmar
          abierto={confirmando && importe !== null}
          alCerrar={() => setConfirmando(false)}
          titulo={`Devolución de ${datos.pedido} por ${formatearMonto(importe ?? 0)}`}
          detalle={`${resumen}.`}
          confirmar="Devolver"
          pendiente={enCurso}
          alConfirmar={() => {
            setConfirmando(false);
            mandar();
          }}
        />
        {pidePin ? (
          <div className="w-full">
            <CampoPin autorizacion={pidePin} enviando={enCurso} onEnviar={(pin) => mandar(pin)} onCancelar={() => setPidePin(null)} />
          </div>
        ) : (
          <button
            type="submit"
            disabled={enCurso || !listo}
            className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-semibold disabled:opacity-50"
          >
            {enCurso && <Loader2 className="h-4 w-4 animate-spin" />}
            Devolver
          </button>
        )}
        <button type="button" onClick={alCancelar} className="h-11 rounded-lg bg-hundida px-4 text-base">
          Cancelar
        </button>
      </div>
    </form>
  );
}
