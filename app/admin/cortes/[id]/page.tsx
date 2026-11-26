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
import { nombreDeLaMitad } from "@/lib/cortes/placa";
import { formatearMonto } from "@/lib/formato";
import { formatearDecimal } from "@/lib/unidades";
import { AccionesCorte, VolverUnPaso } from "../acciones";
import { CargarPasadas } from "../pasadas";
import { SierraDelTrabajo } from "./sierra";
import { formatearSierra } from "@/lib/cortes/sierra";
import { CobrarCorte, CorregirOAnular, MasArchivos } from "./gestion";

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
  const [ficha, usuario] = await Promise.all([fichaDeCorte(id), requireStaff()]);

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
            {corte.urgente && !anulado && (
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
            {corte.empresa && ` · ${corte.empresa}`}
            {corte.sucursal && ` · ${corte.sucursal}`}
            {` · ${fechaHora.format(corte.createdAt)}`}
          </p>
        </div>

        {!anulado && (
          <div className="flex flex-wrap items-center gap-2">
            <VolverUnPaso id={corte.id} estado={corte.estado} />
            {/* El suelto con algo para cobrar no se entrega con un clic: se
                cobra (H348). */}
            {corte.estado === "terminado" && modo === "suelto" && cuenta.total > 0 && cobra ? (
              <CobrarCorte id={corte.id} />
            ) : corte.estado === "terminado" && corte.orderId && pedido && !corte.cobrado && modo !== "sinCargo" && cobra ? (
              /* Con la venta hecha y sin cobrar, lo que sigue es cobrarla en
                 su pedido: «Marcar retirado» se rechazaba y «Cobrar en el
                 mostrador» abría el mostrador vacío (mes simulado, H173). */
              <Link
                href={`/admin/pedidos/${corte.orderId}`}
                className="boton-accion inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg px-4 text-base font-medium sm:w-auto"
              >
                <ReceiptText className="h-5 w-5" aria-hidden="true" />
                Cobrar <span className="codigo">{pedido.numero}</span>
              </Link>
            ) : (
              <AccionesCorte
                id={corte.id}
                estado={corte.estado}
                urgente={corte.urgente}
                pasadas={ficha.pasadasACobrar}
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
            {/* Los papeles del trabajo en una fila: la hoja de la
                seccionadora y el plano a la vista, el resto en el menú. */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Link
                href={`/hoja-de-corte/${corte.id}`}
                target="_blank"
                className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted sm:flex-none"
              >
                <ListChecks className="h-5 w-5 shrink-0" />
                <span className="truncate">Hoja de corte</span>
              </Link>
              <Link
                href={`/plano/${corte.id}`}
                target="_blank"
                className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-medium transition-colors hover:bg-muted sm:flex-none"
              >
                <Map className="h-5 w-5 shrink-0" />
                <span className="truncate">Plano</span>
              </Link>
              <MasArchivos id={corte.id} />
            </div>
          </header>

          {/* De a dos en el teléfono: uno por renglón empujaba el plano a
              1.600 px (H330). */}
          <div className="grid grid-cols-2 gap-px bg-linea sm:grid-cols-4">
            <Cifra valor={String(nPlacas)} rotulo={rotuloPlacas} />
            <Cifra
              valor={String(plano.placasEnteras)}
              rotulo={rotuloEnteras}
              destacada={plano.placasEnteras > 0}
            />
            <Cifra
              valor={String(ficha.pasadasACobrar)}
              rotulo={
                modo === "sinCargo"
                  ? ficha.pasadasACobrar === 1 ? "pasada" : "pasadas"
                  : ficha.pasadasACobrar === 1 ? "pasada a cobrar" : "pasadas a cobrar"
              }
            />
            <Cifra
              valor={
                plano.recorteMayor
                  ? `${plano.recorteMayor.ancho}×${plano.recorteMayor.alto}`
                  : "—"
              }
              rotulo={
                plano.recorteMayor ? "retal mayor, en mm" : "sin retal útil"
              }
            />
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
                <Total texto="Total del trabajo" monto={cuenta.total}>
                  {cobra && cuenta.total > 0 && corte.estado !== "terminado" && !anulado && <CobrarCorte id={corte.id} />}
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
                    en{" "}
                    <Link href={`/admin/pedidos/${corte.orderId}`} className="codigo hover:text-brand-orange">
                      {pedido.numero}
                    </Link>
                  </dd>
                </div>
                <RenglonesDelCorte cuenta={cuenta} />
                {cuenta.total > 0 && <Total texto="Fuera del pedido" monto={cuenta.total} />}
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
                <Total
                  texto={
                    <>
                      {pedido.estadoPago === "pagado" ? "Cobrado en " : "Venta "}
                      <Link href={`/admin/pedidos/${corte.orderId}`} className="codigo hover:text-brand-orange">
                        {pedido.numero}
                      </Link>
                    </>
                  }
                  monto={pedido.cobrado}
                >
                  <EtiquetaEstado estado={pedido.estadoPago} contexto="pago" />
                </Total>
              </dl>
            )}

            {modo === "sinCargo" && (
              <p className="flex flex-wrap items-baseline justify-between gap-2 text-base">
                <span className="font-semibold">Sin cargo</span>
                {pedido && corte.orderId && (
                  <span className="text-muted-foreground">
                    reposición de{" "}
                    <Link href={`/admin/pedidos/${corte.orderId}`} className="codigo hover:text-brand-orange">
                      {pedido.numero}
                    </Link>
                  </span>
                )}
              </p>
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
            <ul className="mt-2 space-y-1.5">
              {plano.placas.map((placa) => (
                <li key={placa.numero} className="text-base">
                  <span className="text-muted-foreground">
                    {media ? "Media" : "Placa"} {placa.numero}:
                  </span>{" "}
                  {placa.recortes.length === 0 ? (
                    <span className="text-muted-foreground">
                      sin pedazos enteros que valga guardar
                    </span>
                  ) : (
                    <>
                      {placa.recortes
                        .map((r) => `${r.ancho} × ${r.alto} mm`)
                        .join(" · ")}{" "}
                      <span className="text-muted-foreground">
                        ({placa.seVendeEntera || ficha.retalesDelCliente
                          ? "del cliente"
                          : "al stock"})
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted-foreground">
              {Math.round(plano.aprovechadoTotal * 100)}% del material sale en
              piezas · sierra de {formatearSierra(plano.anchoSierra)}
            </p>
          </div>

          {/* Editable, no solo mirable: la decisión de qué pieza sale de qué
              placa se toma muchas veces después de cargar el trabajo. */}
          <div className="border-t border-linea px-5 py-4">
            <AcomodoDelCorte
              id={corte.id}
              piezas={corte.piezas}
              placaLargo={plano.placaLargo}
              placaAncho={plano.placaAncho}
              anchoSierra={plano.anchoSierra}
              busqueda={corte.motorPlano >= 2}
              inicial={ficha.fijadas}
            />
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <section className="tarjeta overflow-hidden">
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
                  <td className="tabular px-5 py-3.5 text-base">
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

        <aside className="space-y-4">
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
            {decide && !sinPlata && (modo === "suelto" || modo === "pedido") && !anulado && (
              <div className="mt-3 border-t pt-3">
                <CargarPasadas
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
                {corte.telefono}
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
              <Link
                href={`/admin/pedidos/${corte.orderId}`}
                className="tabular text-base font-medium hover:text-brand-orange"
              >
                {corte.pedidoNumero}
              </Link>
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
}: {
  valor: string;
  rotulo: string;
  destacada?: boolean;
}) {
  return (
    <div
      className={`px-5 py-3.5 ${destacada ? "estado-marca bg-[var(--estado-fondo)]" : "bg-card"}`}
    >
      <p className="tabular text-2xl font-bold leading-none">{valor}</p>
      <p className="mt-1 text-sm text-muted-foreground">{rotulo}</p>
    </div>
  );
}

/** Un renglón de la cuenta del trabajo. */
function Renglon({ que, cuanto }: { que: string; cuanto: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-base text-muted-foreground">{que}</dt>
      <dd className="tabular shrink-0 text-base">{formatearMonto(cuanto)}</dd>
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
          que={`${cuenta.pasadasCobrables} ${cuenta.pasadasCobrables === 1 ? "pasada" : "pasadas"} × ${formatearMonto(cuenta.precioPorPasada)}`}
          cuanto={cuenta.subtotalCorte}
        />
      )}
      {cuenta.subtotalCanto > 0 && (
        <Renglon que={`${formatearDecimal(cuenta.metrosCanto)} m de tapacanto`} cuanto={cuenta.subtotalCanto} />
      )}
    </>
  );
}

function Total({ texto, monto, children }: { texto: React.ReactNode; monto: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-linea pt-2">
      <dt className="text-base font-semibold">{texto}</dt>
      <dd className="flex flex-wrap items-center gap-3">
        <span className="tabular text-xl font-bold">{formatearMonto(monto)}</span>
        {children}
      </dd>
    </div>
  );
}
