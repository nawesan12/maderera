"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Package, Send, ShoppingCart, X } from "lucide-react";
import {
  cambiarEstadoPresupuesto,
  convertirEnPedido,
  type MedioDelPedido,
} from "@/app/admin/ventas-actions";
import { Confirmar } from "@/components/admin/confirmar";
import { MEDIOS_DEL_PEDIDO, Opciones } from "@/components/admin/opciones";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moneda } from "@/components/admin/formato";

export interface ZonaParaPedido {
  nombre: string;
  costo: number;
  aCotizar: boolean;
}

export function AccionesPresupuesto({
  id,
  numero,
  estado,
  total,
  pedido,
  zonas,
  conCliente,
  direccion,
  abrirPasar = false,
}: {
  /** Recién guardado con «Guardar y pasar a pedido»: el paso ya abierto. */
  abrirPasar?: boolean;
  id: string;
  numero: string;
  estado: string;
  total: number;
  /** El pedido en que ya se convirtió: en vez del botón, el enlace. */
  pedido: { id: string; numero: string } | null;
  zonas: ZonaParaPedido[];
  /** Sin cliente cargado no puede ir a cuenta corriente. */
  conCliente: boolean;
  direccion?: string | null;
}) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  const [rechazando, setRechazando] = useState(false);

  function accion(fn: () => Promise<{ ok?: string; error?: string }>, despues?: () => void) {
    startTransition(async () => {
      const resultado = await fn();
      if (resultado.error) toast.error(resultado.error);
      else {
        toast.success(resultado.ok ?? "Listo.");
        despues?.();
        router.refresh();
      }
    });
  }

  if (pedido) {
    return (
      <Link
        href={`/admin/pedidos/${pedido.id}`}
        className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
      >
        <Package className="h-5 w-5" aria-hidden="true" />
        Pedido <span className="tabular">{pedido.numero}</span>
      </Link>
    );
  }

  const decidible = ["pendiente", "revision", "enviado"].includes(estado);
  // Armado y revisado, se le manda: pasa a «enviado» y Go le avisa al
  // cliente por correo y por WhatsApp con el PDF (lo que esté prendido en
  // /admin/avisos).
  const enviable = ["pendiente", "revision"].includes(estado);

  return (
    <div className="flex flex-wrap items-center gap-2 [&>button]:whitespace-nowrap">
      {enviable && (
        <button
          onClick={() => accion(() => cambiarEstadoPresupuesto(id, "enviado"))}
          disabled={pendiente}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Send className="h-5 w-5" />
          Enviar al cliente
        </button>
      )}
      {decidible && (
        <>
          <button
            onClick={() => setRechazando(true)}
            disabled={pendiente}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
            Rechazar
          </button>
          <Confirmar
            abierto={rechazando}
            alCerrar={() => setRechazando(false)}
            titulo={`Rechazar el presupuesto ${numero}`}
            detalle="Pasa a cerrados. Si el cliente vuelve, se arma otro."
            confirmar="Rechazar"
            pendiente={pendiente}
            alConfirmar={() => accion(() => cambiarEstadoPresupuesto(id, "rechazado"), () => setRechazando(false))}
          />
          <button
            onClick={() => accion(() => cambiarEstadoPresupuesto(id, "aceptado"))}
            disabled={pendiente}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            Aceptar
          </button>
        </>
      )}

      {(estado === "aceptado" || decidible) && (
        <PasarAPedido
          id={id}
          numero={numero}
          total={total}
          zonas={zonas}
          conCliente={conCliente}
          direccion={direccion ?? ""}
          destacado={estado === "aceptado"}
          abierto={abrirPasar}
        />
      )}
    </div>
  );
}

type Medio = MedioDelPedido;

/**
 * Pasar a pedido preguntando lo que el pedido necesita para salir: si lo
 * retira o se lo llevan, adónde, y cómo paga. Antes el pedido nacía como
 * «retiro» y sin forma de pago, y no se podía corregir en ningún lado.
 */
function PasarAPedido({
  id,
  numero,
  total,
  zonas,
  conCliente,
  direccion: direccionDelCliente,
  destacado,
  abierto: abiertoDeEntrada = false,
}: {
  abierto?: boolean;
  id: string;
  numero: string;
  total: number;
  zonas: ZonaParaPedido[];
  conCliente: boolean;
  direccion: string;
  destacado: boolean;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abiertoDeEntrada);
  const [pendiente, startTransition] = useTransition();
  const [tipo, setTipo] = useState<"retiro" | "envio">("retiro");
  const [direccion, setDireccion] = useState(direccionDelCliente);
  const [zona, setZona] = useState("");
  const [costo, setCosto] = useState("");
  const [medio, setMedio] = useState<Medio | null>(null);

  const medios: { valor: Medio; texto: string }[] = [
    ...MEDIOS_DEL_PEDIDO,
    ...(conCliente ? [{ valor: "cuenta_corriente" as const, texto: "Cuenta corriente" }] : []),
  ];
  // «1.500» es mil quinientos y «1.500,50» lleva centavos: se sacan los
  // puntos de miles antes de leer la coma. Leído como venía, era $1,50.
  const costoLeido = Number(costo.trim().replace(/\./g, "").replace(",", "."));
  const costoMal = tipo === "envio" && costo.trim() !== "" && !(Number.isFinite(costoLeido) && costoLeido >= 0);
  const costoEnvio = tipo === "envio" && !costoMal ? costoLeido || 0 : 0;

  function elegirZona(nombre: string) {
    setZona(nombre);
    const z = zonas.find((x) => x.nombre === nombre);
    if (z && !z.aCotizar) setCosto(String(z.costo));
  }

  function pasar() {
    startTransition(async () => {
      const r = await convertirEnPedido(id, {
        tipoEntrega: tipo,
        ...(tipo === "envio" ? { direccion, zona: zona || undefined, costoEnvio } : {}),
        medioPago: medio ?? undefined,
      });
      if (r.error) {
        toast.error(r.error);
        return;
      }
      toast.success(r.ok ?? "Pedido creado.");
      setAbierto(false);
      if (r.id) router.push(`/admin/pedidos/${r.id}`);
      else router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className={`inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-base font-medium transition-colors ${
          destacado ? "boton-accion" : "border hover:bg-muted"
        }`}
      >
        <ShoppingCart className="h-5 w-5" />
        Pasar a pedido
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pasar {numero} a pedido</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-base font-medium">Entrega</p>
              <Opciones
                etiqueta="Entrega"
                valor={tipo}
                alCambiar={setTipo}
                opciones={[
                  { valor: "retiro", texto: "Lo retira" },
                  { valor: "envio", texto: "Se lo llevamos" },
                ]}
              />
            </div>

            {tipo === "envio" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pedido-direccion">Dirección</Label>
                  <Input
                    id="pedido-direccion"
                    value={direccion}
                    onChange={(e) => setDireccion(e.target.value)}
                    maxLength={300}
                    autoFocus
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
                  <div className="space-y-1.5">
                    <Label htmlFor="pedido-zona">Zona</Label>
                    <Input
                      id="pedido-zona"
                      list="pedido-zonas"
                      value={zona}
                      onChange={(e) => elegirZona(e.target.value)}
                      maxLength={120}
                    />
                    <datalist id="pedido-zonas">
                      {zonas.map((z) => (
                        <option key={z.nombre} value={z.nombre} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pedido-costo">Flete</Label>
                    <Input
                      id="pedido-costo"
                      inputMode="decimal"
                      value={costo}
                      onChange={(e) => setCosto(e.target.value)}
                      aria-invalid={costoMal}
                      className="tabular"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-base font-medium">Cómo paga</p>
              <Opciones etiqueta="Cómo paga" valor={medio} alCambiar={setMedio} opciones={medios} />
            </div>

            <div className="flex items-baseline justify-between border-t pt-4">
              <span className="text-base text-muted-foreground">Total del pedido</span>
              <span className="tabular text-xl font-semibold">{moneda.format(total + costoEnvio)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
              >
                Mejor no
              </button>
              <button
                type="button"
                disabled={pendiente || costoMal || (tipo === "envio" && !direccion.trim())}
                onClick={pasar}
                className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                Crear el pedido
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
