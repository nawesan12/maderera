"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Loader2,
  PenLine,
  Printer,
  Truck,
  TriangleAlert,
} from "lucide-react";
import {
  anularRemito,
  prepararRemito,
  type EstadoEntrega,
} from "../entregas-actions";
import { fechaHora, formatearMonto } from "@/components/admin/formato";
import type { RenglonPendiente } from "@/lib/entregas";
import { formatearCantidad, llevaDecimales } from "@/lib/unidades";
import { cantidadConUnidad, plural } from "@/lib/formato";
import { seOfreceLaFirma } from "@/lib/entregas/firma";
import type { OtroAcopio, RemitoListado } from "@/lib/dal/admin/entregas";
import { MandarPorWhatsapp } from "@/app/admin/whatsapp/mandar-por-whatsapp";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import type { AvisoManualListo } from "@/lib/whatsapp/aviso-manual-datos";
import { CampoPin } from "@/components/autorizacion/campo-pin";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DialogoCobro } from "@/components/cobros/dialogo-cobro";
import type { MedioDeCobro } from "@/lib/cobros/partes";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const inicial: EstadoEntrega = {};

/**
 * Acopio: lo que el cliente compró y todavía no se llevó.
 *
 * En una maderera esto es la mitad del mostrador. Se compra la obra entera, se
 * paga, y el material sale de a poco durante semanas. La pregunta que aparece
 * todo el tiempo —"¿cuánto me queda por retirar?"— tiene que responderse sin
 * revisar papeles.
 *
 * El orden (mes simulado, 26/11/2026): arriba lo que queda, grande, con
 * «Preparar remito» al lado; después el último remito con «Firmar» a mano; lo
 * que ya salió entero y los remitos viejos, plegados. Antes cada renglón
 * retirado ocupaba lo mismo que el que faltaba y «Preparar remito» quedaba
 * debajo de cinco remitos con sus botones.
 */
export function Entregas({
  orderId,
  tipoEntrega,
  estado,
  pendientes,
  remitos,
  otros = [],
  receptor,
  abrir = false,
  whatsapp = false,
  avisos = {},
  sinCobrar = null,
  cobro = null,
}: {
  orderId: string;
  tipoEntrega: string;
  /** El estado del pedido: cancelado no ofrece nada. */
  estado: string;
  pendientes: RenglonPendiente[];
  remitos: RemitoListado[];
  /** Lo que el mismo cliente tiene en acopio en otros pedidos (la misma visita). */
  otros?: OtroAcopio[];
  /** Quién figura como contacto: precarga «quién retira». */
  receptor?: string | null;
  /** Llegó desde «Preparar remito» del tablero: el formulario abierto. */
  abrir?: boolean;
  /** Si quien mira puede usar la bandeja: depósito ve los remitos, pero no manda WhatsApp. */
  whatsapp?: boolean;
  /** El aviso gratis de cada remito, por id. */
  avisos?: Record<string, AvisoManualListo>;
  /**
   * Lo que falta cobrar del pedido (la regla de «Me deben»). Un retiro sin
   * cobrar pregunta antes de generar el remito, como «Marcar entregado»
   * (mes simulado: con «Generar remito» salía sin aviso).
   */
  sinCobrar?: { numero: string; monto: number } | null;
  /** Para cobrar ahí mismo; sin esto (el depósito) solo se entrega o no. */
  cobro?: { numero: string; aCobrar: number; customerId: string | null; nombre: string; medio?: MedioDeCobro } | null;
}) {
  const cancelado = estado === "cancelado";
  const envio = tipoEntrega === "envio";
  const [abierto, setAbierto] = useState(abrir);
  // «Preparar remito» del encabezado llega como `?remito=1` con la ficha ya
  // abierta: se abre el formulario al cambiar (ajuste al renderizar).
  const [abrirVisto, setAbrirVisto] = useState(abrir);
  if (abrir !== abrirVisto) {
    setAbrirVisto(abrir);
    if (abrir) setAbierto(true);
  }
  // El remito recién hecho: su fila lleva «Firmar» grande y resaltado, en
  // vez de un cartel aparte que repetía los mismos dos botones.
  const [recien, setRecien] = useState<string | null>(null);

  // Entregado (la venta directa del mostrador, que salió al cobrar) o
  // cancelado, no queda nada por retirar: decía «Quedan 1 de 1 renglones»
  // de un pedido entregado (mes simulado).
  const conSaldo = cancelado || estado === "entregado" ? [] : pendientes.filter((p) => p.pendiente > 0.01);
  const hayAcopio = conSaldo.length > 0;
  const entregadoAlgo = pendientes.some((p) => p.entregado > 0);
  const vivos = remitos.filter((r) => r.estado !== "anulada");
  // Un envío con remitos sin firmar está en la calle: no está entregado
  // hasta que firma quien recibe (decía «Todo entregado» con el pedido en
  // camino, mes simulado).
  const enLaCalle = envio && estado === "en-camino";
  const [ultimo, ...anteriores] = remitos;

  // Un pedido cancelado sin remitos no tiene nada que mostrar acá.
  if (cancelado && remitos.length === 0) return null;
  // Un pedido sin nada entregado y sin acopio (todo salió con la venta).
  if (!hayAcopio && remitos.length === 0) return null;

  const enAcopio = envio ? "Falta llevar" : "En acopio";

  return (
    <section id="remito" className="tarjeta scroll-mt-24 overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {envio ? "Entregas" : "Entregas y acopio"}
        </h2>
        {!cancelado && (
          <p className="text-base text-muted-foreground">
            {hayAcopio
              ? `${plural(conSaldo.length, "renglón", "renglones")} por ${envio ? "llevar" : "retirar"}`
              : enLaCalle
                ? "Todo en camino"
                : vivos.length > 0
                  ? "Todo entregado"
                  : null}
          </p>
        )}
      </div>

      {/* Lo que queda, grande: es lo único que se pregunta en el mostrador. */}
      {hayAcopio && !abierto && (
        <ul className="mt-3 space-y-1 px-5">
          {conSaldo.map((p) => (
            <li key={p.orderItemId} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-base">{p.descripcion}</span>
              <span className="tabular shrink-0 text-lg font-semibold">{cantidadConUnidad(p.pendiente, p.unidad, p.descripcion)}</span>
            </li>
          ))}
        </ul>
      )}

      {hayAcopio && (
        <div className="px-5 py-4">
          {!abierto ? (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium"
            >
              <FileText className="h-5 w-5" />
              Preparar remito
            </button>
          ) : (
            <FormularioDeRemito
              orderId={orderId}
              tipoEntrega={tipoEntrega}
              conSaldo={conSaldo}
              otros={envio ? [] : otros}
              receptor={receptor ?? ""}
              sinCobrar={envio || cancelado ? null : sinCobrar}
              cobro={cobro}
              alCerrar={() => setAbierto(false)}
              alGenerar={(numero) => {
                setAbierto(false);
                setRecien(numero);
              }}
            />
          )}
        </div>
      )}

      {/* Los otros acopios del cliente, aunque el formulario esté cerrado:
          era lo que no se veía en ningún lado. */}
      {!envio && !cancelado && otros.length > 0 && !abierto && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-5 pb-4 text-base text-muted-foreground">
          {otros.map((o) => (
            <Link key={o.orderId} href={`/admin/pedidos/${o.orderId}`} className="codigo hover:text-brand-orange">
              {o.numero}
            </Link>
          ))}
          <span>{plural(otros.reduce((s, o) => s + o.renglones.length, 0), "renglón", "renglones")} más en acopio</span>
        </p>
      )}

      {ultimo && (
        <ul className="border-t">
          <FilaRemito
            remito={ultimo}
            orderId={orderId}
            whatsapp={whatsapp}
            aviso={avisos[ultimo.id] ?? null}
            destacado={recien === ultimo.numero || seOfreceLaFirma(ultimo)}
            envio={envio}
          />
        </ul>
      )}

      {anteriores.length > 0 && (
        <details className="group border-t">
          <summary className="flex h-12 cursor-pointer list-none items-center gap-2 px-5 text-base text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            {plural(anteriores.length, "remito anterior", "remitos anteriores")}
          </summary>
          <ul className="divide-y border-t">
            {anteriores.map((remito) => (
              <FilaRemito
                key={remito.id}
                remito={remito}
                orderId={orderId}
                whatsapp={whatsapp}
                aviso={avisos[remito.id] ?? null}
                envio={envio}
              />
            ))}
          </ul>
        </details>
      )}

      {/* Renglón por renglón, plegado: lo pedido, lo entregado y lo que falta. */}
      {entregadoAlgo && (
        <details className="group border-t">
          <summary className="flex h-12 cursor-pointer list-none items-center gap-2 px-5 text-base text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            Renglón por renglón
          </summary>
          <table className="w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-2.5 text-sm font-medium text-muted-foreground">Producto</th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Pedido</th>
                <th className="px-4 py-2.5 text-right text-sm font-medium text-muted-foreground">Entregado</th>
                <th className="px-5 py-2.5 text-right text-sm font-medium text-muted-foreground">{enAcopio}</th>
              </tr>
            </thead>
            <tbody>
              {pendientes.map((p) => (
                <tr key={p.orderItemId} className="border-b last:border-0">
                  <td className="px-5 py-3 text-base">{p.descripcion}</td>
                  <td className="tabular px-4 py-3 text-right text-base text-muted-foreground">{p.pedido}</td>
                  <td className="tabular px-4 py-3 text-right text-base text-muted-foreground">{p.entregado}</td>
                  <td className={`tabular px-5 py-3 text-right text-base ${p.pendiente > 0 ? "font-semibold" : "text-muted-foreground"}`}>
                    {p.pendiente}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

/**
 * El remito por preparar. Las cantidades vienen con todo lo pendiente porque
 * el caso más común es llevarse el resto; quien retira una parte corrige el
 * número.
 *
 * Los campos son controlados y el envío no pasa por `<form action>`: con un
 * error («Falta el documento») React reseteaba el formulario, las cantidades
 * volvían a «todo lo que queda» y el nombre se borraba; completar solo el DNI
 * y reenviar entregaba todo el acopio (mes simulado).
 */
function FormularioDeRemito({
  orderId,
  tipoEntrega,
  conSaldo,
  otros,
  receptor,
  sinCobrar,
  cobro,
  alCerrar,
  alGenerar,
}: {
  orderId: string;
  tipoEntrega: string;
  conSaldo: RenglonPendiente[];
  otros: OtroAcopio[];
  receptor: string;
  sinCobrar: { numero: string; monto: number } | null;
  cobro: { numero: string; aCobrar: number; customerId: string | null; nombre: string; medio?: MedioDeCobro } | null;
  alCerrar: () => void;
  alGenerar: (numero: string) => void;
}) {
  const [estado, preparar, preparando] = useActionState(prepararRemito, inicial);
  // Arranca en lo que queda, o en lo que hay en el galpón si no alcanza
  // (mes simulado 2: proponía 4 lacas con 3 en el estante, y salía igual).
  const [cantidades, setCantidades] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      conSaldo.map((p) => [
        p.orderItemId,
        String(p.enElGalpon !== undefined && p.enElGalpon < p.pendiente ? Math.max(Math.floor(p.enElGalpon * 1000) / 1000, 0) : p.pendiente),
      ]),
    ),
  );
  // Lo de los otros acopios arranca en cero: se suma lo que se lleva.
  const [deOtros, setDeOtros] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState({ receptorNombre: receptor, receptorDocumento: "", transportista: "", numeroSeguimiento: "" });
  const envio = tipoEntrega === "envio";
  // Sin cobrar: se pregunta antes de que salga la mercadería.
  const debe = sinCobrar != null && sinCobrar.monto > 0.009;
  const [preguntando, setPreguntando] = useState(false);
  const [cobrando, setCobrando] = useState(false);

  // Hecho el remito: se cierra el formulario y el remito nuevo queda arriba
  // con «Firmar» a mano.
  const visto = useRef(estado);
  useEffect(() => {
    if (estado === visto.current) return;
    visto.current = estado;
    if (estado.ok && estado.numero) {
      toast.success(estado.ok);
      alGenerar(estado.numero);
    }
  }, [estado, alGenerar]);

  const conDecimales = (p: RenglonPendiente, valor: string) =>
    Boolean(p.enteros) && llevaDecimales(valor) && valor !== String(p.pendiente);
  const malEscritos = conSaldo.filter((p) => conDecimales(p, cantidades[p.orderItemId] ?? ""));
  // Más de lo que hay en el galpón no sale: Go lo frena igual.
  const pasaElGalpon = (p: RenglonPendiente, valor: string) =>
    p.enElGalpon !== undefined && Number(valor.replace(",", ".")) > Math.max(p.enElGalpon, 0) + 0.0005;
  const sinStock = [
    ...conSaldo.filter((p) => pasaElGalpon(p, cantidades[p.orderItemId] ?? "")),
    ...otros.flatMap((o) => o.renglones.filter((p) => pasaElGalpon(p, deOtros[`otro-${o.orderId}-${p.orderItemId}`] ?? ""))),
  ];
  // El PIN de un admin para soltar lo que no se cobró, cuando Go lo pide.
  const [pin, setPin] = useState<{ visto: EstadoEntrega; abierto: boolean }>({ visto: inicial, abierto: false });
  if (estado.autorizacion && pin.visto !== estado) setPin({ visto: estado, abierto: true });

  function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (preparando || malEscritos.length > 0 || sinStock.length > 0) return;
    if (debe) {
      setPreguntando(true);
      return;
    }
    generar();
  }

  function generar(conPin?: string) {
    const datos = new FormData();
    if (conPin) datos.set("pin", conPin);
    datos.set("orderId", orderId);
    datos.set("tipo", tipoEntrega);
    for (const [id, valor] of Object.entries(cantidades)) datos.set(`cantidad-${id}`, valor);
    for (const [clave, valor] of Object.entries(deOtros)) datos.set(clave, valor);
    for (const [k, v] of Object.entries(campos)) if (v.trim()) datos.set(k, v);
    startTransition(() => preparar(datos));
  }

  return (
    <>
    <form onSubmit={enviar} className="space-y-4">
      <div className="space-y-2">
        {conSaldo.map((p) => (
          <RenglonACantidad
            key={p.orderItemId}
            id={`cantidad-${p.orderItemId}`}
            renglon={p}
            valor={cantidades[p.orderItemId] ?? ""}
            alCambiar={(v) => setCantidades((c) => ({ ...c, [p.orderItemId]: v }))}
            mal={conDecimales(p, cantidades[p.orderItemId] ?? "")}
            sinStock={pasaElGalpon(p, cantidades[p.orderItemId] ?? "")}
          />
        ))}
      </div>

      {/* La misma visita se lleva de los otros acopios del cliente: un
          remito por pedido, una sola firma. */}
      {otros.map((o) => (
        <fieldset key={o.orderId} className="space-y-2">
          <legend className="mb-1 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            También de <span className="codigo normal-case tracking-normal">{o.numero}</span>
          </legend>
          {o.renglones.map((p) => {
            const clave = `otro-${o.orderId}-${p.orderItemId}`;
            return (
              <RenglonACantidad
                key={clave}
                id={clave}
                renglon={p}
                valor={deOtros[clave] ?? ""}
                placeholder="0"
                alCambiar={(v) => setDeOtros((c) => ({ ...c, [clave]: v }))}
                mal={conDecimales(p, deOtros[clave] ?? "")}
                sinStock={pasaElGalpon(p, deOtros[clave] ?? "")}
              />
            );
          })}
        </fieldset>
      ))}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          nombre="receptorNombre"
          etiqueta={envio ? "Quién recibe" : "Quién retira"}
          valor={campos.receptorNombre}
          alCambiar={(v) => setCampos((c) => ({ ...c, receptorNombre: v }))}
          maximo={120}
        />
        <Campo
          nombre="receptorDocumento"
          etiqueta="Documento"
          valor={campos.receptorDocumento}
          alCambiar={(v) => setCampos((c) => ({ ...c, receptorDocumento: v }))}
          maximo={30}
          // En el retiro es obligatorio: sin el documento la firma no identifica a nadie.
          obligatorio={!envio}
          enfocar={Boolean(campos.receptorNombre)}
        />
        {envio && (
          <>
            <Campo
              nombre="transportista"
              etiqueta="Transportista"
              valor={campos.transportista}
              alCambiar={(v) => setCampos((c) => ({ ...c, transportista: v }))}
              maximo={80}
            />
            <Campo
              nombre="numeroSeguimiento"
              etiqueta="Número de seguimiento"
              valor={campos.numeroSeguimiento}
              alCambiar={(v) => setCampos((c) => ({ ...c, numeroSeguimiento: v }))}
              maximo={60}
            />
          </>
        )}
      </div>

      {estado.error && !estado.autorizacion && (
        <p role="alert" className="flex items-start gap-2 text-base text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={preparando || malEscritos.length > 0 || sinStock.length > 0}
          className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium disabled:opacity-60"
        >
          {preparando && <Loader2 className="h-4 w-4 animate-spin" />}
          {sinStock.length > 0 ? "No alcanza el galpón" : "Generar remito"}
        </button>
        <button
          type="button"
          onClick={alCerrar}
          className="inline-flex h-11 items-center rounded-lg px-4 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
    </form>

      {/* Fuera del <form>: el submit del cobro (otro form, en un portal)
          sube por el árbol de React y lo frenaba el de este. */}
      {debe && sinCobrar && (
        <Dialog open={preguntando} onOpenChange={setPreguntando}>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>
                {sinCobrar.numero} sin cobrar · <span className="tabular">{formatearMonto(sinCobrar.monto)}</span>
              </DialogTitle>
            </DialogHeader>
            {/* Lo mismo que «Marcar entregado»: quien cobra tiene a mano
                cobrar y entregar; quien no, no soltar la mercadería. */}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              {!cobro && (
                <button
                  type="button"
                  autoFocus
                  onClick={() => setPreguntando(false)}
                  className="inline-flex h-11 items-center rounded-lg px-4 text-base font-medium hover:bg-hundida"
                >
                  Mejor no
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPreguntando(false);
                  generar();
                }}
                className={`inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium ${
                  cobro ? "hover:bg-hundida" : "estado-problema border"
                }`}
              >
                Entregar sin cobrar
              </button>
              {cobro && (
                <button
                  type="button"
                  autoFocus
                  onClick={() => {
                    setPreguntando(false);
                    setCobrando(true);
                  }}
                  className="boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-4 text-base font-medium"
                >
                  Cobrar <span className="tabular">{formatearMonto(sinCobrar.monto)}</span> y entregar
                </button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      {estado.autorizacion && (
        <Dialog open={pin.abierto} onOpenChange={(v) => !preparando && setPin((x) => ({ ...x, abierto: v }))}>
          <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{sinCobrar ? `${sinCobrar.numero} sin cobrar` : "Sin cobrar"}</DialogTitle>
            </DialogHeader>
            <CampoPin
              autorizacion={estado.autorizacion}
              enviando={preparando}
              onEnviar={(clave) => generar(clave)}
              onCancelar={() => setPin((x) => ({ ...x, abierto: false }))}
            />
          </DialogContent>
        </Dialog>
      )}

      {debe && sinCobrar && cobro && (
        <DialogoCobro
          sinBoton
          abierto={cobrando}
          alCambiarAbierto={setCobrando}
          customerId={cobro.customerId}
          nombre={cobro.nombre}
          aCobrar={sinCobrar.monto}
          medio={cobro.medio}
          pedido={{ id: orderId, numero: cobro.numero }}
          alCobrar={() => generar()}
        />
      )}
    </>
  );
}

/** Un renglón con su cantidad a entregar. */
function RenglonACantidad({
  id,
  renglon: p,
  valor,
  alCambiar,
  mal,
  sinStock = false,
  placeholder,
}: {
  id: string;
  renglon: RenglonPendiente;
  valor: string;
  alCambiar: (v: string) => void;
  /** Lo que no se fracciona va entero (T4, hallazgo 21). */
  mal: boolean;
  /** Pasa lo que hay en el galpón. */
  sinStock?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={id} className="min-w-0 flex-1 basis-48 text-base">
        {p.descripcion}
        <span className="block text-muted-foreground">
          {p.pendiente === 1 ? "Queda" : "Quedan"} {cantidadConUnidad(p.pendiente, p.unidad, p.descripcion)}
          {/* Lo que hay en el estante, para no prometer lo que no está (mes
              simulado, H218). */}
          {/* De una media placa, el galpón en placas, como en Stock: «66 en
              el galpón» eran 33 placas (mes simulado 2). */}
          {p.enElGalpon !== undefined && (
            <span className={`tabular ${p.enElGalpon < p.pendiente ? "font-medium text-destructive" : ""}`}>
              {" "}
              ·{" "}
              {p.galponEnStock !== undefined
                ? cantidadConUnidad(Math.max(p.galponEnStock, 0), "placa")
                : formatearCantidad(Math.max(p.enElGalpon, 0))}{" "}
              en el galpón
            </span>
          )}
        </span>
      </label>
      <Input
        id={id}
        /* Qué se fracciona lo dice Go por la unidad del producto
           (`enteros`). La coma no se frena en silencio: se marca y no se
           prepara el remito hasta corregirla. */
        inputMode={p.enteros ? "numeric" : "decimal"}
        value={valor}
        placeholder={placeholder}
        onChange={(e) => alCambiar(e.target.value)}
        aria-invalid={mal || sinStock || undefined}
        aria-describedby={mal ? `${id}-entero` : undefined}
        className="tabular h-11 w-28 text-right text-base"
      />
      {mal && (
        <span id={`${id}-entero`} className="estado-problema w-full text-sm font-semibold">
          Va sin decimales
        </span>
      )}
    </div>
  );
}

function FilaRemito({
  remito,
  orderId,
  whatsapp,
  aviso,
  destacado = false,
  envio,
}: {
  remito: RemitoListado;
  orderId: string;
  whatsapp: boolean;
  aviso: AvisoManualListo | null;
  /** El último, sin firmar o recién hecho: «Firmar» es lo principal. */
  destacado?: boolean;
  envio: boolean;
}) {
  const anulado = remito.estado === "anulada";
  const firmable = seOfreceLaFirma(remito);

  return (
    <li className={`space-y-3 px-5 py-4 ${destacado && firmable ? "bg-brand-orange/5" : ""}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-2">
          <span className={`codigo ${anulado ? "line-through" : ""}`}>{remito.numero}</span>
          {/* Completo o de acopio: lo calcula Go con lo que quedaba al
              hacerlo, lo mismo que sale en el PDF. */}
          <span className="text-sm text-muted-foreground">
            {remito.reposicion
              ? `Reposición sin cargo · ${remito.reposicion}`
              : remito.parcial
                ? "Entrega parcial"
                : "Entrega total"}
          </span>
        </span>
        {anulado ? (
          <span className="text-base text-muted-foreground">Anulado</span>
        ) : remito.firmadoAt ? (
          <span className="inline-flex items-center gap-1.5 text-base font-medium text-brand-green">
            <PenLine className="h-4 w-4" aria-hidden="true" />
            Firmado
          </span>
        ) : (
          <span className="estado-espera text-base font-medium">Sin firmar</span>
        )}
      </div>

      <p className="text-base text-muted-foreground">
        {remito.tipo === "envio" ? (
          <span className="inline-flex items-center gap-1.5">
            <Truck className="h-4 w-4" aria-hidden="true" />
            {remito.transportista ?? "Envío"}
            {remito.numeroSeguimiento && ` · ${remito.numeroSeguimiento}`}
          </span>
        ) : (
          `Retiro${remito.receptorNombre ? ` · ${remito.receptorNombre}` : ""}`
        )}
        {" · "}
        {fechaHora.format(remito.createdAt)}
      </p>

      {/* Firmar primero y grande; después lo que se hace con el papel; anular
          al final, aparte. */}
      <div className="flex flex-wrap items-center gap-2">
        {firmable && <LinkDeFirma ruta={`/firmar/${remito.firmaToken}`} orderId={orderId} principal={destacado} />}
        <a
          href={`/remito/${remito.id}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </a>
        <a
          href={`/api/remitos/${remito.id}/pdf`}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          PDF
        </a>
        {whatsapp && !anulado && <MandarPorWhatsapp tipo="remito" id={remito.id} compacto />}
        {!anulado && <AnularRemito remito={remito} orderId={orderId} envio={envio} />}
      </div>

      {aviso && <AvisarPorWhatsapp aviso={aviso} compacto />}
    </li>
  );
}

/**
 * Anular un remito. Uno firmado pide por qué y, si quien anula no es admin,
 * el PIN de un admin: el cliente ya firmó que se lo llevó, y anularlo
 * devuelve la mercadería al stock (mes simulado: el depósito lo anulaba con
 * un toque).
 */
function AnularRemito({ remito, orderId, envio }: { remito: RemitoListado; orderId: string; envio: boolean }) {
  const [estado, anular, anulando] = useActionState(anularRemito, inicial);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const firmado = Boolean(remito.firmadoAt);

  // Anulado, el diálogo se cierra (ajuste al renderizar) y avisa.
  const [visto, setVisto] = useState(estado);
  if (estado !== visto) {
    setVisto(estado);
    if (estado.ok) setAbierto(false);
  }
  useEffect(() => {
    if (estado.ok) toast.success(estado.ok);
  }, [estado]);

  function mandar(pin?: string) {
    const datos = new FormData();
    datos.set("deliveryId", remito.id);
    datos.set("orderId", orderId);
    if (motivo.trim()) datos.set("motivo", motivo.trim());
    if (pin) datos.set("pin", pin);
    startTransition(() => anular(datos));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        className="ml-auto inline-flex h-10 items-center rounded-lg px-3 text-base font-medium text-muted-foreground hover:bg-hundida hover:text-foreground"
      >
        Anular
      </button>
      <Dialog open={abierto} onOpenChange={(v) => !anulando && setAbierto(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Anular el remito <span className="tabular whitespace-nowrap">{remito.numero}</span>
            </DialogTitle>
          </DialogHeader>
          <p className="text-base text-muted-foreground">
            {envio ? "La mercadería vuelve al depósito." : "La mercadería vuelve al depósito y el pedido la vuelve a esperar."}
          </p>
          {firmado && (
            <div className="space-y-1.5">
              <label htmlFor={`motivo-${remito.id}`} className="text-base font-medium">
                Por qué
              </label>
              <Textarea
                id={`motivo-${remito.id}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={300}
                rows={2}
                autoFocus
                aria-invalid={estado.campo === "motivo" || undefined}
              />
            </div>
          )}
          {estado.error && !estado.autorizacion && (
            <p role="alert" className="text-base text-destructive">
              {estado.error}
            </p>
          )}
          {estado.autorizacion ? (
            <CampoPin
              autorizacion={estado.autorizacion}
              enviando={anulando}
              onEnviar={(pin) => mandar(pin)}
              onCancelar={() => setAbierto(false)}
            />
          ) : (
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="h-11 rounded-lg px-4 text-base font-medium hover:bg-hundida"
              >
                Mejor no
              </button>
              <button
                type="button"
                disabled={anulando || (firmado && !motivo.trim())}
                onClick={() => mandar()}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-destructive px-4 text-base font-medium text-white disabled:opacity-50"
              >
                {anulando && <Loader2 className="h-4 w-4 animate-spin" />}
                Anular el remito
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * El link para firmar.
 *
 * Se copia y se manda por WhatsApp, o se abre acá mismo para que el cliente
 * firme en la tablet del mostrador. Se abre en la misma pestaña y lleva de
 * vuelta al pedido: en la tablet, la página de firma terminaba en la
 * constancia sin salida al panel (mes simulado).
 */
function LinkDeFirma({ ruta, orderId, principal }: { ruta: string; orderId: string; principal: boolean }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${ruta}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin portapapeles, queda el botón de abrir.
    }
  }

  return (
    <>
      <Link
        href={`${ruta}?volver=${encodeURIComponent(`/admin/pedidos/${orderId}`)}`}
        className={
          principal
            ? "boton-accion inline-flex h-11 items-center gap-2 rounded-lg px-5 text-base font-semibold"
            : "inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium"
        }
      >
        <PenLine className="h-5 w-5" aria-hidden="true" />
        Firmar
      </Link>
      <button
        type="button"
        onClick={copiar}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium"
      >
        {copiado ? <Check className="h-4 w-4 text-brand-green" /> : <Copy className="h-4 w-4" />}
        {copiado ? "Copiado" : "Copiar enlace"}
      </button>
    </>
  );
}

function Campo({
  nombre,
  etiqueta,
  valor,
  alCambiar,
  maximo,
  obligatorio = false,
  enfocar = false,
}: {
  nombre: string;
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  maximo: number;
  obligatorio?: boolean;
  enfocar?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={nombre} className="block text-base font-medium">
        {etiqueta}
      </label>
      <Input
        id={nombre}
        name={nombre}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        maxLength={maximo}
        required={obligatorio}
        autoFocus={enfocar}
        autoComplete="off"
        className="h-11 text-base"
      />
    </div>
  );
}
