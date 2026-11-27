import type { Metadata } from "next";
import { enlaceWhatsapp } from "@/lib/whatsapp/enlace";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CargandoSitio } from "@/components/sitio/cargando";
import { existe } from "@/lib/dal/existencia";
import { sucursalPublicada } from "@/lib/sucursales";
import {
  ArrowRight,
  Check,
  Package,
  PackageCheck,
  PenLine,
  Store,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getSession } from "@/lib/dal/session";
import { pedidoParaSeguimiento } from "@/lib/dal/seguimiento";
import { cobroDelPedido, datosParaTransferir } from "@/lib/dal/pagos";
import { BloquePago } from "@/components/pagos/bloque-pago";
import { fechaCorta, formatearPrecio } from "@/lib/formato";
import { cuentasDelPedido } from "@/lib/cuenta/cuentas-del-pedido";
import { BotonWhatsapp } from "@/components/whatsapp/boton";
import { ZonaSinFlotante } from "@/components/whatsapp/zona-sin-flotante";

/*
 * El título se resuelve consultando, y no como constante, porque esta ruta cae
 * en no-encontrado cuando el número no existe o el enlace no trae token: con un
 * título fijo la pestaña decía "Pedido confirmado" sobre la pantalla que avisa
 * que no hay nada. La consulta está memoizada, así que no cuesta una de más.
 */
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ numero: string }>;
  searchParams: Promise<{ t?: string }>;
}): Promise<Metadata> {
  const [{ numero }, { t }] = await Promise.all([params, searchParams]);
  const pedido = await pedidoParaSeguimiento(numero, t);

  return {
    title: pedido ? `Pedido ${pedido.numero}` : "Pedido no encontrado",
    robots: { index: false, follow: false },
  };
}

/**
 * Un número para el build, que no existe.
 *
 * Con Cache Components, leer el parámetro de una ruta sin esta lista es un dato
 * por pedido, y obligaría a resolver el 404 detrás de un `<Suspense>` —que es
 * lo que lo dejaba en 200—. No se arma ningún pedido de antemano: el seguimiento
 * es de cada uno. El de muestra da 404 en el build y la ruta se verifica igual.
 */
export async function generateStaticParams() {
  return [{ numero: "0" }];
}

export default async function PedidoConfirmadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ numero: string }>;
  searchParams: Promise<{ t?: string }>;
}) {
  const { numero } = await params;

  // El 404 se decide acá, con la caché, antes de que salga el esqueleto: lo que
  // se resuelve detrás del `<Suspense>` ya no puede cambiar el código. Quién
  // puede ver el pedido —el token o la sesión— se sigue decidiendo adentro.
  if (!(await existe("pedido-por-numero", numero))) notFound();

  return (
    <Suspense fallback={<CargandoSitio />}>
      <Seguimiento numero={numero} searchParams={searchParams} />
    </Suspense>
  );
}

async function Seguimiento({
  numero,
  searchParams,
}: {
  numero: string;
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;

  // La consulta vive en el DAL, con el control de acceso adentro. Antes estaba
  // suelta acá y filtraba solo por número, que es consecutivo: alcanzaba con
  // contar para leer el pedido de cualquiera.
  const pedido = await pedidoParaSeguimiento(numero, t);

  if (!pedido) notFound();

  const items = pedido.items;

  const [sesion, estadoDelCobro, banco, whatsapp] = await Promise.all([
    getSession(),
    cobroDelPedido(pedido.numero, t),
    datosParaTransferir(),
    // Con el número puesto: es lo primero que se le pregunta a quien
    // escribe. Antes se le sumaba un segundo «?text=» al enlace.
    enlaceWhatsapp(`Hola! Consulto por mi pedido ${pedido.numero}.`),
  ]);
  const cobro = estadoDelCobro?.cobro ?? null;
  const rechazado = cobro?.estado === "rechazado";
  const cabecera = cabeceraDelEstado(pedido);
  const Icono = cabecera.icono;

  const sumaRenglones = items.reduce((s, i) => s + Number(i.subtotal), 0);
  const cuentas = cuentasDelPedido({
    sumaRenglones,
    descuento: pedido.descuento,
    costoEnvio: Number(pedido.costoEnvio ?? 0),
    total: Number(pedido.total),
  });
  // El descuento del medio de pago se dice como en el checkout («10% por
  // transferencia»): sin el renglón, Subtotal y Total no cerraban (M2S2-060).
  const porcentaje = Number(pedido.subtotal) > 0 ? Math.round((pedido.descuento / Number(pedido.subtotal)) * 100) : 0;
  // Con su nombre, como en la confirmación (M2S4-044), si lo tiene.
  const etiquetaDescuento =
    pedido.descuentoMotivo ??
    (pedido.medioPago === "transferencia" && porcentaje > 0 ? `${porcentaje}% por transferencia` : "Descuento");

  const pago = (
    <BloquePago
      numero={pedido.numero}
      token={pedido.publicToken}
      total={Number(pedido.total)}
      saldo={pedido.sinCobrar}
      estadoPedido={pedido.estado}
      medioPago={pedido.medioPago}
      estadoPago={pedido.estadoPago}
      cobro={
        cobro
          ? {
              estado: cobro.estado,
              proveedor: cobro.proveedor,
              monto: cobro.monto,
              comprobanteUrl: cobro.comprobanteUrl,
              motivoRechazo: cobro.motivoRechazo,
            }
          : null
      }
      banco={banco}
      enVivo={estadoDelCobro?.enVivo ?? false}
      disponible={estadoDelCobro?.disponible ?? false}
    />
  );

  return (
    <div className="min-h-screen bg-sitio-alt">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-12">
        {/* La cabecera dice en qué está el pedido: decía «Listo, recibimos
            tu pedido» y «Ya estamos preparando» a un pedido retirado y
            firmado (M2S1-103, M3S4-043). */}
        <div className="mb-8 text-center">
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full ${cabecera.fondo}`}>
            <Icono className="h-8 w-8 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-balance">{cabecera.titulo}</h1>
          <p className="mt-2 text-muted-foreground">
            {cabecera.bajada ?? (
              <>
                Pedido <span className="tabular font-semibold text-foreground">{pedido.numero}</span>
              </>
            )}
          </p>
        </div>

        {/* Un pago que no se aceptó va primero, con el motivo y el campo
            para subir otro comprobante (M3S2-014). */}
        {/* El WhatsApp flotante se va mientras se ve el pago: tapaba el borde
            de la tarjeta en el teléfono (M2S2-142). */}
        {rechazado && (
          <ZonaSinFlotante soloEnCelular className="mb-4">
            {pago}
          </ZonaSinFlotante>
        )}

        <Card className="border-0 shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <ul className="divide-y">
              {items.map((item) => (
                <li key={item.id} className="flex justify-between gap-4 py-3">
                  <span className="min-w-0">
                    <span className="tabular text-muted-foreground">
                      {Number(item.cantidad)}×
                    </span>{" "}
                    {item.descripcion}
                  </span>
                  <span className="tabular shrink-0">
                    {formatearPrecio(item.subtotal)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t pt-4 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">
                  {formatearPrecio(cuentas.restaElAhorro ? cuentas.subtotal : Number(pedido.subtotal))}
                </dd>
              </div>
              {cuentas.ahorro > 0 && (
                <div className="flex justify-between text-saldo-favor">
                  <dt>{etiquetaDescuento}</dt>
                  <dd className="tabular">−{formatearPrecio(cuentas.ahorro)}</dd>
                </div>
              )}
              {Number(pedido.costoEnvio) > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Envío</dt>
                  <dd className="tabular">
                    {formatearPrecio(pedido.costoEnvio)}
                  </dd>
                </div>
              )}
            </dl>

            <div className="mt-3 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">Total</span>
              <span className="tabular text-2xl font-bold">
                {formatearPrecio(pedido.total)}
              </span>
            </div>
          </CardContent>
        </Card>

        <section className="mt-4 rounded-xl bg-card p-5 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Entrega
          </h2>
          {pedido.tipoEntrega === "retiro" ? (
            <p className="flex items-start gap-2 text-sm">
              <Store className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {pedido.estado === "entregado" || pedido.estado === "por-firmar" ? "Retiraste en" : "Retirás en"} {pedido.sucursal}
                <span className="block text-muted-foreground">
                  {sucursalPublicada(pedido.sucursalSlug ?? "")?.direccion}
                </span>
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                {pedido.direccionEntrega}
                <span className="block text-muted-foreground">
                  {pedido.zonaEnvio}
                </span>
              </span>
            </p>
          )}
        </section>

        {!rechazado && pedido.estado !== "cancelado" && (
          <ZonaSinFlotante soloEnCelular className="mt-4">
            {pago}
          </ZonaSinFlotante>
        )}

        {/* Con sesión, el pedido vive en el portal. Quien ya tiene cuenta y
            abrió el enlace del correo entra a la suya; a quien no tiene, se
            le ofrece crearla (M2S1-103: «Creá tu cuenta» a una clienta que
            ya la tenía). */}
        {sesion || pedido.conCuenta ? (
          <Link
            href={sesion ? `/mi-cuenta/pedidos/${pedido.numero}` : `/ingresar?volver=/mi-cuenta/pedidos/${pedido.numero}`}
            className="mt-4 flex items-center gap-3 rounded-xl bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <UserRound className="h-5 w-5 shrink-0 text-brand-orange" />
            <span className="flex-1 text-sm font-medium">
              {sesion ? "Seguí este pedido desde tu cuenta" : "Entrá a tu cuenta para seguirlo"}
            </span>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Link>
        ) : (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl bg-card p-5 shadow-sm">
            <UserRound className="h-5 w-5 shrink-0 text-brand-orange" />
            <span className="min-w-[12rem] flex-1 text-sm">
              <span className="block font-medium">
                Creá tu cuenta y seguí el pedido
              </span>
              <span className="text-muted-foreground">
                Así no tenés que anotar el número ni llamar para preguntar.
              </span>
            </span>
            <Button
              render={<Link href="/registro" />}
              className="bg-accion text-white hover:bg-brand-orange-dark"
            >
              Crear cuenta
            </Button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <BotonWhatsapp enlace={whatsapp}>Escribirnos por WhatsApp</BotonWhatsapp>
          <Button render={<Link href="/catalogo" />} variant="outline">
            Seguir comprando
          </Button>
        </div>
      </div>
    </div>
  );
}

type PedidoSeguido = NonNullable<Awaited<ReturnType<typeof pedidoParaSeguimiento>>>;

/**
 * El título de la página según la etapa del pedido, la del tablero del
 * panel. La fecha de la entrega va en hora argentina.
 */
function cabeceraDelEstado(p: PedidoSeguido): {
  titulo: string;
  bajada?: React.ReactNode;
  icono: typeof Check;
  fondo: string;
} {
  const verde = "bg-brand-green";
  const naranja = "bg-accion";
  switch (p.estado) {
    case "cancelado":
      return { titulo: "Pedido cancelado", icono: XCircle, fondo: "bg-muted-foreground" };
    case "entregado": {
      const dia = p.entregadoAt ? ` el ${fechaCorta.format(new Date(p.entregadoAt))}` : "";
      return {
        titulo: p.tipoEntrega === "retiro" ? `Retirado${dia}` : `Entregado${dia}`,
        icono: PackageCheck,
        fondo: verde,
      };
    }
    // Se lo llevó y falta la firma del remito (fragmentos.EstadoParaElCliente):
    // decía «Listo para retirar» con el panel en «Entregado» (mes 23, PED-1150).
    case "por-firmar":
      return { titulo: "Falta firmar el remito", icono: PenLine, fondo: naranja };
    case "en-camino":
      return { titulo: "Tu pedido está en camino", icono: Truck, fondo: naranja };
    case "listo":
      return p.tipoEntrega === "retiro"
        ? { titulo: "Listo para retirar", bajada: `En ${p.sucursal ?? "el local"}`, icono: Store, fondo: verde }
        : { titulo: "Listo, sale para la entrega", icono: Truck, fondo: verde };
    case "preparando":
      return { titulo: "Estamos preparando tu pedido", icono: Package, fondo: naranja };
    default:
      return {
        titulo: "Listo, recibimos tu pedido",
        bajada: (
          <>
            Guardá el número{" "}
            <span className="tabular font-semibold text-foreground">{p.numero}</span>. Te escribimos para coordinar.
          </>
        ),
        icono: Check,
        fondo: verde,
      };
  }
}
