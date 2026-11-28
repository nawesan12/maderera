"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, PencilLine, Undo2, X } from "lucide-react";
import { corregirPedido, devolverPedido } from "@/app/admin/ventas-actions";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cantidadConUnidad, formatearMonto, importeParaElCampo, parsearImporte } from "@/lib/formato";
import { Opciones } from "@/components/admin/opciones";
import type { DatosDeDevolucion } from "@/lib/dal/admin/ventas";
import { BuscadorDeProductos, type Linea } from "@/app/admin/presupuestos/nuevo/formulario";
import type { ZonaParaPedido } from "@/app/admin/presupuestos/acciones";
import { descuentoPorMedioDePago, montoDelDescuentoDePago, type EscalaDePago } from "@/lib/precios/medio-pago";

/** Un renglón del pedido, como lo necesitan los dos diálogos. */
export interface RenglonDelPedido {
  id: string;
  descripcion: string;
  unidad: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  /** Del catálogo: entra en el descuento por forma de pago. */
  deCatalogo?: boolean;
}

/** «1,5» y «1.5» son lo mismo en una cantidad. */
function leerCantidad(texto: string): number {
  const t = texto.trim().replace(",", ".");
  return t === "" ? 0 : Number(t);
}

const claseQuieta =
  "inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-hundida hover:text-foreground";

/**
 * Devolver lo que el cliente trae (o deja) de un pedido sin factura. Lo que
 * sigue en acopio baja la reserva y lo que se llevó vuelve al stock. La
 * plata baja lo que falta cobrar o va a la cuenta corriente; si ya está
 * cobrado, vuelve por donde entró: la caja o el banco (mes simulado 2: se
 * frenaba sin otra salida).
 */
export function DevolverPedido({
  id,
  numero,
  renglones,
  datos,
}: {
  id: string;
  numero: string;
  renglones: RenglonDelPedido[];
  datos: DatosDeDevolucion | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [motivo, setMotivo] = useState("");
  const [clave, setClave] = useState("");
  const [destino, setDestino] = useState<"caja" | "afuera" | null>(null);
  const [pendiente, startTransition] = useTransition();

  // Lo que queda de cada renglón: con dos ya devueltas decía «de 8 u.».
  const queda = new Map(datos?.renglones.map((r) => [r.orderItemId, r]) ?? []);
  const disponibles = renglones
    .map((r) => {
      const q = queda.get(r.id);
      return { ...r, queda: q?.queda ?? r.cantidad, neto: q?.neto ?? r.subtotal };
    })
    .filter((r) => r.queda > 0);
  const elegidos = disponibles
    .map((r) => ({ r, cantidad: leerCantidad(cantidades[r.id] ?? "") }))
    .filter((x) => Number.isFinite(x.cantidad) && x.cantidad > 0);
  // Vuelve lo que se cobró, no la lista: con el 10 % por transferencia
  // devolvía $ 12.345 de un tirante cobrado $ 11.110,50 (PED-1123). Lo
  // mismo que calcula Go (pedidos.importeDeLaVuelta).
  const total = elegidos.reduce(
    (s, x) =>
      s + (x.cantidad >= x.r.queda - 1e-9 ? x.r.neto : Math.round((x.r.neto * x.cantidad * 100) / x.r.queda) / 100),
    0,
  );
  const mal = disponibles.some((r) => {
    const c = leerCantidad(cantidades[r.id] ?? "");
    return !Number.isFinite(c) || c < 0 || c > r.queda;
  });
  // Ya cobrado: la plata sale por la caja o por el banco, hasta lo que entró
  // por cada uno.
  const cobrado = Boolean(datos && !datos.aCuenta && total > datos.deuda + 0.005);
  // Por donde no entró nada no se ofrece (cobrado por transferencia, «De la
  // caja» se veía apagada sin decir por qué), y si queda una sola, va
  // elegida. Apagada por la caja cerrada, lo dice al pasar el puntero.
  const opciones = datos
    ? [
        {
          valor: "caja" as const,
          texto: "De la caja",
          deshabilitada: !datos.cajaAbierta || datos.caja + 0.005 < total,
          motivo: datos.cajaAbierta ? undefined : "No hay caja abierta",
          entro: datos.caja,
        },
        { valor: "afuera" as const, texto: "Por el banco", deshabilitada: datos.afuera + 0.005 < total, entro: datos.afuera },
      ].filter((o) => o.entro > 0.005)
    : [];
  const habilitadas = opciones.filter((o) => !o.deshabilitada);
  const elegido = cobrado
    ? (habilitadas.find((o) => o.valor === destino)?.valor ?? (habilitadas.length === 1 ? habilitadas[0].valor : null))
    : null;

  function abrir(v: boolean) {
    if (v && !abierto) {
      // Una clave por intento: el doble clic devuelve la misma devolución.
      setClave(crypto.randomUUID());
      setCantidades({});
      setMotivo("");
      setDestino(null);
    }
    setAbierto(v);
  }

  function devolver() {
    startTransition(async () => {
      const r = await devolverPedido(
        id,
        elegidos.map((x) => ({ orderItemId: x.r.id, cantidad: x.cantidad })),
        motivo.trim(),
        clave,
        elegido ?? undefined,
      );
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Devolución registrada.");
      setAbierto(false);
      router.refresh();
    });
  }

  if (disponibles.length === 0) return null;

  return (
    <>
      <button type="button" onClick={() => abrir(true)} className={claseQuieta}>
        <Undo2 className="h-5 w-5" aria-hidden="true" />
        Devolver
      </button>
      <Dialog open={abierto} onOpenChange={(v) => !pendiente && abrir(v)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              Devolución de <span className="tabular whitespace-nowrap">{numero}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {disponibles.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label htmlFor={`devuelve-${r.id}`} className="min-w-0 flex-1 basis-48 text-base">
                  {r.descripcion}
                  <span className="block text-sm text-muted-foreground">de {cantidadConUnidad(r.queda, r.unidad, r.descripcion)}</span>
                </label>
                <Input
                  id={`devuelve-${r.id}`}
                  inputMode="decimal"
                  placeholder="0"
                  value={cantidades[r.id] ?? ""}
                  onChange={(e) => setCantidades((c) => ({ ...c, [r.id]: e.target.value }))}
                  aria-invalid={leerCantidad(cantidades[r.id] ?? "") > r.queda || undefined}
                  className="tabular h-11 w-24 text-right text-base"
                />
              </div>
            ))}
          </div>
          {cobrado && (
            <div className="space-y-2">
              <p className="text-base font-medium">La plata</p>
              <Opciones etiqueta="Por dónde vuelve la plata" valor={elegido} alCambiar={setDestino} opciones={opciones} />
            </div>
          )}
          <div className="space-y-1.5">
            <label htmlFor="motivo-devolucion" className="text-base font-medium">
              Por qué
            </label>
            <Textarea id="motivo-devolucion" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={2} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
            <button type="button" onClick={() => setAbierto(false)} className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida">
              Mejor no
            </button>
            <button
              type="button"
              disabled={pendiente || mal || elegidos.length === 0 || !motivo.trim() || (cobrado && !elegido)}
              onClick={devolver}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
            >
              {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
              Devolver {total > 0 && <span className="tabular">{formatearMonto(total)}</span>}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Corregir un pedido mal cargado, sin factura ni cobro: la cantidad, el
 * precio y el flete (mes simulado: PED-1066 salió sin flete y había que
 * anular y volver a cargar toda la venta). Queda en el historial; un precio
 * bajo la lista, pasado lo libre, pide el PIN de un admin.
 */
export function CorregirPedido({
  id,
  numero,
  renglones,
  costoEnvio,
  conEnvio,
  descuento,
  entrega,
  zonas = [],
  porMedio = null,
  branchId = null,
  customerId = null,
}: {
  id: string;
  numero: string;
  renglones: RenglonDelPedido[];
  costoEnvio: number;
  conEnvio: boolean;
  descuento: number;
  /** Cómo se entrega hoy; null si ya salió algo (no se cambia). */
  entrega?: { tipo: "retiro" | "envio"; direccion: string; zona: string } | null;
  zonas?: ZonaParaPedido[];
  /** El descuento salió de la forma de pago: se recalcula con lo que queda. */
  porMedio?: { medio: string; escalas: EscalaDePago[]; alFlete: boolean } | null;
  branchId?: string | null;
  customerId?: string | null;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [valores, setValores] = useState<Record<string, { cantidad: string; precio: string }>>({});
  const [flete, setFlete] = useState("");
  const [motivo, setMotivo] = useState("");
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const [pendiente, startTransition] = useTransition();
  // Lo que se suma y cómo se entrega (mes simulado 2: la corrección solo
  // tocaba cantidades y precios, y un retiro no pasaba a envío).
  const [nuevos, setNuevos] = useState<Linea[]>([]);
  const [tipo, setTipo] = useState<"retiro" | "envio">(entrega?.tipo ?? (conEnvio ? "envio" : "retiro"));
  const [direccion, setDireccion] = useState(entrega?.direccion ?? "");
  const [zona, setZona] = useState(entrega?.zona ?? "");
  const conEnvioAhora = tipo === "envio";

  function abrir(v: boolean) {
    if (v && !abierto) {
      setValores(
        Object.fromEntries(
          renglones.map((r) => [r.id, { cantidad: String(r.cantidad).replace(".", ","), precio: importeParaElCampo(r.precioUnitario) }]),
        ),
      );
      setFlete(importeParaElCampo(costoEnvio));
      setMotivo("");
      setPidePin(null);
      setNuevos([]);
      setTipo(entrega?.tipo ?? (conEnvio ? "envio" : "retiro"));
      setDireccion(entrega?.direccion ?? "");
      setZona(entrega?.zona ?? "");
    }
    setAbierto(v);
  }

  const leidos = renglones.map((r) => {
    const v = valores[r.id];
    return { r, cantidad: v ? leerCantidad(v.cantidad) : r.cantidad, precio: v ? parsearImporte(v.precio) : r.precioUnitario };
  });
  const fleteLeido = flete.trim() === "" ? 0 : parsearImporte(flete);
  const mal =
    leidos.some((x) => !(x.cantidad > 0) || !Number.isFinite(x.precio) || x.precio < 0) ||
    nuevos.some((n) => !(n.cantidad > 0) || !Number.isFinite(n.precioUnitario) || n.precioUnitario < 0) ||
    !Number.isFinite(fleteLeido) ||
    fleteLeido < 0 ||
    (conEnvioAhora && !direccion.trim());
  const centavos = (n: number) => Math.round(n * 100) / 100;
  // El 10 % por transferencia sigue a lo que se vende, como en Go: sumar un
  // renglón lo dejaba fijo (PED-1132).
  const base = centavos(
    leidos.filter((x) => x.r.deCatalogo || porMedio?.alFlete).reduce((s, x) => s + centavos(x.cantidad * x.precio), 0) +
      nuevos.reduce((s, n) => s + centavos(n.cantidad * n.precioUnitario), 0),
  );
  const escala = porMedio ? descuentoPorMedioDePago(porMedio.escalas, porMedio.medio, base) : null;
  const descuentoAhora = porMedio ? (escala ? montoDelDescuentoDePago(base, escala.porcentaje) : 0) : descuento;
  const total =
    leidos.reduce((s, x) => s + centavos(x.cantidad * x.precio), 0) +
    nuevos.reduce((s, n) => s + centavos(n.cantidad * n.precioUnitario), 0) +
    (conEnvioAhora ? fleteLeido : 0) -
    descuentoAhora;

  function elegirZona(nombre: string) {
    cambiar(() => {
      setZona(nombre);
      const z = zonas.find((x) => x.nombre === nombre);
      // El flete de la zona anterior no queda puesto (M2S1-189): la nueva
      // trae el suyo, «0» si es sin cargo o vacío si se cotiza.
      if (z) setFlete(z.costo > 0 ? importeParaElCampo(z.costo) : z.aCotizar ? "" : "0");
    });
  }

  /*
   * El PIN firma estos números: cambiar uno lo deja sin efecto y vuelve
   * «Guardar». Si no, volver el precio a la lista dejaba el diálogo pidiendo
   * el PIN por «$ 37.800 abajo del precio» (mes simulado, H296).
   */
  function cambiar(fn: () => void) {
    fn();
    setPidePin(null);
  }

  function guardar(pin?: string) {
    startTransition(async () => {
      const cambiaEntrega = entrega != null && tipo !== entrega.tipo;
      const r = await corregirPedido(id, {
        renglones: leidos.map((x) => ({ orderItemId: x.r.id, cantidad: x.cantidad, precioUnitario: x.precio })),
        ...(conEnvioAhora ? { costoEnvio: fleteLeido } : {}),
        ...(nuevos.length > 0
          ? {
              nuevos: nuevos.map((n) => ({
                variantId: n.variantId ?? "",
                descripcion: n.descripcion,
                unidad: n.unidad,
                cantidad: n.cantidad,
                precioUnitario: n.precioUnitario,
              })),
            }
          : {}),
        ...(cambiaEntrega ? { entrega: tipo, ...(tipo === "envio" ? { direccion: direccion.trim(), zona: zona || undefined } : {}) } : {}),
        motivo: motivo.trim(),
        ...(pin ? { pin } : {}),
      });
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Pedido corregido.");
      setAbierto(false);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={() => abrir(true)} className={claseQuieta}>
        <PencilLine className="h-5 w-5" aria-hidden="true" />
        Corregir
      </button>
      <Dialog open={abierto} onOpenChange={(v) => !pendiente && abrir(v)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              Corregir <span className="tabular whitespace-nowrap">{numero}</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {renglones.map((r) => (
              <fieldset key={r.id} className="space-y-1.5">
                <legend className="text-base">{r.descripcion}</legend>
                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1 text-sm text-muted-foreground">
                    Cantidad
                    <Input
                      inputMode="decimal"
                      value={valores[r.id]?.cantidad ?? ""}
                      onChange={(e) => cambiar(() => setValores((v) => ({ ...v, [r.id]: { ...v[r.id], cantidad: e.target.value } })))}
                      className="tabular h-11 text-right text-base text-foreground"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-muted-foreground">
                    Precio
                    <Input
                      inputMode="decimal"
                      value={valores[r.id]?.precio ?? ""}
                      onChange={(e) => cambiar(() => setValores((v) => ({ ...v, [r.id]: { ...v[r.id], precio: e.target.value } })))}
                      className="tabular h-11 text-right text-base text-foreground"
                    />
                  </label>
                </div>
              </fieldset>
            ))}
            {nuevos.map((n, i) => (
              <fieldset key={`nuevo-${i}`} className="space-y-1.5">
                <legend className="flex w-full items-center justify-between gap-2 text-base">
                  <span className="min-w-0">{n.descripcion}</span>
                  <button
                    type="button"
                    onClick={() => cambiar(() => setNuevos((xs) => xs.filter((_, j) => j !== i)))}
                    aria-label={`Sacar ${n.descripcion}`}
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-hundida"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </legend>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    inputMode="decimal"
                    aria-label="Cantidad"
                    value={String(n.cantidad).replace(".", ",")}
                    onChange={(e) =>
                      cambiar(() => setNuevos((xs) => xs.map((x, j) => (j === i ? { ...x, cantidad: leerCantidad(e.target.value) } : x))))
                    }
                    className="tabular h-11 text-right text-base"
                  />
                  <Input
                    inputMode="decimal"
                    aria-label="Precio"
                    defaultValue={importeParaElCampo(n.precioUnitario)}
                    onChange={(e) =>
                      cambiar(() => setNuevos((xs) => xs.map((x, j) => (j === i ? { ...x, precioUnitario: parsearImporte(e.target.value) } : x))))
                    }
                    className="tabular h-11 text-right text-base"
                  />
                </div>
              </fieldset>
            ))}
            {branchId && (
              <BuscadorDeProductos
                branchId={branchId}
                customerId={customerId}
                onAgregar={(l) => cambiar(() => setNuevos((xs) => [...xs, l]))}
              />
            )}
            {/* Cómo se entrega, antes de que salga algo. */}
            {entrega && (
              <div className="space-y-2">
                <p className="text-base font-medium">Entrega</p>
                <Opciones
                  etiqueta="Entrega"
                  valor={tipo}
                  alCambiar={(v) => cambiar(() => setTipo(v))}
                  opciones={[
                    { valor: "retiro", texto: "Lo retira" },
                    { valor: "envio", texto: "Se lo llevamos" },
                  ]}
                />
                {conEnvioAhora && tipo !== entrega.tipo && (
                  <>
                    <Input
                      aria-label="Dirección"
                      placeholder="Dirección"
                      value={direccion}
                      onChange={(e) => cambiar(() => setDireccion(e.target.value))}
                      maxLength={300}
                      className="h-11 text-base"
                    />
                    {zonas.length > 0 && (
                      <Opciones
                        etiqueta="Zona"
                        valor={zona || null}
                        alCambiar={elegirZona}
                        opciones={zonas.map((z) => ({ valor: z.nombre, texto: z.nombre }))}
                      />
                    )}
                  </>
                )}
              </div>
            )}
            {conEnvioAhora && (
              <label className="block space-y-1 text-base font-medium">
                Flete
                <Input
                  inputMode="decimal"
                  value={flete}
                  onChange={(e) => cambiar(() => setFlete(e.target.value))}
                  className="tabular h-11 text-right text-base"
                />
              </label>
            )}
            <div className="space-y-1.5">
              <label htmlFor="motivo-correccion" className="text-base font-medium">
                Por qué
              </label>
              <Textarea id="motivo-correccion" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} rows={2} />
            </div>
            <div className="flex items-baseline justify-between border-t pt-3">
              <span className="text-base text-muted-foreground">Total</span>
              <span className="tabular text-xl font-semibold">{formatearMonto(total)}</span>
            </div>
          </div>
          {pidePin ? (
            <CampoPin autorizacion={pidePin} enviando={pendiente} onEnviar={(pin) => guardar(pin)} onCancelar={() => setPidePin(null)} />
          ) : (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button type="button" onClick={() => setAbierto(false)} className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida">
                Mejor no
              </button>
              <button
                type="button"
                disabled={pendiente || mal || !motivo.trim()}
                onClick={() => guardar()}
                className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
