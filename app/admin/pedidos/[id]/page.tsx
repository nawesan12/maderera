import { cantidadConUnidad, telefonoLegible } from "@/lib/formato";
import { ajustesDelSitio } from "@/lib/dal/contenido";
import { escalasDePago } from "@/lib/dal/descuentos-pago";
import { valorDeRegla } from "@/lib/reglas";
import { rotuloDelCircuito } from "@/lib/circuito";
import Link from "next/link";
import { UnirAFicha } from "@/components/admin/unir-a-ficha";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { MapPin, Printer, MessageCircle, Phone, Scissors, Store, Truck, Undo2 } from "lucide-react";
import type { ReactNode } from "react";
import { EncabezadoFicha } from "@/components/admin/encabezado-ficha";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import {
  ETAPAS_PEDIDO,
  ETAPAS_RETIRO,
  Pasos,
} from "@/components/admin/pasos";
import { fechaHora, formatearMonto, formatearPorcentaje, moneda, plural } from "@/components/admin/formato";
import { datosDeDevolucion, obtenerPedido } from "@/lib/dal/admin/ventas";
import { AccionesPedido, CancelarPedido } from "../acciones";
import { DiaDeEntrega } from "./dia-de-entrega";
import { configuracionFiscalActual, devolucionDesdeElPedido, pedidoParaFacturar } from "@/lib/dal/admin/facturacion";
import { letraQueCorresponde, type CondicionIva } from "@/lib/fiscal/comprobantes";
import { BotonFacturar } from "./facturar";
import { CorregirPedido, DevolverPedido } from "./corregir-devolver";
import { FaltoAlgo } from "./falto-algo";
import { listarSucursalesPublicas } from "@/lib/dal/envios";
import { DevolverFacturado } from "./devolver-facturado";
import { zonasParaPedido } from "../../presupuestos/zonas";
import { Entregas } from "./entregas";
import { saldoDeAcopio } from "@/lib/entregas";
import { seOfreceLaFirma } from "@/lib/entregas/firma";
import { otrosAcopios, remitosDelPedido } from "@/lib/dal/admin/entregas";
import { cortesDelPedido } from "@/lib/dal/admin/cortes";
import { requireStaff } from "@/lib/dal/session";
import { cobroDelPedido } from "../cobro";
import { MANEJAN_PLATA, puedeEntrar } from "@/lib/roles";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoManual, avisosManuales } from "@/lib/whatsapp/aviso-manual-datos";
import type { EventoManual } from "@/lib/whatsapp/aviso-manual";

const MEDIOS: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  cuenta_corriente: "Cuenta corriente",
  cheque: "Cheque",
};

/** El teléfono como lo marca WhatsApp: solo dígitos, con el 54 adelante. */
function paraWhatsapp(telefono: string): string {
  const d = telefono.replace(/\D/g, "");
  return d.startsWith("54") ? d : `54${d.replace(/^0/, "")}`;
}

export default async function FichaPedidoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ remito?: string; falto?: string }>;
}) {
  const { id } = await params;
  // «Preparar remito» desde el tablero llega con el formulario abierto, y
  // «Le faltó algo» desde las ventas de hoy del mostrador (M3S3-021).
  const { remito: abrirRemito, falto } = await searchParams;
  if (!esUuid(id)) notFound();
  const [usuario, pedido] = await Promise.all([
    requireStaff(),
    obtenerPedido(id),
  ]);

  if (!pedido) notFound();

  /*
   * El margen es de administración, como los reportes: es el número que no se
   * muestra en el mostrador. La pantalla la ven también vendedores y depósito.
   * Lo calcula Go (internal/pedidos, MargenDelPedido) y solo se lo manda al
   * admin.
   */
  const esAdmin = usuario.staffRole === "admin";

  const margen = esAdmin ? pedido.margen : null;

  // Si el pedido ya se facturó, el botón se reemplaza por el enlace al
  // comprobante: dos facturas del mismo pedido obligan a anular una.
  // Facturar es del admin: a los demás el botón los mandaba a una pantalla
  // que los rebotaba al inicio.
  const factura = puedeEntrar("/admin/facturacion", usuario.staffRole);
  const datosFactura = factura ? await pedidoParaFacturar(id) : null;
  const facturado = datosFactura?.yaFacturado ?? null;
  // Lo que saldría, para confirmarlo antes de emitir: la letra (con la regla
  // del monotributista), a quién y cuánto.
  const porEmitir =
    datosFactura && !facturado
      ? await (async () => {
          const [emisor, ajustesFiscales] = await Promise.all([configuracionFiscalActual(), ajustesDelSitio()]);
          const p = datosFactura.pedido;
          return {
            letra: letraQueCorresponde(
              (emisor?.condicionIva ?? "responsable_inscripto") as CondicionIva,
              (p.clienteCondicionIva ?? "consumidor_final") as CondicionIva,
              valorDeRegla(ajustesFiscales, "factura_al_monotributista"),
            ),
            receptor: p.clienteRazonSocial || p.clienteNombre || p.contactoNombre,
            cuit: p.clienteCuit,
            condicion: p.clienteCondicionIva,
            total: Number(p.total),
          };
        })()
      : null;
  const verCliente = puedeEntrar("/admin/clientes", usuario.staffRole);
  const cancelable =
    puedeEntrar("/admin/presupuestos", usuario.staffRole) &&
    pedido.origen !== "mostrador" &&
    !["cancelado", "entregado"].includes(pedido.estado);

  // El aviso que corresponde al estado: lo que el cliente tiene que saber ahora.
  // Solo para quien atiende el WhatsApp de la maderera (no depósito).
  // Un envío listo no se avisa: no se va a retirar, el aviso es el de «en
  // camino» (mes simulado 2: decía «listo para retirar»).
  const eventoAviso =
    puedeEntrar("/admin/whatsapp", usuario.staffRole) && !(pedido.estado === "listo" && pedido.tipoEntrega === "envio")
      ? (EVENTO_DEL_ESTADO[pedido.estado] ?? null)
      : null;

  const cancelado = pedido.estado === "cancelado";
  const [pendientes, remitos, cortes, aviso, otros] = await Promise.all([
    saldoDeAcopio(id),
    remitosDelPedido(id),
    cortesDelPedido(id),
    eventoAviso ? avisoManual(eventoAviso, { tipo: "order", id }) : null,
    // La misma visita se lleva de los otros acopios del cliente.
    pedido.customerId && pedido.tipoEntrega === "retiro" && !cancelado && pedido.estado !== "entregado"
      ? otrosAcopios(id)
      : [],
  ]);
  const porEntregar = pendientes.filter((p) => p.pendiente > 0.01);
  // Un acopio en curso: ya salió algo y queda algo. Va arriba de todo, y el
  // botón principal es «Preparar remito» (mes simulado: era «Marcar
  // entregado», que se lleva todo lo que queda).
  const acopioEnCurso = pedido.acopio && porEntregar.length > 0;
  // Un retiro listo con mercadería: lo que sigue es el remito, que deja la
  // firma. Va arriba con «Preparar remito» como botón principal, y el
  // encabezado no repite otro (mes simulado 2: arriba estaba «Marcar
  // entregado» y había dos «Preparar remito» en la pantalla).
  const remitoArriba =
    acopioEnCurso || (pedido.tipoEntrega === "retiro" && pedido.estado === "listo" && porEntregar.length > 0);
  // Preparando con un remito parcial ya firmado: el remito va arriba, pero
  // «Marcar listo» no se pierde. Sin esto el pedido quedaba «Preparando» con
  // el corte terminado y ningún rol lo podía marcar listo (mes 23, PED-1153).
  const listoEnAcopio = acopioEnCurso && pedido.estado === "preparando";
  // El remito del camión sin firmar: en un envío en camino con algo por
  // llevar, firmarlo es lo que sigue (no «Marcar entregado»).
  const remitoEnLaCalle = remitos.find((r) => r.tipo === "envio" && seOfreceLaFirma(r));
  const firmaEnLaCalle = remitoEnLaCalle
    ? `/firmar/${remitoEnLaCalle.firmaToken}?volver=${encodeURIComponent(`/admin/pedidos/${pedido.id}`)}`
    : null;
  const cortesSinTerminar = cortes.filter((c) => c.estado === "en-cola" || c.estado === "en-proceso").map((c) => c.numero);
  const interno = pedido.comprobante === "interno" && !facturado;
  // El mismo nombre que eligió la dueña en /admin/reglas (decía «Interno»
  // con la regla en «B», mes simulado 2).
  const circuito = rotuloDelCircuito(valorDeRegla(await ajustesDelSitio(), "etiqueta_del_circuito"));
  // Devolver y corregir: de quien mueve plata, y sin factura (con factura,
  // por la factura y su nota). Corregir, además, sin nada cobrado y fuera
  // del mostrador (la venta del mostrador se anula desde ahí).
  const manejaPlata = Boolean(usuario.staffRole && MANEJAN_PLATA.includes(usuario.staffRole));
  // Devuelto entero, no queda nada para devolver ni anular: seguía
  // ofreciendo las dos cosas con el pedido en $ 0 (mes 23).
  const quedaAlgo = pedido.items.some((i) => Number(i.cantidad) - (i.devuelto ?? 0) > 0.0001);
  const tocable = manejaPlata && !cancelado && !pedido.facturado && quedaAlgo;
  // Devolver es de lo que salió (o de lo cobrado, que vuelve): en un pedido
  // sin preparar ni cobrar aparecía al lado de «Corregir», que es lo que
  // corresponde (mes 23, PED-1123 y PED-1134).
  const salioAlgo =
    pedido.origen === "mostrador" ||
    ["en-camino", "entregado"].includes(pedido.estado) ||
    remitos.some((r) => r.estado !== "anulada");
  const devolvible = tocable && (salioAlgo || pedido.cobrado > 0.005);
  // Facturado: la devolución sale del pedido con su nota de crédito mientras
  // no saque plata (H279); lo cobrado vuelve desde la factura.
  const devolucionFacturada =
    manejaPlata && !cancelado && pedido.facturado ? await devolucionDesdeElPedido(pedido.id) : null;
  const paraDevolver = devolvible ? await datosDeDevolucion(pedido.id) : null;
  const devuelveDesdeElPedido =
    devolucionFacturada &&
    devolucionFacturada.tope + devolucionFacturada.caja + devolucionFacturada.afuera > 0.005 &&
    devolucionFacturada.renglones.some((r) => r.queda > 0);
  // Entregado no se corrige: lo que falta va en otro pedido y lo que vuelve,
  // con una devolución (mes simulado 2).
  const corregible = tocable && pedido.origen !== "mostrador" && pedido.cobrado < 0.005 && pedido.estado !== "entregado";
  // «Le faltó algo»: la reposición sin cargo es un ajuste del Stock, de quien
  // entra ahí (M3S3-021).
  const reponible = !cancelado && puedeEntrar("/admin/stock", usuario.staffRole);
  const sucursalSlug = reponible
    ? ((await listarSucursalesPublicas()).find((s) => s.id === pedido.branchId)?.slug ?? null)
    : null;

  const renglones = pedido.items.map((i) => ({
    id: i.id,
    deCatalogo: i.variantId != null,
    descripcion: i.descripcion,
    unidad: i.unidad,
    cantidad: Number(i.cantidad),
    precioUnitario: Number(i.precioUnitario),
    subtotal: Number(i.subtotal),
  }));

  // El remito también se manda gratis, desde la app del teléfono.
  const avisosRemito = puedeEntrar("/admin/whatsapp", usuario.staffRole)
    ? await avisosManuales(
        "documento",
        "delivery",
        remitos.filter((r) => r.estado !== "anulada").map((r) => r.id),
      )
    : {};

  const etapas =
    pedido.tipoEntrega === "retiro" ? ETAPAS_RETIRO : ETAPAS_PEDIDO;

  const devueltoTotal = pedido.devoluciones.reduce((t, d) => t + d.importe, 0);
  const devueltoEnPlata = pedido.devoluciones.filter((d) => d.destino === "caja" || d.destino === "afuera").reduce((t, d) => t + d.importe, 0);
  const sumaDeRenglones = Math.round(pedido.items.reduce((t, i) => t + Number(i.subtotal) * 100, 0)) / 100;
  const descuentoAparte =
    Number(pedido.descuento) > 0.004 &&
    Math.abs(sumaDeRenglones + Number(pedido.costoEnvio) - Number(pedido.descuento) - Number(pedido.total)) < 0.02;

  const entregas = (
    <Entregas
      whatsapp={puedeEntrar("/admin/whatsapp", usuario.staffRole)}
      // Con el aviso de arriba, el del remito no se repite debajo.
      avisos={aviso ? {} : avisosRemito}
      orderId={pedido.id}
      tipoEntrega={pedido.tipoEntrega}
      estado={pedido.estado}
      pendientes={pendientes}
      remitos={remitos}
      otros={otros}
      receptor={pedido.cliente}
      abrir={abrirRemito === "1" && !cancelado}
      sinCobrar={pedido.sinCobrar ? { numero: pedido.numero, monto: pedido.sinCobrar } : null}
      cobro={manejaPlata ? cobroDelPedido(pedido) : null}
    />
  );

  // Un renglón que no cambió el estado (una anulación, una reposición sin
  // cargo) no lleva el chip: decía «Entregado» al lado de «Remito anulado»
  // (mes simulado). Su nota es el título.
  const cronologico = [...pedido.historial].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const sinCambio = new Set(
    cronologico.filter((h, i) => i > 0 && h.nota && h.estado === cronologico[i - 1].estado).map((h) => h.id),
  );
  const historial: { clave: string; cuando: Date; titulo: ReactNode; nota?: ReactNode; quien?: string | null }[] = [
    // Las devoluciones van con su nota de crédito, de la lista de abajo; el
    // renglón del historial que las anotaba no se repite.
    ...pedido.historial.filter((h) => !(h.nota?.startsWith("Devolución") && pedido.devoluciones.length > 0)).map((h) => ({
      clave: h.id,
      cuando: h.createdAt,
      titulo: sinCambio.has(h.id) ? (
        <p className="text-base font-medium">{h.nota}</p>
      ) : (
        <EtiquetaEstado estado={h.estado} contexto="pedido" />
      ),
      nota: sinCambio.has(h.id) ? null : h.nota,
      quien: h.quien,
    })),
    ...pedido.recibos.map((r) => ({
      clave: r.id,
      cuando: new Date(r.createdAt),
      titulo: (
        <p className="text-base font-medium">
          Cobro <span className="tabular">{formatearMonto(r.total)}</span>
          {r.estado === "anulado" && <span className="font-normal text-muted-foreground"> · anulado</span>}
        </p>
      ),
      nota: [r.numero, ...r.medios.split(",").filter(Boolean).map((m) => MEDIOS_DE_COBRO[m] ?? m)].join(" · "),
      quien: r.quien,
    })),
    ...pedido.devoluciones.map((d) => ({
      clave: d.id,
      cuando: new Date(d.createdAt),
      titulo: (
        <p className="text-base font-medium">
          Devolución <span className="tabular">{formatearMonto(d.importe)}</span>
        </p>
      ),
      nota: (
        <>
          {d.notaId && d.nota && (
            <>
              <a href={`/api/comprobantes/${d.notaId}/pdf`} target="_blank" rel="noreferrer" className="codigo hover:text-brand-orange">
                {d.nota}
              </a>{" "}
              ·{" "}
            </>
          )}
          {DESTINO_DEVOLUCION[d.destino]} · {d.motivo}
        </>
      ),
      quien: d.quien,
    })),
    ...remitos
      // El remito que completa el pedido ya está en el historial como
      // «Entregado»; los demás (los retiros de un acopio) faltaban.
      .filter((r) => !pedido.historial.some((h) => h.nota?.includes(r.numero)))
      .map((r) => ({
        clave: r.id,
        cuando: r.createdAt,
        titulo: <p className="text-base font-medium">{r.tipo === "envio" ? "Salió" : "Retiro"}</p>,
        nota: `${r.numero}${r.receptorNombre ? ` · ${r.receptorNombre}` : ""}${r.estado === "anulada" ? " · anulado" : ""}`,
        quien: null,
      })),
  ].sort((a, b) => b.cuando.getTime() - a.cuando.getTime());

  return (
    <div className="space-y-6">
      <EncabezadoFicha
        volverA="/admin/pedidos"
        volverTexto="Volver a pedidos"
        titulo={pedido.cliente}
        estado={
          <>
            <EtiquetaEstado estado={pedido.estado} contexto="pedido" />
            {/* La misma regla que «Me deben» y que el encabezado de Pedidos:
                lo que va a cuenta corriente ya está en la cuenta y no se
                cobra en la puerta (mes simulado: el encabezado no lo sumaba
                y la ficha decía «Sin cobrar»). */}
            {!cancelado && <ChipDeCobro pedido={pedido} />}
            {/* Salió con el comprobante interno a propósito: no es una venta
                que se olvidó de facturar. */}
            {interno && (
              <span className="estado-cerrado rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium">{circuito}</span>
            )}
          </>
        }
        detalle={
          <>
            <span className="tabular">{pedido.numero}</span>
            {pedido.empresa && ` · ${pedido.empresa}`}
            {` · ${fechaHora.format(pedido.createdAt)}`}
            {pedido.quoteId && pedido.numeroPresupuesto && puedeEntrar("/admin/presupuestos", usuario.staffRole) && (
              <>
                {" · del presupuesto "}
                <Link href={`/admin/presupuestos/${pedido.quoteId}`} className="tabular text-brand-orange hover:underline">
                  {pedido.numeroPresupuesto}
                </Link>
              </>
            )}
          </>
        }
        acciones={
          <>
            {cancelable && <CancelarPedido id={pedido.id} numero={pedido.numero} cobrado={pedido.estadoPago === "pagado"} />}
            {corregible && (
              <CorregirPedido
                id={pedido.id}
                numero={pedido.numero}
                renglones={renglones}
                costoEnvio={Number(pedido.costoEnvio)}
                conEnvio={pedido.tipoEntrega === "envio"}
                descuento={Number(pedido.descuento)}
                entrega={
                  remitos.some((r) => r.estado !== "anulada") || pedido.estado === "en-camino"
                    ? null
                    : {
                        tipo: pedido.tipoEntrega === "envio" ? "envio" : "retiro",
                        direccion: pedido.direccionEntrega ?? "",
                        zona: pedido.zonaEnvio ?? "",
                      }
                }
                zonas={corregible ? await zonasParaPedido() : []}
                porMedio={corregible ? await descuentoDelMedio(pedido) : null}
                branchId={pedido.branchId}
                customerId={pedido.customerId}
              />
            )}
            {devolvible && <DevolverPedido id={pedido.id} numero={pedido.numero} renglones={renglones} datos={paraDevolver} />}
            {reponible && sucursalSlug && (
              <FaltoAlgo
                numero={pedido.numero}
                sucursal={sucursalSlug}
                abiertoAlEntrar={falto === "1"}
                // Lo que se llevó: sin lo que ya devolvió («se llevó 6»
                // con 2 devueltos, mes 23).
                renglones={pedido.items.flatMap((i) => {
                  const llevo = Math.round((Number(i.cantidad) - (i.devuelto ?? 0)) * 1000) / 1000;
                  return i.variantId && llevo > 0 ? [{ variantId: i.variantId, descripcion: i.descripcion, cantidad: llevo }] : [];
                })}
              />
            )}
            <a
              href={`/ticket/${pedido.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
            >
              <Printer className="h-5 w-5" aria-hidden="true" />
              Imprimir
            </a>
            {/* Un pedido cancelado no se factura; si tiene comprobante, el
                enlace sigue. */}
            {factura && (facturado || pedido.estado !== "cancelado") && (
              <BotonFacturar
                discreto={interno}
                orderId={pedido.id}
                porEmitir={porEmitir}
                comprobante={
                  facturado
                    ? {
                        id: facturado.id,
                        numero: facturado.numero,
                        tipo: facturado.tipo,
                      }
                    : null
                }
              />
            )}
            {/* La devolución de una venta ya entregada se hace sobre su
                factura, con o sin CAE (H332): desde el pedido no había por
                dónde. */}
            {devuelveDesdeElPedido && devolucionFacturada && (
              <DevolverFacturado
                id={pedido.id}
                numero={pedido.numero}
                factura={devolucionFacturada.factura}
                tope={devolucionFacturada.tope}
                caja={devolucionFacturada.caja}
                afuera={devolucionFacturada.afuera}
                cajaAbierta={devolucionFacturada.cajaAbierta}
                renglones={devolucionFacturada.renglones}
              />
            )}
            {!devuelveDesdeElPedido && factura && facturado && facturado.tipo.startsWith("factura") && pedido.estado !== "cancelado" && (
              <Link
                href={`/admin/facturacion/${facturado.id}#devolucion`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted"
              >
                <Undo2 className="h-5 w-5" aria-hidden="true" />
                Devolución
              </Link>
            )}
            <AccionesPedido
              id={pedido.id}
              estado={pedido.estado}
              estadoPago={pedido.estadoPago}
              tipoEntrega={pedido.tipoEntrega}
              pedido={{ numero: pedido.numero, nombre: pedido.cliente }}
              cobro={manejaPlata ? cobroDelPedido(pedido) : null}
              sinCobrar={pedido.sinCobrar ? { numero: pedido.numero, monto: pedido.sinCobrar } : null}
              cortesSinTerminar={cortesSinTerminar}
              acopio={acopioEnCurso}
              sinAvance={remitoArriba && !listoEnAcopio}
              secundario={listoEnAcopio}
              porLlevar={porEntregar.length > 0}
              firmar={firmaEnLaCalle}
              remitoAFirmar={remitoEnLaCalle?.numero ?? null}
              enLaFicha
            />
          </>
        }
      />

      {/* Recorrido */}
      <section className="tarjeta p-5">
        <Pasos
          etapas={etapas}
          actual={pedido.estado}
          cancelado={pedido.estado === "cancelado"}
        />
      </section>

      {/* Avisarle al cliente, gratis, desde WhatsApp Business. Lo que pide una
          decisión —listo o en camino y todavía sin avisar— va con borde de acento. */}
      {aviso && (
        <section
          className={
            (pedido.estado === "listo" || pedido.estado === "en-camino") && !aviso.yaAvisado
              ? "tarjeta-atencion p-5"
              : "tarjeta p-5"
          }
        >
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Avisarle: {aviso.titulo.toLowerCase()}
          </h2>
          <AvisarPorWhatsapp aviso={aviso} atajo />
        </section>
      )}

      {/* Dos columnas que corren solas: con la grilla de filas, «Qué lleva» y
          la columna de la derecha compartían la primera fila y entre «Qué
          lleva» y lo que seguía quedaban unos 400 px vacíos (mes simulado). */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-4">
        {remitoArriba && entregas}

        <section className="tarjeta overflow-hidden">
          <h2 className="px-5 pt-4 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Qué lleva</h2>
          {/* Sin pie de tabla: apilada en el teléfono, cada celda toma el
              nombre de su columna, y «Envío» y «Total» salían rotulados
              «Subtotal». El unitario va siempre: apilado tiene su renglón. */}
          <table className="mt-3 w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">Producto</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Cantidad</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">Unitario</th>
                <th className="px-5 py-3 text-right text-sm font-medium text-muted-foreground">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {pedido.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="px-5 py-3.5 text-base">{item.descripcion}</td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {cantidadConUnidad(Number(item.cantidad), item.unidad, item.descripcion)}
                    {(item.devuelto ?? 0) > 0 && (
                      <span className="estado-espera block text-sm font-medium text-[var(--estado-tinta)]">
                        {(item.devuelto ?? 0) === 1 ? "Volvió" : "Volvieron"}{" "}
                        {cantidadConUnidad(item.devuelto ?? 0, item.unidad, item.descripcion)}
                      </span>
                    )}
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base text-muted-foreground">
                    {formatearMonto(Number(item.precioUnitario))}
                  </td>
                  <td className="tabular px-5 py-3.5 text-right text-base">{formatearMonto(Number(item.subtotal))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="space-y-1 border-t bg-hundida/50 px-5 py-4 text-base">
            {(Number(pedido.costoEnvio) > 0 || descuentoAparte) && (
              <div className="flex justify-between gap-3">
                <dt>Subtotal</dt>
                <dd className="tabular">{formatearMonto(sumaDeRenglones)}</dd>
              </div>
            )}
            {/* El descuento por forma de pago del pedido web o del
                presupuesto: los renglones van a lista y el total no
                cerraba a la vista (mes simulado 2). El del mostrador ya
                rebajó cada renglón: ahí no va. */}
            {descuentoAparte && (
              <div className="flex justify-between gap-3">
                <dt>{pedido.descuentoMotivo || "Descuento"}</dt>
                <dd className="tabular">−{formatearMonto(Number(pedido.descuento))}</dd>
              </div>
            )}
            {Number(pedido.costoEnvio) > 0 && (
              <div className="flex justify-between gap-3">
                <dt>Envío{pedido.zonaEnvio ? ` · ${pedido.zonaEnvio}` : ""}</dt>
                <dd className="tabular">{formatearMonto(Number(pedido.costoEnvio))}</dd>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <dt className="font-medium">Total</dt>
              <dd className="tabular text-xl font-semibold">{formatearMonto(Number(pedido.total))}</dd>
            </div>
          </dl>

          {/*
            * El margen de esta venta.
            *
            * Solo para administración: es el número que no se muestra en el
            * mostrador. Y solo aparece si alguna línea tiene costo congelado;
            * las anteriores al módulo de compras no lo tienen y se cuentan
            * aparte en vez de promediarse como si hubieran costado cero.
            */}
          {/* Cancelado no hubo venta: sin margen (mes simulado 2). */}
          {esAdmin && margen && !cancelado && (
            <div className="border-t bg-muted/40 px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-base font-medium">Margen de esta venta</p>
                  <p className="text-sm text-muted-foreground">
                    {moneda.format(margen.neto)} netos menos{" "}
                    {moneda.format(margen.costo)} de costo
                    {margen.sinCosto > 0 &&
                      ` · ${plural(margen.sinCosto, "renglón", "renglones")} sin costo, fuera de la cuenta`}
                  </p>
                </div>
                <p
                  className={`tabular text-xl font-semibold ${
                    margen.ganancia < 0 ? "text-saldo-debe" : "text-saldo-favor"
                  }`}
                >
                  {moneda.format(margen.ganancia)}
                  {margen.neto > 0 && (
                    <span className="ml-2 text-base text-muted-foreground">
                      {formatearPorcentaje((margen.ganancia / margen.neto) * 100)}
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}
        </section>

        {!remitoArriba && entregas}

        {/* El corte, en la ficha del pedido: «el pedido está listo menos el
            corte». Un pedido cancelado o entregado no manda nada a cortar. */}
        {(cortes.length > 0 || !["cancelado", "entregado"].includes(pedido.estado)) && (
          <section className="tarjeta p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Corte</h2>
              {!["cancelado", "entregado"].includes(pedido.estado) ? (
                <Link href={`/admin/cortes/nuevo?pedido=${pedido.id}`} className="text-base text-brand-orange hover:underline">
                  Mandar a cortar
                </Link>
              ) : (
                /* Entregado es cuando falta una pieza: la reposición sin
                   cargo sale de acá (mes simulado 2: había que escribir la
                   dirección a mano). */
                pedido.estado === "entregado" &&
                cortes.length > 0 &&
                puedeEntrar("/admin/cortes/nuevo", usuario.staffRole) && (
                  <Link href={`/admin/cortes/nuevo?pedido=${pedido.id}&reponer=1`} className="text-base text-brand-orange hover:underline">
                    Reponer una pieza
                  </Link>
                )
              )}
            </div>

            {cortes.length === 0 ? (
              <p className="text-base text-muted-foreground">Sin corte.</p>
            ) : (
              <ul className="space-y-1.5">
                {cortes.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/admin/cortes/${c.id}`}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <Scissors className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="tabular block text-base">{c.numero}</span>
                        <span className="block text-sm text-muted-foreground">{c.material}</span>
                      </span>
                      <EtiquetaEstado estado={c.estado} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        </div>

        <aside className="min-w-0 space-y-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Entrega
            </h2>
            {pedido.tipoEntrega === "envio" ? (
              <>
                <p className="flex items-start gap-2 text-base">
                  <Truck className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>{pedido.direccionEntrega}</span>
                </p>
                {pedido.zonaEnvio && (
                  <p className="mt-1.5 flex items-center gap-2 text-base text-muted-foreground">
                    <MapPin className="h-5 w-5 shrink-0" />
                    {pedido.zonaEnvio.replace(/\s*\([^)]*\)\s*$/, "")}
                  </p>
                )}
                {/* La zona «a cotizar» sin flete: salía y se entregaba sin
                    cotizarlo (mes simulado 2). */}
                {/* Con la zona de la lista también, como el reparto: la del
                    panel no lleva «(a cotizar)» en el nombre (M2S2-054). */}
                {/* «Sin cargo» elegido a propósito no se cotiza, y lo
                    entregado ya no se cotiza (mes 23, depósito). */}
                {Number(pedido.costoEnvio) === 0 &&
                  !pedido.fleteSinCargo &&
                  !["entregado", "cancelado"].includes(pedido.estado) &&
                  (await zonaACotizar(pedido.zonaEnvio)) && (
                  <span className="estado-problema mt-2 inline-block rounded-full bg-[var(--estado-fondo)] px-2.5 py-0.5 text-sm font-medium text-[var(--estado-tinta)]">
                    Flete sin cotizar
                  </span>
                )}
              </>
            ) : (
              <p className="flex items-center gap-2 text-base">
                <Store className="h-5 w-5 shrink-0 text-muted-foreground" />
                {pedido.sucursal ? `Retira en ${pedido.sucursal}` : "Retira en el local"}
              </p>
            )}
            {!["entregado", "cancelado"].includes(pedido.estado) && (
              <DiaDeEntrega
                id={pedido.id}
                dia={pedido.entregarEl}
                retiro={pedido.tipoEntrega === "retiro"}
                editable={puedeEntrar("/admin/presupuestos", usuario.staffRole)}
              />
            )}
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cobro
            </h2>
            <dl className="space-y-2 text-base">
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Forma de pago</dt>
                <dd>{pedido.medioPago ? MEDIOS[pedido.medioPago] : "—"}</dd>
              </div>
              {/* El pedido partido (H047): la parte que quedó en la cuenta. */}
              {pedido.aCuenta != null && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">A cuenta corriente</dt>
                  <dd className="tabular">{formatearMonto(pedido.aCuenta)}</dd>
                </div>
              )}
              {/* Un cobro parcial se ve: cuánto entró y cuánto falta (seguía
                  «Sin cobrar» por el total). */}
              {pedido.cobrado > 0.004 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Cobrado</dt>
                  <dd className="tabular">{formatearMonto(pedido.cobrado)}</dd>
                </div>
              )}
              {/* Cancelado no se cobra: ni «Falta cobrar» ni «Sin cobrar»
                  (mes simulado, H281). Lo cobrado, si hubo, sigue arriba. */}
              {cancelado ? null : pedido.sinCobrar != null ? (
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Falta cobrar</dt>
                  <dd className="tabular estado-problema font-semibold">{formatearMonto(pedido.sinCobrar)}</dd>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Estado</dt>
                  <dd>
                    {pedido.medioPago === "cuenta_corriente" && pedido.estadoPago !== "pagado" ? (
                      <span className="estado-info rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium">A cuenta corriente</span>
                    ) : (
                      <EtiquetaEstado estado={pedido.estadoPago} contexto="pago" />
                    )}
                  </dd>
                </div>
              )}
              {/* Cada recibo con el medio por el que entró: la forma de pago
                  es la que se acordó, y decía «Transferencia» de un cobro en
                  efectivo (mes simulado 2). */}
              {pedido.recibos.length > 0 && (
                <ul className="space-y-1 pt-1">
                  {pedido.recibos.map((r) => (
                    <li key={r.id} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0">
                        <a
                          href={`/api/recibos/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className={`codigo hover:text-brand-orange ${r.estado === "anulado" ? "line-through" : ""}`}
                        >
                          {r.numero}
                        </a>{" "}
                        <span className="text-sm text-muted-foreground">
                          {r.medios.split(",").filter(Boolean).map((m) => MEDIOS_DE_COBRO[m] ?? m).join(" · ")}
                        </span>
                      </span>
                      <span className={`tabular text-sm ${r.estado === "anulado" ? "text-muted-foreground line-through" : ""}`}>
                        {formatearMonto(r.total)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {/* Lo que volvió por la caja o el banco, y lo neto (M2S1-082). */}
              {devueltoEnPlata > 0.004 && (
                <>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Devuelto</dt>
                    <dd className="tabular">−{formatearMonto(devueltoEnPlata)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">Neto</dt>
                    <dd className="tabular font-semibold">{formatearMonto(Number(pedido.total) - devueltoTotal)}</dd>
                  </div>
                </>
              )}
              {/* Las facturas y notas, para quien no entra a Facturación. */}
              {pedido.comprobantes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t pt-2">
                  {pedido.comprobantes.map((c) => (
                    <a
                      key={c.id}
                      href={factura ? `/admin/facturacion/${c.id}` : `/api/comprobantes/${c.id}/pdf`}
                      target={factura ? undefined : "_blank"}
                      rel="noreferrer"
                      className={`codigo hover:text-brand-orange ${c.estado === "anulada" ? "line-through" : ""}`}
                    >
                      {c.etiqueta}
                    </a>
                  ))}
                </div>
              )}
              {pedido.saldoCliente != null && verCliente && (
                <div className="flex justify-between gap-3 border-t pt-2">
                  <dt className="text-muted-foreground">Cuenta del cliente</dt>
                  <dd
                    className={`tabular font-medium ${
                      pedido.saldoCliente > 0.004 ? "text-saldo-debe" : pedido.saldoCliente < -0.004 ? "text-saldo-favor" : ""
                    }`}
                  >
                    {pedido.saldoCliente > 0.004
                      ? `Debe ${formatearMonto(pedido.saldoCliente)}`
                      : pedido.saldoCliente < -0.004
                        ? `A favor ${formatearMonto(-pedido.saldoCliente)}`
                        : "Al día"}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Contacto
            </h2>
            {pedido.customerId && verCliente ? (
              <Link
                href={`/admin/clientes/${pedido.customerId}`}
                className="text-base font-medium hover:text-brand-orange"
              >
                {pedido.cliente}
              </Link>
            ) : (
              <p className="text-base font-medium">{pedido.cliente}</p>
            )}
            {pedido.fichaPorCorreo && verCliente && (
              <UnirAFicha
                que="pedido"
                id={pedido.id}
                numero={pedido.numero}
                total={Number(pedido.total)}
                contacto={{ nombre: pedido.cliente, telefono: pedido.telefono }}
                ficha={pedido.fichaPorCorreo}
              />
            )}
            {pedido.telefono && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={`tel:${pedido.telefono.replace(/[^\d+]/g, "")}`}
                  className="tabular inline-flex h-10 items-center gap-1.5 rounded-lg bg-hundida px-3 text-base hover:bg-muted"
                >
                  <Phone className="h-4 w-4" aria-hidden="true" />
                  {telefonoLegible(pedido.telefono)}
                </a>
                <a
                  href={`https://wa.me/${paraWhatsapp(pedido.telefono)}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Escribirle por WhatsApp"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-hundida hover:bg-muted"
                >
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </a>
              </div>
            )}
            {pedido.email && (
              <p className="truncate text-base text-muted-foreground">
                {pedido.email}
              </p>
            )}
          </section>

          {/* El historial junta los cambios de estado, los cobros y los
              remitos: el cobro no quedaba en ningún lado, y una venta del
              mostrador o un acopio mostraban la tarjeta vacía. */}
          {historial.length > 0 && (
            <section className="tarjeta p-5">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">Historial</h2>
              <ol className="space-y-3">
                {historial.map((h) => (
                  <li key={h.clave} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-border" aria-hidden="true" />
                    <div className="min-w-0">
                      {h.titulo}
                      {h.nota && <p className="mt-1 text-base text-muted-foreground">{h.nota}</p>}
                      <p className="text-sm text-muted-foreground">
                        {fechaHora.format(h.cuando)}
                        {h.quien && ` · ${h.quien}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

const DESTINO_DEVOLUCION: Record<string, string> = {
  caja: "Salió de la caja",
  afuera: "Volvió por el banco",
  cuenta: "A la cuenta corriente",
  deuda: "Bajó lo que debía",
};

const MEDIOS_DE_COBRO: Record<string, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  deposito: "Depósito",
  cheque: "Cheque",
  echeq: "e-Cheq",
  tarjeta_debito: "Débito",
  tarjeta_credito: "Crédito",
  mercado_pago: "Mercado Pago",
  retencion: "Retención",
};

/** Lo que falta cobrar del pedido, en una etiqueta. */
function ChipDeCobro({
  pedido,
}: {
  pedido: { sinCobrar: number | null; cobrado: number; medioPago: string | null; estadoPago: string };
}) {
  if (pedido.sinCobrar != null) {
    return (
      <span className="estado-espera rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium">
        {pedido.cobrado > 0.004 ? "Cobrado en parte" : "Sin cobrar"}
      </span>
    );
  }
  if (pedido.medioPago === "cuenta_corriente" && pedido.estadoPago !== "pagado") {
    return (
      <span className="estado-info rounded-full bg-[var(--estado-fondo)] px-2.5 py-1 text-sm font-medium">A cuenta corriente</span>
    );
  }
  return null;
}

/** Qué aviso le corresponde al pedido según dónde está. */
const EVENTO_DEL_ESTADO: Partial<Record<string, EventoManual>> = {
  pendiente: "pedido_recibido",
  preparando: "preparando",
  listo: "listo",
  "en-camino": "en-camino",
  entregado: "entregado",
};

/**
 * El descuento por forma de pago del pedido, para que «Corregir» lo
 * recalcule como Go (pedidos.Corregir): solo si el que tiene salió de una
 * escala del medio (el motivo es su etiqueta). Uno a mano queda fijo.
 */
async function descuentoDelMedio(pedido: {
  medioPago: string | null;
  aCuenta?: number | null;
  descuento: string;
  descuentoMotivo: string | null;
}) {
  const medio = pedido.medioPago;
  if (!medio || pedido.aCuenta != null || !(Number(pedido.descuento) > 0)) return null;
  const escalas = (await escalasDePago()).filter((e) => e.medio === medio);
  if (!escalas.some((e) => e.etiqueta === pedido.descuentoMotivo)) return null;
  const alFlete = valorDeRegla(await ajustesDelSitio(), "descuento_al_flete") === "si";
  return { medio, escalas, alFlete };
}

/** La zona del envío es «a cotizar»: por el nombre (la tienda) o por la lista. */
async function zonaACotizar(zona: string | null): Promise<boolean> {
  if (!zona) return false;
  if (/a cotizar/i.test(zona)) return true;
  const nombre = zona.trim().toLowerCase();
  return (await zonasParaPedido()).some((z) => z.aCotizar && z.nombre.trim().toLowerCase() === nombre);
}
