import Link from "next/link";
import { AvisarPorWhatsapp } from "@/components/admin/avisar-por-whatsapp";
import { avisoManual } from "@/lib/whatsapp/aviso-manual-datos";
import { requireStaff } from "@/lib/dal/session";
import { DECIDEN_EN_LA_COLA, MANEJAN_PLATA, puedeEntrar } from "@/lib/roles";
import { notFound } from "next/navigation";
import { esUuid } from "@/lib/uuid";
import { ArrowLeft, Ban, Flame, ListChecks, Map, ReceiptText } from "lucide-react";
import { EtiquetaEstado } from "@/components/admin/etiqueta-estado";
import { ETAPAS_CORTE, Pasos } from "@/components/admin/pasos";
import { fechaHora, plural } from "@/components/admin/formato";
import { fichaDeCorte } from "@/lib/dal/admin/cortes";
import { AcomodoDelCorte } from "../acomodo";
import { PlanoSimple } from "@/components/cortes/plano-simple";
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { formatearMonto, telefonoLegible } from "@/lib/formato";
import { formatearDecimal } from "@/lib/unidades";
import { placasDeLasDelPedido } from "@/lib/cortes/placas-del-pedido";
import { AccionesCorte, VolverUnPaso } from "../acciones";
import { CargarPasadas } from "../pasadas";
import { SierraDelTrabajo } from "./sierra";
import { formatearSierra } from "@/lib/cortes/sierra";
import { CobrarCorte, CorregirOAnular, MasArchivos, RemitoDeLaReposicion, SumarAlPedido } from "./gestion";
import { listarPerfiles } from "@/lib/dal/admin/cortes-exportacion";
import { MontoVivo, PasadasVivas, PlanoVivo, RetalMayorVivo, RotuloDePasadas, SobrantesVivos } from "./plano-vivo";

export default async function FichaCortePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!esUuid(id)) notFound();
  // La ficha llega armada de Go (backend/internal/cortes): la tarifa según
  // la categoría y la lista del cliente, el plano con el disco, lo fijado a
  // mano y el motor con que nació el trabajo, el presupuesto placa por
  // placa, de dónde sale la plata (`modo`) y, para el aserradero, sin
  // importes ni teléfono.
  // Los formatos guardados: los que no usa el agente se prueban desde acá
  // sobre este corte, sin pasarlos a «por defecto» (mes simulado, M3S3-018).
  const [ficha, usuario, perfiles] = await Promise.all([
    fichaDeCorte(id),
    requireStaff(),
    listarPerfiles().catch(() => []),
  ]);

  if (!ficha) notFound();
  const { corte, tarifa, metrosCanto, cargoCanto, plano, cuenta, modo, pedido } = ficha;
  const rol = usuario.staffRole;
  const decide = rol !== null && DECIDEN_EN_LA_COLA.includes(rol);
  const cobra = rol !== null && MANEJAN_PLATA.includes(rol);
  const sinPlata = ficha.sinPlata;
  const anulado = corte.estado === "cancelado";

  const totalPiezas = corte.piezas.reduce((s, p) => s + p.cantidad, 0);

  // Terminado: el cliente tiene que enterarse para venir a buscarlo.
  // Solo para quien atiende el WhatsApp de la maderera (no el aserradero ni depósito).
  const atiende = puedeEntrar("/admin/whatsapp", rol);
  const aviso =
    atiende && corte.estado === "terminado"
      ? await avisoManual("corte_listo", { tipo: "cutting_order", id: corte.id })
      : null;

  const superficie =
    corte.piezas.reduce(
      (s, p) => s + (p.largoMm * p.anchoMm * p.cantidad) / 1_000_000,
      0,
    ) ?? 0;

  // Las placas del plano son medias cuando el trabajo sale de media placa:
  // «2 placas, 1 se vende entera» se leía como dos placas enteras (H052).
  const media = Boolean(corte.medida.mitad);
  const nPlacas = plano.placas.length;
  const rotuloPlacas = media ? (nPlacas === 1 ? "media placa" : "medias placas") : nPlacas === 1 ? "placa" : "placas";
  const rotuloEnteras = media
    ? plano.placasEnteras === 1 ? "media se vende" : "medias se venden"
    : plano.placasEnteras === 1 ? "se vende entera" : "se venden enteras";
  // Lo que se cobra de la placa en una sola cifra: «1 media placa ×
  // $ 37.698», no «1 placa entera × $ 75.395 = $ 37.698» (H123).
  const precioDeLaPlaca = cuenta.precioPorPlaca * cuenta.fraccion;
  const queSeVende = media
    ? cuenta.placasEnteras === 1 ? "media placa" : "medias placas"
    : cuenta.placasEnteras === 1 ? "placa entera" : "placas enteras";
  const puedeCorregir = decide && (corte.estado === "en-cola" || corte.estado === "en-proceso") && modo !== "vendido";
  // Lo que no se cobra (la reposición, el anulado) no dice «a cobrar» ni
  // «se vende entera» (mes simulado: CRT-906 anulado seguía cobrando).
  const noCobra = modo === "sinCargo" || modo === "anulado";
  // El pedido, enlazado solo para quien entra a Pedidos: al aserradero lo
  // devolvía al taller (mes simulado).
  const vePedidos = puedeEntrar("/admin/pedidos", rol);

  return (
    <div className="space-y-6">
      {/* El aserradero vuelve a su taller, no al panel (H127). */}
      <Link
        href={decide ? "/admin/cortes" : "/taller"}
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        {decide ? "Volver a cortes" : "Volver al taller"}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              {corte.cliente}
            </h1>
            <EtiquetaEstado estado={corte.estado} />
            {/* Terminado ya no apura: en el taller la marca desaparece y acá
                también. */}
            {corte.urgente && (corte.estado === "en-cola" || corte.estado === "en-proceso") && (
              <span className="inline-flex items-center gap-1 rounded-full bg-brand-orange/15 px-2.5 py-1 text-sm font-medium text-brand-orange-dark">
                <Flame className="h-4 w-4" />
                Urgente
              </span>
            )}
          </div>
          <p className="mt-0.5 text-base text-muted-foreground">
            {/* Cada dato con su propia guarda: la sucursal puede venir en
                nulo —`branchId` lo admite— y concatenarla sin preguntar
                imprimía "null" en el encabezado de la ficha. */}
            <span className="tabular">{corte.numero}</span>
            {/* La empresa solo si dice otra cosa que el título: «Sim
                Mueblería Atlántica · Sim Mueblería Atlántica SRL» repetía el
                nombre y partía el renglón a 375 px (mes simulado, M3S3-028). */}
            {corte.empresa && !mismoNombre(corte.empresa, corte.cliente) && ` · ${corte.empresa}`}
            {corte.sucursal && ` · ${corte.sucursal}`}
            {` · ${fechaHora.format(corte.createdAt)}`}
          </p>
        </div>

        {!anulado && (
          <div className="flex flex-wrap items-center gap-2">
            {/* El suelto con algo para cobrar no se entrega con un clic: se
                cobra (H348). */}
            {corte.estado === "terminado" && modo === "suelto" && cuenta.total > 0 && cobra ? (
              <CobrarCorte id={corte.id} conPlaca={corte.variantId != null} />
            ) : corte.estado === "terminado" && corte.orderId && pedido && !corte.cobrado && modo !== "sinCargo" && cobra ? (
              /* Con la venta hecha y sin cobrar, lo que sigue es cobrarla en
                 su pedido: «Marcar retirado» se rechazaba y «Cobrar en el
                 mostrador» abría el mostrador vacío (mes simulado, H173). */
              <Link
                href={`/admin/pedidos/${pedido.cargoId && pedido.cargoEstadoPago !== "pagado" ? pedido.cargoId : corte.orderId}`}
                className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-medium sm:w-auto"
              >
                <ReceiptText className="h-5 w-5" aria-hidden="true" />
                Cobrar{" "}
                <span className="codigo">
                  {pedido.cargo && pedido.cargoEstadoPago !== "pagado" ? pedido.cargo : pedido.numero}
                </span>
              </Link>
            ) : (
              <AccionesCorte
                id={corte.id}
                estado={corte.estado}
                urgente={corte.urgente}
                pasadas={ficha.pasadasACobrar}
                pedidoId={corte.orderId}
                sinCargo={corte.sinCargo}
                soloMaquina={!decide}
              />
            )}
          </div>
        )}
      </div>

      {anulado ? (
        <p className="tarjeta-hundida flex items-center gap-2.5 rounded-xl px-4 py-3 text-base">
          <Ban className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          {corte.motivoAnulado ?? "Anulado"}
        </p>
      ) : (
        <section className="tarjeta p-5">
          <Pasos etapas={ETAPAS_CORTE} actual={corte.estado} />
          {/* Deshacer va con la barra que deshace, como botón (M3S2-047). */}
          {(corte.estado === "en-proceso" || corte.estado === "terminado") && (
            <div className="mt-4 flex justify-end">
              <VolverUnPaso id={corte.id} estado={corte.estado} />
            </div>
          )}
        </section>
      )}

      {aviso && (
        <section className={aviso.yaAvisado ? "tarjeta p-5" : "tarjeta-atencion p-5"}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Avisarle que está terminado
          </h2>
          <AvisarPorWhatsapp aviso={aviso} atajo />
        </section>
      )}

      {/* Cómo entra en la placa y cuánto sale.
          Va arriba de todo porque es lo que se contesta primero cuando alguien
          pregunta por un corte en el mostrador: cuántas placas, si se le vende
          la placa entera, y cuánto es. */}
      {corte.piezas.length > 0 && (
        <PlanoVivo>
        <section className="tarjeta overflow-hidden">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-linea px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-medium">Cómo entra en la placa</h2>
              <p className="text-sm text-muted-foreground">
                {nombreDeLaMitad(corte.medida.mitad)} de {plano.placaLargo} ×{" "}
                {plano.placaAncho} mm
                {corte.medida.supuesta ? " · medida supuesta" : ""}
              </p>
              {/* Los milímetros que se lleva el disco, de este trabajo y
                  editables mientras no se cortó. */}
              <div className="text-sm text-muted-foreground">
                <SierraDelTrabajo
                  id={corte.id}
                  anchoSierra={corte.anchoSierraMm}
                  editable={corte.estado === "en-cola" && decide}
                />
              </div>
            </div>
            {/* Los papeles del trabajo en una sola fila, también a 375 px
                (H330): la hoja de la seccionadora y el plano a la vista, el
                resto en el menú. Sin partir el renglón: con el relleno de
                antes «Más archivos» bajaba solo a otro. Cada botón al ancho
                de su texto, para que «Hoja de corte» no se corte (H327). */}
            <div className="flex w-full flex-nowrap items-center gap-1.5 sm:w-auto sm:gap-2">
              <Link
                href={`/hoja-de-corte/${corte.id}`}
                target="_blank"
                className="inline-flex h-11 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-base font-medium transition-colors hover:bg-muted sm:flex-none sm:gap-1.5 sm:px-3"
              >
                <ListChecks className="h-5 w-5 shrink-0" />
                Hoja de corte
              </Link>
              <Link
                href={`/plano/${corte.id}`}
                target="_blank"
                className="inline-flex h-11 flex-auto items-center justify-center gap-1 whitespace-nowrap rounded-lg border px-2.5 text-base font-medium transition-colors hover:bg-muted sm:flex-none sm:gap-1.5 sm:px-3"
              >
                <Map className="h-5 w-5 shrink-0" />
                Plano
              </Link>
              <MasArchivos
                id={corte.id}
                formatos={perfiles.filter((p) => !p.porDefecto).map((p) => ({ id: p.id, nombre: p.nombre }))}
              />
            </div>
          </header>

          {/* De a dos en el teléfono: uno por renglón empujaba el plano a
              1.600 px (H330). */}
          {/* Sin cargo o anulado, sin la cifra de lo que se vende: tres, y
              el retal a lo ancho en el teléfono. */}
          <div className={`grid grid-cols-2 gap-px bg-linea ${noCobra ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}>
            <Cifra valor={String(nPlacas)} rotulo={rotuloPlacas} />
            {!noCobra && (
              <Cifra
                valor={String(plano.placasEnteras)}
                rotulo={rotuloEnteras}
                destacada={plano.placasEnteras > 0}
              />
            )}
            <Cifra
              valor={<PasadasVivas guardado={ficha.pasadasACobrar} />}
              rotulo={<RotuloDePasadas guardado={ficha.pasadasACobrar} aCobrar={!noCobra} />}
            />
            <RetalMayorVivo guardado={plano} ancha={noCobra} />
          </div>

          <div className="space-y-3 px-5 py-4">
            {!sinPlata && modo === "suelto" && (
              <dl className="space-y-1.5">
                {cuenta.placasEnteras > 0 && (
                  <Renglon
                    que={`${cuenta.placasEnteras} ${queSeVende} × ${formatearMonto(precioDeLaPlaca)}`}
                    cuanto={cuenta.subtotalPlacas}
                  />
                )}
                <RenglonesDelCorte cuenta={cuenta} />
                <Total texto="Total del trabajo" monto={cuenta.total} antes={ficha.totalTomado} cuenta={cuenta}>
                  {cobra && cuenta.total > 0 && corte.estado !== "terminado" && !anulado && <CobrarCorte id={corte.id} conPlaca={corte.variantId != null} />}
                </Total>
              </dl>
            )}

            {/* Atado a un pedido que vende las placas: no se cotizan otra
                vez, y lo del corte que el pedido no tiene se ve aparte
                (H184). */}
            {!sinPlata && modo === "pedido" && pedido && (
              <dl className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-base text-muted-foreground">Las placas</dt>
                  <dd className="text-base">
                    {/* En un acopio usar una de tres es lo normal: un dato,
                        no un aviso en rojo (mes simulado, M3S3-051). */}
                    {pedido.placasDelPedido > 0 && (
                      <span className="tabular">
                        {placasDeLasDelPedido(
                          (media ? nPlacas / 2 : nPlacas) + (pedido.placasDeOtrosCortes ?? 0),
                          pedido.placasDelPedido,
                          (n) => formatearDecimal(n),
                        )}{" "}
                      </span>
                    )}
                    en{" "}
                    {vePedidos ? (
                      <Link href={`/admin/pedidos/${corte.orderId}`} className="codigo hover:text-brand-orange">
                        {pedido.numero}
                      </Link>
                    ) : (
                      <span className="codigo">{pedido.numero}</span>
                    )}
                  </dd>
                </div>
                <RenglonesDelCorte cuenta={cuenta} />
                {cuenta.total > 0 && (
                  <Total texto="Fuera del pedido" monto={cuenta.total} cuenta={cuenta}>
                    {cobra && ficha.sumar && !anulado && (
                      <SumarAlPedido
                        id={corte.id}
                        numero={pedido.numero}
                        total={ficha.sumar.total}
                        aparte={ficha.sumar.aparte}
                        motivo={ficha.sumar.motivo}
                      />
                    )}
                  </Total>
                )}
              </dl>
            )}

            {/* Vendido en el mostrador: lo que se cobró, con el descuento de
                la venta, y no una cuenta nueva (H232, H114). */}
            {!sinPlata && modo === "vendido" && pedido && (
              <dl className="space-y-1.5">
                {pedido.lineas.map((l, i) => (
                  <Renglon key={i} que={l.descripcion} cuanto={l.subtotal} />
                ))}
                {/* «Cobrado en PED-1155 … Sin cobrar» se contradecía (H173,
                    H232): «Cobrado» lo dice el estado de pago del pedido, el
                    mismo que va al lado, y no que no quede nada para el
                    mostrador (un pedido a cuenta no está cobrado). */}
                {/* Lo del corte que fue a un pedido aparte (H184): ese es el
                    que se cobra. */}
                <Total
                  texto={
                    <>
                      {(pedido.cargoEstadoPago ?? pedido.estadoPago) === "pagado" ? "Cobrado en " : "Venta "}
                      <Link
                        href={`/admin/pedidos/${pedido.cargoId ?? corte.orderId}`}
                        className="codigo hover:text-brand-orange"
                      >
                        {pedido.cargo ?? pedido.numero}
                      </Link>
                    </>
                  }
                  monto={pedido.cobrado}
                >
                  <EtiquetaEstado estado={pedido.cargoEstadoPago ?? pedido.estadoPago} contexto="pago" />
                </Total>
              </dl>
            )}

            {modo === "sinCargo" && (
              <div className="space-y-3">
                <p className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                  <span className="font-semibold">Sin cargo</span>
                  {pedido && corte.orderId && (
                    <span className="text-muted-foreground">
                      reposición de{" "}
                      {/* El aserradero no abre pedidos: sin enlace para quien
                          no entra a Pedidos, como «Del pedido» (mes simulado
                          2, M3S2-015). */}
                      {vePedidos ? (
                        <Link href={`/admin/pedidos/${corte.orderId}`} className="codigo hover:text-brand-orange">
                          {pedido.numero}
                        </Link>
                      ) : (
                        <span className="codigo">{pedido.numero}</span>
                      )}
                    </span>
                  )}
                </p>
                {/* Entregada, con su remito para firmar: la firma cierra el
                    reclamo (H321). */}
                {decide && corte.estado === "retirado" && (
                  <RemitoDeLaReposicion id={corte.id} remito={ficha.remito} />
                )}
              </div>
            )}

            {cuenta.faltan.map((linea, i) => (
              <p
                key={`f${i}`}
                className="estado-problema rounded-lg bg-[var(--estado-fondo)] px-3.5 py-2 text-base font-medium"
              >
                {linea}
              </p>
            ))}

            {puedeCorregir && <CorregirOAnular id={corte.id} numero={corte.numero} cliente={corte.cliente} />}
          </div>

          {/* Lo que sobra, placa por placa, y de quién es: de una placa
              vendida entera —o que el pedido ya vende— el recorte se lo
              lleva el cliente. */}
          <div className="border-t border-linea px-5 py-4">
            <h3 className="text-base font-medium">Lo que sobra</h3>
            <SobrantesVivos guardado={plano} media={media} sinCargo={corte.sinCargo} todasDelCliente={ficha.retalesDelCliente} placaDelCliente={corte.variantId == null} />
            <p className="mt-2 text-sm text-muted-foreground">
              {Math.round(plano.aprovechadoTotal * 100)}% del material sale en
              piezas · sierra de {formatearSierra(plano.anchoSierra)}
            </p>
          </div>

          {/* Editable, no solo mirable: la decisión de qué pieza sale de qué
              placa se toma muchas veces después de cargar el trabajo. */}
          {/* Se acomoda a mano solo lo que todavía no pasó por la máquina, y
              solo desde el mostrador: el acomodo cambia lo que se cobra. El
              aserradero, o un corte ya cortado, ve el plano para mirar (mes
              simulado, ítem 8: «Arrastrá una pieza…» en cortes terminados). */}
          <div className="border-t border-linea px-5 py-4">
            {decide && corte.estado === "en-cola" ? (
              <AcomodoDelCorte
                id={corte.id}
                piezas={corte.piezas}
                placaLargo={plano.placaLargo}
                placaAncho={plano.placaAncho}
                anchoSierra={plano.anchoSierra}
                busqueda={corte.motorPlano >= 2}
                inicial={ficha.fijadas}
                quien={{ sinCargo: corte.sinCargo, media, todasDelCliente: ficha.retalesDelCliente, placaDelCliente: corte.variantId == null }}
              />
            ) : (
              <PlanoSimple plano={plano} media={media} piezas={corte.piezas} />
            )}
          </div>
        </section>
        </PlanoVivo>
      )}

      {/* El despiece a todo el ancho y los datos del trabajo en una fila de
          tarjetas arriba: al costado, la tabla quedaba en media pantalla y
          «720 × 560 mm» se partía en tres renglones a 1024 px (mes simulado,
          M2S1-151 y M3S1-039). */}
      <div className="flex flex-col gap-4">
        <section className="tarjeta order-2 overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 py-4">
            <h2 className="text-base font-medium">Despiece</h2>
            <p className="text-base text-muted-foreground">
              {plural(corte.piezas.length, "medida")} · {plural(totalPiezas, "pieza")}
            </p>
          </div>

          <table className="w-full border-t">
            <thead>
              <tr className="border-b text-left">
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Medida
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-muted-foreground">
                  Cantidad
                </th>
                <th className="hidden px-4 py-3 text-right text-sm font-medium text-muted-foreground sm:table-cell">
                  Superficie
                </th>
                <th className="px-5 py-3 text-sm font-medium text-muted-foreground">
                  Detalle
                </th>
              </tr>
            </thead>
            <tbody>
              {corte.piezas.map((pieza) => (
                <tr key={pieza.id} className="border-b last:border-0">
                  <td className="tabular whitespace-nowrap px-5 py-3.5 text-base">
                    {pieza.largoMm} × {pieza.anchoMm} mm
                  </td>
                  <td className="tabular px-4 py-3.5 text-right text-base">
                    {pieza.cantidad}
                  </td>
                  <td className="tabular hidden px-4 py-3.5 text-right text-base text-muted-foreground sm:table-cell">
                    {formatearDecimal(
                      (pieza.largoMm * pieza.anchoMm * pieza.cantidad) /
                        1_000_000,
                      2,
                      { fijo: true },
                    )}{" "}
                    m²
                  </td>
                  <td className="px-5 py-3.5 text-base text-muted-foreground">
                    {[
                      pieza.respetaVeta === 1 ? "Respeta veta" : null,
                      pieza.cantoLargo > 0
                        ? `Canto al largo${pieza.cantoLargo === 2 ? " ×2" : ""}`
                        : null,
                      pieza.cantoAncho > 0
                        ? `Canto al ancho${pieza.cantoAncho === 2 ? " ×2" : ""}`
                        : null,
                      pieza.aclaracion,
                      pieza.etiqueta,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t bg-muted/40">
              <tr>
                <td className="px-5 py-4 text-base font-medium">Total</td>
                <td className="tabular px-4 py-4 text-right text-base font-medium">
                  {totalPiezas}
                </td>
                {/* Como su encabezado: escondida en el teléfono, o el total
                    quedaba debajo de otra columna. */}
                <td className="tabular hidden px-4 py-4 text-right text-base font-medium sm:table-cell">
                  {formatearDecimal(superficie, 2, { fijo: true })} m²
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </section>

        <aside className="order-1 grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <section className="tarjeta p-5">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Material
            </h2>
            <p className="text-base">{corte.material}</p>
            {/* Una sola cifra de placas: la del plano, que es la que se
                guarda desde el alta (H113). */}
            <p className="mt-1 text-base text-muted-foreground">
              {nPlacas} {rotuloPlacas}
            </p>
            {corte.cantoDescripcion && (
              <p className="mt-1 text-base text-muted-foreground">
                Tapacanto: {corte.cantoDescripcion}
              </p>
            )}

            {/* El pegado de tapacanto se cobra aparte del corte, por metro
                lineal. Los metros salen del despiece. */}
            {metrosCanto > 0 && (
              <div className="mt-3 border-t pt-3">
                <p className="text-base">
                  <span className="tabular font-medium">
                    {formatearDecimal(metrosCanto)} m
                  </span>{" "}
                  de tapacanto a pegar
                </p>
                {!sinPlata && cargoCanto > 0 && (
                  <p className="mt-1 text-base text-muted-foreground">
                    {formatearMonto(tarifa?.precioPorMetroCanto ?? 0)} el metro
                  </p>
                )}
              </div>
            )}

            {/* Las pasadas a cobrar: las propone el plano y se corrigen acá
                si la máquina dio otras. Al terminar las confirma el taller en
                su tarjeta; esta corrección es del mostrador (H115). Solo donde
                cambian lo que se cobra. */}
            {cobra && !sinPlata && (modo === "suelto" || modo === "pedido") && !anulado && (
              <div className="mt-3 border-t pt-3">
                {/* La clave con las pasadas guardadas: el acomodo manual
                    las cambia y el campo seguía con las de antes hasta
                    recargar (mes 23). */}
                <CargarPasadas
                  key={corte.pasadas}
                  id={corte.id}
                  actuales={corte.pasadas}
                  sugeridas={plano.pasadasCobrables}
                />
              </div>
            )}
          </section>

          {corte.notas && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Indicaciones
              </h2>
              <p className="text-base text-muted-foreground">{corte.notas}</p>
            </section>
          )}

          <section className="tarjeta p-5">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              Cliente
            </h2>
            {corte.customerId && !sinPlata ? (
              <Link
                href={`/admin/clientes/${corte.customerId}`}
                className="text-base font-medium hover:text-brand-orange"
              >
                {corte.cliente}
              </Link>
            ) : (
              <p className="text-base font-medium">{corte.cliente}</p>
            )}
            {corte.telefono && (
              <a
                href={`tel:${corte.telefono.replace(/[^\d+]/g, "")}`}
                className="tabular mt-1 block text-base text-muted-foreground hover:text-foreground"
              >
                {telefonoLegible(corte.telefono)}
              </a>
            )}
            {corte.retiraEl && (
              <p className="mt-2 text-base">
                Lo retira el{" "}
                <strong className="tabular">{corte.retiraEl.split("-").reverse().join("/")}</strong>
              </p>
            )}
          </section>

          {/* De qué venta salió. Sin esto, quien está parado frente a la
              seccionadora no puede saber qué más lleva el cliente en el mismo
              viaje. */}
          {corte.orderId && (
            <section className="tarjeta p-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Del pedido
              </h2>
              {vePedidos ? (
                <Link
                  href={`/admin/pedidos/${corte.orderId}`}
                  className="tabular text-base font-medium hover:text-brand-orange"
                >
                  {corte.pedidoNumero}
                </Link>
              ) : (
                <p className="tabular text-base font-medium">{corte.pedidoNumero}</p>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Una cifra del encabezado del plano. */
function Cifra({
  valor,
  rotulo,
  destacada,
  ancha,
}: {
  valor: React.ReactNode;
  rotulo: React.ReactNode;
  destacada?: boolean;
  /** Ocupa el renglón entero en el teléfono (la tercera de tres). */
  ancha?: boolean;
}) {
  return (
    <div
      className={`px-5 py-3.5 ${ancha ? "col-span-2 sm:col-span-1" : ""} ${destacada ? "estado-marca bg-[var(--estado-fondo)]" : "bg-card"}`}
    >
      <p className="tabular text-2xl font-bold leading-none">{valor}</p>
      <p className="mt-1 text-sm text-muted-foreground">{rotulo}</p>
    </div>
  );
}

/** Un renglón de la cuenta del trabajo. */
function Renglon({ que, cuanto }: { que: React.ReactNode; cuanto: number | React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-base text-muted-foreground">{que}</dt>
      <dd className="tabular shrink-0 text-base">{typeof cuanto === "number" ? formatearMonto(cuanto) : cuanto}</dd>
    </div>
  );
}

/** Las pasadas y el tapacanto de la cuenta. */
function RenglonesDelCorte({
  cuenta,
}: {
  cuenta: { pasadasCobrables: number; precioPorPasada: number; subtotalCorte: number; metrosCanto: number; subtotalCanto: number };
}) {
  return (
    <>
      {/* Sin tarifa no se muestra el renglón: "15 pasadas × $ 0" se lee
          como que el corte sale gratis, cuando lo que pasa es que falta
          cargar el precio. El aviso de abajo lo dice. */}
      {cuenta.pasadasCobrables > 0 && cuenta.precioPorPasada > 0 && (
        <Renglon
          que={
            <>
              <PasadasVivas guardado={cuenta.pasadasCobrables} />{" "}
              <RotuloDePasadas guardado={cuenta.pasadasCobrables} aCobrar={false} /> × {formatearMonto(cuenta.precioPorPasada)}
            </>
          }
          cuanto={<MontoVivo monto={cuenta.subtotalCorte} pasadas={cuenta.pasadasCobrables} precioPorPasada={cuenta.precioPorPasada} />}
        />
      )}
      {cuenta.subtotalCanto > 0 && (
        <Renglon que={`${formatearDecimal(cuenta.metrosCanto)} m de tapacanto`} cuanto={cuenta.subtotalCanto} />
      )}
    </>
  );
}

function Total({
  texto,
  monto,
  antes,
  cuenta,
  children,
}: {
  texto: React.ReactNode;
  monto: number;
  /** Con la cuenta, el total sigue a las pasadas del acomodo que se prueba. */
  cuenta?: { pasadasCobrables: number; precioPorPasada: number };
  /** Lo que se le dijo al cliente al tomarlo: si cambió, va tachado al lado (M3S2-030). */
  antes?: number | null;
  children?: React.ReactNode;
}) {
  const cambio = antes != null && Math.abs(antes - monto) > 0.009;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-linea pt-2">
      <dt className="text-base font-semibold">{texto}</dt>
      <dd className="flex flex-wrap items-center gap-3">
        {cambio && (
          <s className="tabular text-base text-muted-foreground" title="Al tomarlo">
            {formatearMonto(antes)}
          </s>
        )}
        <span className="tabular text-xl font-bold">
          {cuenta ? (
            <MontoVivo monto={monto} pasadas={cuenta.pasadasCobrables} precioPorPasada={cuenta.precioPorPasada} />
          ) : (
            formatearMonto(monto)
          )}
        </span>
        {children}
      </dd>
    </div>
  );
}

/** Dos nombres que dicen lo mismo («Mueblería Atlántica» y «Mueblería Atlántica SRL»). */
function mismoNombre(a: string, b: string) {
  const limpio = (t: string) =>
    t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const x = limpio(a);
  const y = limpio(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
}
