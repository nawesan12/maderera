"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wallet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CobroMultimedio } from "@/components/cobros/cobro-multimedio";
import { formatearMonto, importeParaElCampo, parsearImporte } from "@/lib/formato";
import {
  cajaDelCobro,
  cobrarPedido,
  registrarCobroDeCliente,
  type EstadoCobro,
} from "@/app/admin/cobros-actions";
import { abrirCaja } from "@/app/mostrador/actions";
import { claveAlAbrir } from "@/lib/cobros/clave";

/**
 * «Registrar cobro»: lo que pagó un cliente, con su recibo.
 *
 * Abre desde la ficha del cliente (pago a cuenta) y desde un pedido. Con
 * `pedido` cobra el pedido (POST /admin/pedidos/{id}/cobro): tenga o no
 * cliente, con recibo, y el efectivo al turno de su sucursal. Al terminar
 * ofrece el recibo para imprimir en el mismo aviso: el cliente suele estar
 * enfrente esperando el papel.
 *
 * Cada vez que se abre nace una clave nueva (T3, hallazgo 14): si la
 * respuesta se pierde y se aprieta otra vez, Go devuelve el mismo recibo en
 * vez de cobrar dos veces.
 */
export function DialogoCobro({
  customerId,
  nombre,
  aCobrar,
  orderId,
  numeroPedido,
  pedido,
  etiqueta = "Registrar cobro",
  claseBoton,
  alCobrar,
  abierto: abiertoAfuera,
  alCambiarAbierto,
  sinBoton = false,
}: {
  customerId?: string | null;
  nombre: string;
  /** Lo que se propone cobrar: la deuda, o el saldo del pedido. */
  aCobrar: number;
  /** Cobro desde la cuenta del cliente, atado a un pedido. */
  orderId?: string;
  numeroPedido?: string;
  /** El cobro del pedido mismo, desde su ficha o el tablero. */
  pedido?: { id: string; numero: string };
  etiqueta?: string;
  claseBoton?: string;
  /** Después de un cobro que salió bien (entregar, cerrar el alta del cheque). */
  alCobrar?: () => void;
  /** Abierto desde afuera («Cobrar y entregar»). */
  abierto?: boolean;
  alCambiarAbierto?: (abierto: boolean) => void;
  sinBoton?: boolean;
}) {
  const router = useRouter();
  const [abiertoAdentro, setAbiertoAdentro] = useState(false);
  const abierto = abiertoAfuera ?? abiertoAdentro;
  const [clave, setClave] = useState(() => crypto.randomUUID());
  const [fondo, setFondo] = useState("");
  const [fondoMal, setFondoMal] = useState(false);
  /** Un pedido sin sucursal: la caja elegida para el efectivo. */
  const [sucursal, setSucursal] = useState<string | null>(null);
  /** La caja recién abierta: el cuadro y el error de «sin caja» se van. */
  const [abierta, setAbierta] = useState<string | null>(null);
  const [abriendo, empezarAApertura] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  /*
   * La caja se sabe al abrir, no después del primer «Registrar» (mes
   * simulado): sin caja abierta, la elección o el «Abrir caja» aparecen en
   * cuanto el cobro lleva efectivo, que es el medio que propone.
   */
  const [previa, setPrevia] = useState<Pick<EstadoCobro, "sinCaja" | "fondoBase" | "sucursales">>({});
  const [conEfectivo, setConEfectivo] = useState(true);

  // Cada vez que se abre, de su botón o de afuera («Cobrar y entregar»),
  // nace una clave nueva y se olvida la caja del cobro anterior.
  const [abiertoAntes, setAbiertoAntes] = useState(abierto);
  if (abierto !== abiertoAntes) {
    setAbiertoAntes(abierto);
    const siguiente = claveAlAbrir(abiertoAntes, abierto, clave, () => crypto.randomUUID());
    if (siguiente !== clave) {
      setClave(siguiente);
      setSucursal(null);
      setAbierta(null);
      setFondo("");
      setPrevia({});
    }
  }
  const pedidoId = pedido?.id;
  useEffect(() => {
    if (!abierto || !pedidoId) return;
    let vigente = true;
    cajaDelCobro(pedidoId).then(
      (r) => vigente && setPrevia(r),
      () => undefined,
    );
    return () => {
      vigente = false;
    };
  }, [abierto, clave, pedidoId]);

  function cambiar(a: boolean) {
    setAbiertoAdentro(a);
    alCambiarAbierto?.(a);
  }

  const [estado, accion, pendiente] = useActionState(
    async (previo: EstadoCobro, formData: FormData) => {
      const r = pedido ? await cobrarPedido(previo, formData) : await registrarCobroDeCliente(previo, formData);
      if (r.ok) {
        toast.success(r.ok, {
          duration: 12_000,
          action: r.receiptId
            ? {
                label: "Imprimir recibo",
                onClick: () => window.open(`/api/recibos/${r.receiptId}/pdf`, "_blank"),
              }
            : undefined,
        });
        // Lo que hay que mirar —el efectivo que no entró a ninguna caja— va en
        // un aviso aparte y en amarillo: pegado al verde del éxito no se lee.
        if (r.aviso) toast.warning(r.aviso, { duration: 15_000 });
        cambiar(false);
        alCobrar?.();
        router.refresh();
      }
      return r;
    },
    {} as EstadoCobro,
  );

  /*
   * Sin caja abierta no se cobra en efectivo: se abre ahí mismo y se sigue.
   * La sucursal es la del pedido o, si no tiene, la elegida. El fondo viene
   * con el de cambio de la sucursal y se lee como se escribe acá («15.000»
   * son quince mil: con Number() eran $15). Abierta la caja, el mismo cobro
   * sale solo con la misma clave, que es repetible: abrir y cobrar es un
   * paso, y nadie se queda dudando si cobró.
   */
  // Lo que contestó el último «Registrar» manda; antes, lo que se supo al
  // abrir, si el cobro lleva efectivo.
  const respondio = Boolean(estado.sinCaja || estado.sucursales);
  const caja = respondio ? estado : conEfectivo ? previa : {};
  const opciones = caja.sucursales ?? [];
  const elegida = opciones.find((o) => o.id === sucursal) ?? null;
  const dondeAbrir = caja.sinCaja || (elegida && !elegida.abierta ? elegida.id : "");
  const fondoDeCambio = caja.sinCaja ? caja.fondoBase : elegida?.fondo;
  const pideAbrir = Boolean(dondeAbrir) && abierta !== dondeAbrir;
  const fondoVisto = fondo === "" && fondoDeCambio != null && fondoDeCambio > 0 ? importeParaElCampo(fondoDeCambio) : fondo;

  function abrirLaCaja() {
    if (!dondeAbrir) return;
    const monto = fondoVisto.trim() === "" ? 0 : parsearImporte(fondoVisto);
    if (!Number.isFinite(monto) || monto < 0) {
      setFondoMal(true);
      return;
    }
    setFondoMal(false);
    const donde = dondeAbrir;
    empezarAApertura(async () => {
      const r = await abrirCaja(donde, monto);
      if (r.error) {
        toast.error(r.error);
        return;
      }
      setAbierta(donde);
      formulario.current?.requestSubmit();
    });
  }

  const titulo = pedido
    ? `Cobrar ${pedido.numero}`
    : numeroPedido
      ? `Cobro del pedido ${numeroPedido}`
      : `Cobro — ${nombre}`;

  return (
    <Dialog open={abierto} onOpenChange={cambiar}>
      {!sinBoton && (
        <DialogTrigger
          className={
            claseBoton ??
            "boton-accion inline-flex h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-base font-medium"
          }
        >
          <Wallet className="h-5 w-5" />
          {etiqueta}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>
            {titulo}
            {aCobrar > 0 && (
              <>
                {" · "}
                <span className="tabular">{formatearMonto(aCobrar)}</span>
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <form ref={formulario} action={accion} className="space-y-4">
          <input type="hidden" name="clave" value={clave} />
          {sucursal && <input type="hidden" name="branchId" value={sucursal} />}
          {customerId && <input type="hidden" name="customerId" value={customerId} />}
          {pedido && <input type="hidden" name="pedidoId" value={pedido.id} />}
          {orderId && <input type="hidden" name="orderId" value={orderId} />}

          <CobroMultimedio aCobrar={Math.max(aCobrar, 0)} onEfectivo={setConEfectivo} />

          {!orderId && !pedido && (
            <label className="block text-sm text-muted-foreground">
              Concepto <span className="font-normal">(opcional)</span>
              <input
                name="concepto"
                placeholder="Pago a cuenta"
                className="mt-1 block h-11 w-full rounded-lg border border-linea bg-background px-3 text-base text-foreground"
              />
            </label>
          )}

          {estado.error && !(abierta && abierta === dondeAbrir) && !(opciones.length > 0 && sucursal) && (
            <p role="alert" className="estado-problema text-base font-medium">
              {estado.error}
            </p>
          )}

          {opciones.length > 0 && (
            <div role="radiogroup" aria-label="Caja" className="flex flex-wrap gap-2">
              {opciones.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={sucursal === o.id}
                  onClick={() => setSucursal(o.id)}
                  className={`h-12 rounded-xl px-4 text-base font-semibold transition-colors ${
                    sucursal === o.id ? "boton-accion" : "tarjeta-hundida hover:bg-hundida"
                  }`}
                >
                  {o.nombre}
                </button>
              ))}
            </div>
          )}

          {pideAbrir && (
            <div className="tarjeta-hundida flex flex-wrap items-end gap-2.5 rounded-xl p-3">
              <label className="min-w-40 flex-1 text-sm text-muted-foreground">
                Fondo inicial
                <input
                  inputMode="decimal"
                  value={fondoVisto}
                  onChange={(e) => {
                    setFondo(e.target.value);
                    setFondoMal(false);
                  }}
                  aria-invalid={fondoMal || undefined}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      abrirLaCaja();
                    }
                  }}
                  autoFocus
                  className={`tabular mt-1 block h-11 w-full rounded-lg border bg-background px-3 text-base text-foreground ${
                    fondoMal ? "border-[var(--estado-acento)] estado-problema" : "border-linea"
                  }`}
                />
              </label>
              <button
                type="button"
                onClick={abrirLaCaja}
                disabled={abriendo}
                className="inline-flex h-11 items-center gap-2 rounded-lg border px-4 text-base font-medium hover:bg-muted disabled:opacity-50"
              >
                {abriendo && <Loader2 className="h-4 w-4 animate-spin" />}
                Abrir caja
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={pendiente}
            className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg text-base font-semibold disabled:opacity-60"
          >
            {pendiente && <Loader2 className="h-5 w-5 animate-spin" />}
            Registrar y emitir recibo
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
