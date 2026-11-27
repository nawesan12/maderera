"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, Mail, Package, PencilLine, ShoppingCart, X } from "lucide-react";
import {
  cambiarEstadoPresupuesto,
  convertirEnPedido,
  type MedioDelPedido,
} from "@/app/admin/ventas-actions";
import { MEDIOS_DEL_PEDIDO, Opciones } from "@/components/admin/opciones";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatearMonto } from "@/components/admin/formato";
import { CampoPin, type Autorizacion } from "@/components/autorizacion/campo-pin";
import { CampoFecha } from "@/components/ui/campo-fecha";
import { descuentoPorMedioDePago, montoDelDescuentoDePago, type EscalaDePago } from "@/lib/precios/medio-pago";

export interface ZonaParaPedido {
  nombre: string;
  costo: number;
  aCotizar: boolean;
}

/** Por qué se perdió: los mismos de Go (pedidos.MotivosDeRechazo). */
const MOTIVOS = ["Precio", "Se lo llevó otro", "No contestó", "Ya no lo necesita", "Otro"] as const;

/**
 * Cambia el estado y avisa qué pasó. El id del aviso es el del presupuesto:
 * dos clics seguidos no apilan dos avisos iguales (mes simulado).
 */
function useCambiarEstado(id: string) {
  const router = useRouter();
  const [pendiente, startTransition] = useTransition();
  function cambiar(estado: string, motivo?: string, despues?: () => void) {
    startTransition(async () => {
      const r = await cambiarEstadoPresupuesto(id, estado, motivo);
      if (r.error) toast.error(r.error, { id: `presupuesto-${id}` });
      else {
        toast.success(r.ok ?? "Listo.", { id: `presupuesto-${id}` });
        despues?.();
        router.refresh();
      }
    });
  }
  return { cambiar, pendiente };
}

/**
 * «Por correo»: pasa a enviado y Go le manda el aviso del presupuesto (el
 * correo con el detalle y, si está prendido en /admin/avisos, el WhatsApp).
 * Va con los otros canales en «Mandárselo», no entre las decisiones.
 */
export function EnviarAlCliente({ id }: { id: string }) {
  const { cambiar, pendiente } = useCambiarEstado(id);
  return (
    <button
      type="button"
      onClick={() => cambiar("enviado")}
      disabled={pendiente}
      className="inline-flex h-11 items-center gap-2 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
    >
      {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mail className="h-5 w-5" />}
      Por correo
    </button>
  );
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
  vencido = null,
  abrirPasar = false,
  credito = null,
  bajoCosto = 0,
  escalas = [],
  baseEscala = 0,
}: {
  /** Las escalas del descuento por forma de pago y sobre cuánto van. */
  escalas?: EscalaDePago[];
  baseEscala?: number;
  /** Pasó su validez: al pasarlo a pedido se eligen los precios. */
  vencido?: { totalDeHoy: number } | null;
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
  /**
   * Lo que el cliente tiene disponible en la cuenta corriente, para decirlo
   * al elegir «Cuenta corriente» y no después de crear (mes simulado). Go lo
   * vuelve a mirar.
   */
  credito?: { disponible: number; bloqueada: boolean } | null;
  /** Cuántos renglones quedan por debajo del costo. */
  bajoCosto?: number;
}) {
  const { cambiar, pendiente } = useCambiarEstado(id);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState<(typeof MOTIVOS)[number] | null>(null);

  if (pedido) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/pedidos/${pedido.id}`}
          className="boton-accion inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-base font-medium"
        >
          <Package className="h-5 w-5" aria-hidden="true" />
          Pedido <span className="tabular">{pedido.numero}</span>
        </Link>
        <Duplicar id={id} />
      </div>
    );
  }

  const decidible = ["pendiente", "revision", "enviado"].includes(estado);
  // Lo que todavía no vio el cliente se corrige en el lugar; lo demás se
  // duplica (mes simulado: un renglón equivocado obligaba a rechazarlo).
  const corregible = ["pendiente", "revision"].includes(estado);
  const pasable = estado === "aceptado" || decidible || estado === "vencido";

  return (
    <div className="flex flex-wrap items-center gap-2 [&>a]:whitespace-nowrap [&>button]:whitespace-nowrap">
      {pasable && (
        <PasarAPedido
          id={id}
          numero={numero}
          total={total}
          vencido={vencido}
          zonas={zonas}
          conCliente={conCliente}
          direccion={direccion ?? ""}
          destacado
          abierto={abrirPasar}
          credito={credito}
          bajoCosto={bajoCosto}
          escalas={escalas}
          baseEscala={baseEscala}
        />
      )}
      {decidible && estado !== "aceptado" && (
        <button
          onClick={() => cambiar("aceptado")}
          disabled={pendiente}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          {pendiente ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
          Aceptar
        </button>
      )}
      {corregible ? (
        <Link
          href={`/admin/presupuestos/nuevo?editar=${id}`}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <PencilLine className="h-5 w-5" aria-hidden="true" />
          Corregir
        </Link>
      ) : (
        <Duplicar id={id} />
      )}
      {decidible && (
        <>
          <button
            onClick={() => setRechazando(true)}
            disabled={pendiente}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-base font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-5 w-5" />
            Rechazar
          </button>
          {/* El motivo, de una lista: para ver después por qué se pierden
              las ventas (mes simulado). */}
          <Dialog
            open={rechazando}
            onOpenChange={(v) => {
              setRechazando(v);
              setMotivo(null);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>¿Por qué se perdió {numero}?</DialogTitle>
              </DialogHeader>
              <Opciones
                etiqueta="Por qué se perdió"
                valor={motivo}
                alCambiar={setMotivo}
                opciones={MOTIVOS.map((m) => ({ valor: m, texto: m }))}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRechazando(false)}
                  className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
                >
                  Mejor no
                </button>
                <button
                  type="button"
                  disabled={!motivo || pendiente}
                  onClick={() => motivo && cambiar("rechazado", motivo, () => setRechazando(false))}
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
                >
                  {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                  Rechazar
                </button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

/** Arranca uno nuevo con los mismos renglones (después de cancelar el pedido, o para corregir uno ya mandado). */
function Duplicar({ id }: { id: string }) {
  return (
    <Link
      href={`/admin/presupuestos/nuevo?desde=${id}`}
      className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-hundida px-3.5 text-base font-medium transition-colors hover:bg-muted"
    >
      <Copy className="h-5 w-5" aria-hidden="true" />
      Duplicar
    </Link>
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
  vencido,
  abierto: abiertoDeEntrada = false,
  credito,
  bajoCosto,
  escalas,
  baseEscala,
}: {
  escalas: EscalaDePago[];
  baseEscala: number;
  abierto?: boolean;
  id: string;
  numero: string;
  total: number;
  vencido: { totalDeHoy: number } | null;
  zonas: ZonaParaPedido[];
  conCliente: boolean;
  direccion: string;
  destacado: boolean;
  credito: { disponible: number; bloqueada: boolean } | null;
  bajoCosto: number;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(abiertoDeEntrada);
  const [pendiente, startTransition] = useTransition();
  const [tipo, setTipo] = useState<"retiro" | "envio">("retiro");
  const [direccion, setDireccion] = useState(direccionDelCliente);
  const [zona, setZona] = useState("");
  const [costo, setCosto] = useState("");
  const [sinCargo, setSinCargo] = useState(false);
  const [medio, setMedio] = useState<Medio | null>(null);
  /*
   * El pedido partido (H047): con «Cuenta corriente», lo que va a la cuenta
   * arranca en lo que el crédito deja (o el total) y se puede bajar; el resto
   * se paga con otro medio y se cobra desde el pedido.
   */
  const [parteTexto, setParteTexto] = useState("");
  const [medioResto, setMedioResto] = useState<Exclude<Medio, "cuenta_corriente"> | null>(null);
  const [entregarEl, setEntregarEl] = useState("");
  /*
   * Vencido: «Actualizar» (los precios de hoy) es lo de siempre y va
   * marcado; «Respetar» muestra lo que se deja de cobrar y, pasado lo
   * libre, pide el PIN de un admin.
   */
  const [precios, setPrecios] = useState<"actualizar" | "respetar">("actualizar");
  const [pidePin, setPidePin] = useState<Autorizacion | null>(null);
  const entrega = useRef<HTMLDivElement>(null);
  const totalBase = vencido && precios === "actualizar" ? vencido.totalDeHoy : total;

  const medios: { valor: Medio; texto: string }[] = [
    ...MEDIOS_DEL_PEDIDO,
    ...(conCliente ? [{ valor: "cuenta_corriente" as const, texto: "Cuenta corriente" }] : []),
  ];
  // «1.500» es mil quinientos y «1.500,50» lleva centavos: se sacan los
  // puntos de miles antes de leer la coma. Leído como venía, era $1,50.
  const costoLeido = Number(costo.trim().replace(/\./g, "").replace(",", "."));
  const hayCosto = costo.trim() !== "";
  const costoMal = tipo === "envio" && hayCosto && !(Number.isFinite(costoLeido) && costoLeido >= 0);
  const costoEnvio = tipo === "envio" && hayCosto && !costoMal ? costoLeido : 0;
  // Un envío sin flete no sale: se carga o se elige «Sin cargo» (mes
  // simulado: se creaban pedidos con envío y $0 de flete sin aviso).
  const faltaFlete = tipo === "envio" && !hayCosto && !sinCargo;
  const aCuenta = medio === "cuenta_corriente";
  // El descuento por forma de pago, el mismo que Go aplica al crear (y que
  // el mostrador hace en la venta): con «Transferencia» salía la lista.
  const base = total > 0 ? Math.round(baseEscala * (totalBase / total) * 100) / 100 : 0;
  const escala = medio && !aCuenta ? descuentoPorMedioDePago(escalas, medio, base) : null;
  const descuento = escala ? montoDelDescuentoDePago(base, escala.porcentaje) : 0;
  const totalPedido = Math.round((totalBase - descuento + costoEnvio) * 100) / 100;
  const disponible = credito && !credito.bloqueada ? Math.max(credito.disponible, 0) : null;
  const parteLeida = Number(parteTexto.trim().replace(/\./g, "").replace(",", "."));
  const parteMal = aCuenta && parteTexto.trim() !== "" && !(Number.isFinite(parteLeida) && parteLeida > 0);
  const parte = !aCuenta
    ? 0
    : parteTexto.trim() === "" || parteMal
      ? Math.min(totalPedido, disponible ?? totalPedido)
      : Math.min(parteLeida, totalPedido);
  const partido = aCuenta && parte > 0 && parte < totalPedido - 0.005;
  const resto = partido ? Math.round((totalPedido - parte) * 100) / 100 : 0;
  const faltaResto = partido && !medioResto;
  const pasaElLimite =
    aCuenta && credito !== null && (credito.bloqueada || parte <= 0 || parte > credito.disponible + 0.005);

  function elegirZona(nombre: string) {
    setZona(nombre);
    const z = zonas.find((x) => x.nombre === nombre);
    if (z && !z.aCotizar && z.costo > 0) {
      setCosto(String(z.costo).replace(".", ","));
      setSinCargo(false);
    }
  }

  function pasar(pin?: string) {
    startTransition(async () => {
      const r = await convertirEnPedido(id, {
        tipoEntrega: tipo,
        ...(tipo === "envio"
          ? { direccion, zona: zona || undefined, ...(hayCosto ? { costoEnvio } : {}), ...(sinCargo ? { sinCargo: true } : {}) }
          : {}),
        ...(partido
          ? { medioPago: medioResto ?? undefined, aCuenta: Math.round(parte * 100) / 100 }
          : { medioPago: medio ?? undefined }),
        entregarEl: entregarEl || undefined,
        ...(vencido ? { precios } : {}),
        ...(pin ? { pin } : {}),
      });
      if (r.autorizacion) {
        setPidePin(r.autorizacion);
        return;
      }
      if (r.error) {
        toast.error(r.error, { id: `pedido-${id}` });
        return;
      }
      toast.success(r.ok ?? "Pedido creado.", { id: `pedido-${id}` });
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
        className={`inline-flex h-11 items-center gap-1.5 whitespace-nowrap rounded-lg px-4 text-base font-medium transition-colors ${
          destacado ? "boton-accion" : "bg-hundida hover:bg-muted"
        }`}
      >
        <ShoppingCart className="h-5 w-5" />
        Pasar a pedido
      </button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Pasar {numero} a pedido</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {bajoCosto > 0 && (
              <p className="estado-problema flex items-center gap-2 rounded-lg bg-[var(--estado-fondo)] px-3 py-2 text-base font-medium text-[var(--estado-tinta)]">
                <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
                {bajoCosto === 1 ? "Un renglón va" : `${bajoCosto} renglones van`} por debajo del costo
              </p>
            )}

            {vencido && (
              <div className="space-y-2">
                <p className="text-base font-medium">Venció: los precios</p>
                <div role="radiogroup" aria-label="Los precios" className="grid gap-2 sm:grid-cols-2">
                  {[
                    { valor: "actualizar" as const, texto: "Actualizar", cifra: formatearMonto(vencido.totalDeHoy) },
                    {
                      valor: "respetar" as const,
                      texto: "Respetar",
                      cifra: `${total - vencido.totalDeHoy < 0 ? "−" : "+"}${formatearMonto(Math.abs(total - vencido.totalDeHoy))}`,
                    },
                  ].map((o) => (
                    <button
                      key={o.valor}
                      type="button"
                      role="radio"
                      aria-checked={precios === o.valor}
                      autoFocus={o.valor === "actualizar"}
                      onClick={() => {
                        setPrecios(o.valor);
                        setPidePin(null);
                      }}
                      // Enter elige y sigue a la entrega; no crea el pedido:
                      // con el foco puesto acá, un Enter de reflejo lo pasaba
                      // como retiro, sin medio ni fecha, y salteaba lo que
                      // deshabilita «Crear el pedido».
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setPrecios(o.valor);
                          setPidePin(null);
                          entrega.current?.querySelector<HTMLElement>("button, [role=radio]")?.focus();
                        }
                      }}
                      className={`flex h-14 items-center justify-between rounded-xl px-4 text-base font-semibold transition-colors ${
                        precios === o.valor ? "boton-accion" : "bg-hundida hover:bg-muted"
                      }`}
                    >
                      {o.texto}
                      <span className="tabular">{o.cifra}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={entrega} className="space-y-2">
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
                {/* La zona es una de las de reparto, elegida y no escrita: con
                    texto libre quedaba «Mar del Plata» como zona y el reparto
                    no la podía ubicar (mes simulado); la de costo fijo
                    propone el flete. */}
                {zonas.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-base font-medium">Zona</p>
                    <Opciones
                      etiqueta="Zona"
                      valor={zona || null}
                      alCambiar={elegirZona}
                      opciones={zonas.map((z) => ({ valor: z.nombre, texto: z.nombre }))}
                    />
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-40 space-y-1.5">
                    <Label
                      htmlFor="pedido-costo"
                      className={faltaFlete || costoMal ? "estado-problema text-[var(--estado-tinta)]" : undefined}
                    >
                      Flete
                    </Label>
                    <Input
                      id="pedido-costo"
                      inputMode="decimal"
                      value={costo}
                      disabled={sinCargo}
                      onChange={(e) => setCosto(e.target.value)}
                      aria-invalid={costoMal || faltaFlete || undefined}
                      className="tabular"
                    />
                  </div>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={sinCargo}
                    onClick={() => {
                      setSinCargo((v) => !v);
                      setCosto("");
                    }}
                    className={`h-10 rounded-lg px-3.5 text-base font-medium transition-colors ${
                      sinCargo ? "boton-accion" : "bg-hundida hover:bg-muted"
                    }`}
                  >
                    Sin cargo
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="pedido-entregar-el">
                {tipo === "envio" ? "Se entrega el" : "Lo retira el"}
              </Label>
              <CampoFecha
                Entrada={Input}
                id="pedido-entregar-el"
                value={entregarEl}
                onChange={(e) => setEntregarEl(e.target.value)}
                className="w-48"
              />
            </div>

            <div className="space-y-2">
              <p className="text-base font-medium">Cómo paga</p>
              <Opciones etiqueta="Cómo paga" valor={medio} alCambiar={setMedio} opciones={medios} />
              {aCuenta && credito?.bloqueada && (
                <p className="estado-problema text-base font-medium text-[var(--estado-tinta)]">
                  La cuenta corriente está bloqueada
                </p>
              )}
              {aCuenta && !credito?.bloqueada && (
                <div className="space-y-3 pt-1">
                  <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                    <div className="w-40 space-y-1.5">
                      <Label
                        htmlFor="pedido-a-cuenta"
                        className={pasaElLimite || parteMal ? "estado-problema text-[var(--estado-tinta)]" : undefined}
                      >
                        A cuenta
                      </Label>
                      <Input
                        id="pedido-a-cuenta"
                        inputMode="decimal"
                        value={parteTexto}
                        placeholder={formatearMonto(parte).replace(/^\$\s?/, "")}
                        onChange={(e) => setParteTexto(e.target.value)}
                        aria-invalid={pasaElLimite || parteMal || undefined}
                        className="tabular"
                      />
                    </div>
                    {disponible !== null && (
                      <p
                        className={`pb-2.5 text-base ${pasaElLimite ? "estado-problema font-medium text-[var(--estado-tinta)]" : "text-muted-foreground"}`}
                      >
                        Disponible <span className="tabular">{formatearMonto(disponible)}</span>
                      </p>
                    )}
                  </div>
                  {partido && (
                    <div className="space-y-2">
                      <p className="text-base font-medium">
                        El resto, <span className="tabular">{formatearMonto(resto)}</span>
                      </p>
                      <Opciones
                        etiqueta="Cómo paga el resto"
                        valor={medioResto}
                        alCambiar={setMedioResto}
                        opciones={[...MEDIOS_DEL_PEDIDO]}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {descuento > 0 && (
              <div className="flex items-baseline justify-between border-t border-linea pt-4">
                <span className="text-base text-muted-foreground">{escala?.etiqueta || "Descuento"}</span>
                <span className="tabular text-base">−{formatearMonto(descuento)}</span>
              </div>
            )}
            <div className={`flex items-baseline justify-between pt-4 ${descuento > 0 ? "" : "border-t border-linea"}`}>
              <span className="text-base text-muted-foreground">Total del pedido</span>
              <span className="tabular text-xl font-semibold">{formatearMonto(totalPedido)}</span>
            </div>

            {pidePin && (
              <CampoPin
                autorizacion={pidePin}
                enviando={pendiente}
                onEnviar={(pin) => pasar(pin)}
                onCancelar={() => setPidePin(null)}
              />
            )}

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
                disabled={
                  pendiente ||
                  costoMal ||
                  faltaFlete ||
                  pasaElLimite ||
                  parteMal ||
                  faltaResto ||
                  !medio ||
                  (tipo === "envio" && !direccion.trim())
                }
                onClick={() => pasar()}
                className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-50"
              >
                {pendiente && <Loader2 className="h-4 w-4 animate-spin" />}
                {/* El botón dice qué falta (mes simulado: se apagaba sin
                    decir por qué). */}
                {tipo === "envio" && !direccion.trim()
                  ? "Falta la dirección"
                  : faltaFlete
                    ? zonas.length > 0 && !zona
                      ? "Falta la zona"
                      : "Falta el flete"
                    : costoMal
                      ? "Revisá el flete"
                      : faltaResto
                        ? "Falta cómo paga el resto"
                        : !medio
                          ? "Falta cómo paga"
                          : "Crear el pedido"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
