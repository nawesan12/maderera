import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowLeft, BellOff, Check, CircleAlert, ExternalLink, RefreshCw, Stethoscope } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
  avisosCortadosPorTope,
  bajasRegistradas,
  estadoWhatsapp,
  gastoDelMes,
  listarAvisos,
  ultimoDiagnostico,
} from "@/lib/dal/admin/whatsapp";
import { requireStaffRole } from "@/lib/dal/session";
import { EVENTOS_WHATSAPP, sembrarAvisos } from "@/lib/whatsapp/avisos";
import { plantillasGuardadas } from "@/lib/whatsapp/catalogo";
import { PLANTILLAS_BASE } from "@/lib/whatsapp/plantillas-base";
import { leerPlantilla, marcadores, nombreLegible } from "@/lib/whatsapp/plantillas";
import { numeroLegible } from "@/lib/whatsapp/numeros";
import { urlBase } from "@/lib/pagos/config";
import { fechaCorta, fechaHora } from "@/lib/formato";
import { CATEGORIAS_COBRO, dolares, NOMBRE_CATEGORIA, tarifaLegible } from "@/lib/whatsapp/costos";
import type { Diagnostico } from "@/lib/whatsapp/tipos";
import { FilaAviso } from "./aviso";
import { BotonAccion, FormularioTope, MensajeDePrueba } from "./controles";

export const metadata: Metadata = { title: "WhatsApp · Configuración" };

/**
 * La configuración de WhatsApp, para el admin.
 *
 * Contesta cuatro preguntas, en este orden: ¿está bien conectado? (el chequeo
 * contra Meta y el mensaje de prueba), ¿qué se avisa solo? (los interruptores,
 * que nacen apagados porque cada mensaje se cobra), ¿qué textos tiene que
 * aprobar Meta? y ¿quién pidió no recibir nada?
 */
export default async function ConfiguracionWhatsappPage() {
  await requireStaffRole("admin");
  // La primera vez deja los interruptores creados y apagados.
  await sembrarAvisos();

  const [estado, avisos, guardadas, diagnosticoGuardado, gasto, bajas, cortados] = await Promise.all([
    estadoWhatsapp(),
    listarAvisos(),
    plantillasGuardadas(),
    ultimoDiagnostico(),
    gastoDelMes(),
    bajasRegistradas(),
    avisosCortadosPorTope(),
  ]);

  const enDemo = estado.proveedor === "demo";
  const diagnostico = (diagnosticoGuardado?.diagnostico ?? null) as Diagnostico | null;
  const aprobada = (nombre: string) =>
    enDemo || guardadas.some((g) => g.nombre === nombre && g.estado === "APPROVED");
  const urlWebhook = `${urlBase()}/api/whatsapp/webhook`;

  const categoriasConMovimiento = CATEGORIAS_COBRO.filter((c) => {
    const d = gasto.porCategoria[c];
    return d.gratis + d.cobrados + d.estimados > 0;
  });
  const porcentaje = Math.round(gasto.proporcion * 100);

  return (
    <div className="space-y-8">
      <Link
        href="/admin/whatsapp"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a la bandeja
      </Link>

      <EncabezadoPanel
        titulo="WhatsApp: configuración"
        detalle="Si está bien conectado, qué se avisa solo, qué textos aprueba Meta y cuánto se gasta."
      />

      {/* 1. Conexión */}
      <section className="space-y-4">
        <h2 className="text-lg font-medium">¿Está bien conectado?</h2>

        {enDemo ? (
          <div className="tarjeta-atencion p-5">
            <p className="text-base">
              Hoy está en <span className="font-medium">modo demostración</span>: la bandeja guarda todo pero no envía.
              Para conectar el número hay que hacer el trámite en Meta (está paso a paso en{" "}
              <span className="tabular">docs/WHATSAPP.md</span>) y cargar las variables en el servidor.
            </p>
          </div>
        ) : (
          <div className="tarjeta space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-base text-muted-foreground">
                {diagnosticoGuardado?.diagnosticoAt
                  ? `Último chequeo: ${fechaHora.format(diagnosticoGuardado.diagnosticoAt)}.`
                  : "Todavía no se hizo ningún chequeo."}
              </p>
              <BotonAccion accion="diagnosticar" texto="Probar la conexión" icono={<Stethoscope className="h-5 w-5" />} />
            </div>

            {diagnostico && (
              <ul className="divide-y rounded-lg border">
                {diagnostico.puntos.map((punto) => (
                  <li key={punto.clave} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        punto.estado === "ok"
                          ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                          : punto.estado === "aviso"
                            ? "estado-espera bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                            : "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                      }`}
                    >
                      {punto.estado === "ok" ? <Check className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="text-base font-medium">
                        {punto.titulo}
                        <span className="sr-only">: {punto.estado === "ok" ? "bien" : punto.estado === "aviso" ? "atención" : "con problema"}</span>
                      </p>
                      <p className="text-base text-muted-foreground">{punto.detalle}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="border-t pt-4">
              <h3 className="mb-2 text-base font-medium">Mensaje de prueba</h3>
              <MensajeDePrueba />
            </div>
          </div>
        )}

        <dl className="tarjeta-hundida grid gap-x-6 gap-y-2 p-5 text-base sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Dirección del webhook</dt>
          <dd className="tabular break-all">{urlWebhook}</dd>
          <dt className="text-muted-foreground">Verify token</dt>
          <dd>{process.env.WHATSAPP_WEBHOOK_SECRET ? "cargado (WHATSAPP_WEBHOOK_SECRET)" : "falta WHATSAPP_WEBHOOK_SECRET"}</dd>
          <dt className="text-muted-foreground">Firma de Meta</dt>
          <dd>{process.env.WHATSAPP_APP_SECRET ? "se valida (WHATSAPP_APP_SECRET)" : "falta WHATSAPP_APP_SECRET: se rechaza todo lo que llega"}</dd>
          <dt className="text-muted-foreground">Último aviso de Meta</dt>
          <dd>
            {estado.ultimoWebhookAt
              ? fechaHora.format(new Date(estado.ultimoWebhookAt))
              : "nunca: si ya está conectado, el webhook no está suscripto"}
          </dd>
          {diagnosticoGuardado?.calidad && (
            <>
              <dt className="text-muted-foreground">Calidad del número</dt>
              <dd>{diagnosticoGuardado.calidad}</dd>
            </>
          )}
        </dl>
      </section>

      {/* 2. Gasto y tope */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-medium">Lo que va del mes</h2>
          <p className="mt-1 max-w-2xl text-base text-muted-foreground">
            Desde el 1/10/2026 Meta cobra cada mensaje que sale por la API, también las respuestas dentro de las 24 h.
            Lo que se manda desde la app WhatsApp Business del teléfono no se cobra. Esto se cuenta con lo que Meta
            informa en cada estado (y estima lo que acaba de salir); la factura de Meta es la que vale.
          </p>
        </div>

        <div className={gasto.alcanzado ? "tarjeta-atencion space-y-3 p-5" : "tarjeta space-y-3 p-5"}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-base">
              <span className="tabular text-2xl font-semibold">{dolares(gasto.usd)}</span>{" "}
              <span className="text-muted-foreground">de {dolares(gasto.tope)} este mes</span>
            </p>
            <p className="tabular text-base text-muted-foreground">{porcentaje} %</p>
          </div>
          <div
            role="meter"
            aria-label="Gasto del mes contra el tope"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(porcentaje, 100)}
            className="h-3 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={`h-full rounded-full ${
                gasto.alcanzado ? "bg-red-600" : gasto.umbral === 80 ? "bg-amber-500" : "bg-brand-green"
              }`}
              style={{ width: `${Math.min(porcentaje, 100)}%` }}
            />
          </div>
          <p className="text-base">
            {gasto.alcanzado ? (
              <>
                <span className="font-medium">Se llegó al tope.</span> Los avisos automáticos no salen por WhatsApp
                hasta el {fechaCorta.format(gasto.reinicio)}; el correo sale igual. Lo que se mande desde la bandeja por
                la API pide confirmación. Abajo están los que no salieron, para avisar desde el teléfono.
              </>
            ) : gasto.umbral === 80 ? (
              "Pasó el 80 % del tope. Conviene contestar desde el teléfono, que es gratis."
            ) : (
              "Al llegar al tope, los avisos automáticos dejan de salir por WhatsApp hasta el mes siguiente."
            )}
            {gasto.usdEstimado > 0 && (
              <span className="text-muted-foreground"> ({dolares(gasto.usdEstimado)} estimados: Meta todavía no informó el cobro.)</span>
            )}
          </p>
        </div>

        {categoriasConMovimiento.length > 0 && (
          <table className="tarjeta w-full max-w-2xl text-base">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="px-4 py-2 font-medium">Categoría</th>
                <th className="px-4 py-2 text-right font-medium">Gratis</th>
                <th className="px-4 py-2 text-right font-medium">Cobrados</th>
                <th className="px-4 py-2 text-right font-medium">USD</th>
              </tr>
            </thead>
            <tbody>
              {categoriasConMovimiento.map((categoria) => {
                const d = gasto.porCategoria[categoria];
                return (
                  <tr key={categoria} className="border-b last:border-0">
                    <td className="px-4 py-2">{NOMBRE_CATEGORIA[categoria]}</td>
                    <td className="tabular px-4 py-2 text-right">{d.gratis}</td>
                    <td className="tabular px-4 py-2 text-right">
                      {d.cobrados}
                      {d.estimados > 0 && <span className="text-muted-foreground"> + {d.estimados}</span>}
                    </td>
                    <td className="tabular px-4 py-2 text-right">{d.usd.toFixed(2).replace(".", ",")}</td>
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="px-4 py-2" colSpan={3}>
                  Total estimado <span className="font-normal text-muted-foreground">(sin impuestos)</span>
                </td>
                <td className="tabular px-4 py-2 text-right">{gasto.usd.toFixed(2).replace(".", ",")}</td>
              </tr>
            </tbody>
          </table>
        )}

        <div className="tarjeta-hundida p-5">
          <h3 className="mb-1 text-base font-medium">Tope y tarifas</h3>
          <p className="mb-3 max-w-2xl text-base text-muted-foreground">
            Las tarifas son las de Meta para un número argentino; Meta las revisa cada trimestre, así que se pueden
            cambiar acá sin tocar el sistema. Un tope de 0 es «por la API, ningún aviso automático».
          </p>
          <FormularioTope tope={gasto.tope} tarifas={gasto.tarifas} />
        </div>

        {cortados.length > 0 && (
          <div>
            <h3 className="mb-2 text-base font-medium">
              No salieron por el tope ({cortados.length})
            </h3>
            <ul className="tarjeta divide-y">
              {cortados.map((c) => (
                <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                  <span className="text-base font-medium">
                    {EVENTOS_WHATSAPP.find((e) => e.evento === c.evento)?.titulo ?? c.evento}
                    {c.asunto ? ` · ${c.asunto}` : ""}
                  </span>
                  <span className="tabular text-sm text-muted-foreground">
                    {numeroLegible(c.destinatario)} · {fechaHora.format(c.fecha)}
                  </span>
                  <span
                    className={`text-sm ${
                      c.avisadoAMano || c.correo === "salio" ? "text-muted-foreground" : "estado-espera font-medium text-[var(--estado-tinta)]"
                    }`}
                  >
                    {c.avisadoAMano
                      ? "Ya se avisó a mano."
                      : c.correo === "salio"
                        ? "Le llegó el correo."
                        : c.correo === "fallo"
                          ? "El correo no salió: avisale a mano."
                          : "No tiene correo: avisale a mano."}
                  </span>
                  {c.enlace && !c.avisadoAMano && (
                    <Link href={c.enlace} className="text-sm font-medium text-brand-orange hover:underline">
                      Avisar gratis desde ahí
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 3. Avisos automáticos */}
      <section>
        <h2 className="text-lg font-medium">Avisos automáticos</h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Cuando pasa algo —un pedido queda listo, se registra un pago— el cliente recibe el mensaje sin que nadie lo
          escriba. Empiezan todos apagados a propósito: cada uno que sale se cobra ({tarifaLegible(gasto.tarifas.utility)} a
          un número argentino). Lo recomendado es dejarlos apagados y usar el botón «Avisar por WhatsApp» de cada
          pedido, corte o cheque, que lo manda una persona desde el teléfono y no cuesta nada. Si el cliente escribió
          hace menos de 24 h sale el texto de abajo; si no, la plantilla aprobada.
        </p>

        <ul className="mt-4 space-y-3">
          {[...avisos]
            .sort(
              (a, b) =>
                EVENTOS_WHATSAPP.findIndex((e) => e.evento === a.evento) -
                EVENTOS_WHATSAPP.findIndex((e) => e.evento === b.evento),
            )
            .map((aviso) => {
            const definicion = EVENTOS_WHATSAPP.find((e) => e.evento === aviso.evento);
            return (
              <FilaAviso
                key={aviso.id}
                aviso={{
                  id: aviso.id,
                  evento: aviso.evento,
                  plantilla: aviso.plantilla,
                  textoLibre: aviso.textoLibre,
                  activo: aviso.activo,
                  titulo: definicion?.titulo ?? aviso.evento,
                  cuando: definicion?.cuando ?? "",
                  plantillaAprobada: aprobada(aviso.plantilla),
                  datos: definicion ? marcadores(definicion.textoLibre) : ["nombre"],
                }}
              />
            );
          })}
        </ul>
      </section>

      {/* 4. Plantillas */}
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Mensajes que tiene que aprobar Meta</h2>
            <p className="mt-1 max-w-2xl text-base text-muted-foreground">
              Hay que cargarlos en el administrador de WhatsApp de Meta con el mismo nombre, idioma «Spanish
              (ARG)» y categoría «Utility». El texto exacto y los ejemplos están en docs/WHATSAPP.md.
            </p>
          </div>
          {!enDemo && <BotonAccion accion="sincronizar" texto="Traer de Meta" icono={<RefreshCw className="h-5 w-5" />} />}
        </div>

        <ul className="mt-4 space-y-2.5">
          {PLANTILLAS_BASE.map((base) => {
            const enMeta = guardadas.find((g) => g.nombre === base.nombre);
            const leida = leerPlantilla({
              nombre: base.nombre,
              idioma: base.idioma,
              categoria: base.categoria,
              formato: base.formatoParametros,
              componentes: base.componentes,
            });
            const estadoMeta = enDemo ? null : (enMeta?.estado ?? "NO CARGADA");
            return (
              <li key={base.nombre} className={estadoMeta && estadoMeta !== "APPROVED" ? "tarjeta-hundida p-4" : "tarjeta p-4"}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="tabular text-base font-medium">{base.nombre}</span>
                  <span className="text-sm text-muted-foreground">
                    {nombreLegible(base.nombre)} · {base.uso}
                  </span>
                  {estadoMeta && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-sm ${
                        estadoMeta === "APPROVED"
                          ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                          : estadoMeta === "REJECTED"
                            ? "estado-problema bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                            : "estado-espera bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                      }`}
                    >
                      {ESTADOS_PLANTILLA[estadoMeta] ?? estadoMeta}
                      {enMeta?.categoria && enMeta.categoria !== "UTILITY" ? ` · Meta la pasó a ${enMeta.categoria}` : ""}
                    </span>
                  )}
                </div>
                {leida.encabezadoMedia && <p className="mt-1.5 text-sm text-muted-foreground">Encabezado: el PDF</p>}
                <p className="mt-1.5 text-base">{leida.cuerpo}</p>
                {enMeta?.motivoRechazo && (
                  <p className="mt-1 flex items-center gap-1.5 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    Motivo: {enMeta.motivoRechazo}
                  </p>
                )}
              </li>
            );
          })}
          {guardadas
            .filter((g) => !PLANTILLAS_BASE.some((b) => b.nombre === g.nombre))
            .map((g) => (
              <li key={`${g.nombre}-${g.idioma}`} className="tarjeta-hundida p-4">
                <span className="tabular text-base font-medium">{g.nombre}</span>{" "}
                <span className="text-sm text-muted-foreground">
                  {g.idioma} · {g.categoria} · {ESTADOS_PLANTILLA[g.estado] ?? g.estado} · cargada en Meta, no la usa
                  ningún aviso
                </span>
              </li>
            ))}
        </ul>
      </section>

      {/* 5. Bajas */}
      <section>
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <BellOff className="h-5 w-5 text-muted-foreground" />
          Números que pidieron no recibir avisos
        </h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          WhatsApp obliga a respetarlo. Se registra solo cuando alguien escribe BAJA, o desde la conversación. A estos
          números no les sale ningún aviso automático; si escriben, se les contesta igual.
        </p>
        {bajas.length === 0 ? (
          <p className="tarjeta-hundida mt-3 p-4 text-base text-muted-foreground">Nadie pidió la baja.</p>
        ) : (
          <ul className="tarjeta mt-3 divide-y">
            {bajas.map((b) => (
              <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                <Link href={`/admin/whatsapp?chat=${b.id}`} className="text-base font-medium hover:underline">
                  {b.nombre}
                </Link>
                <span className="tabular text-sm text-muted-foreground">{numeroLegible(b.waJid)}</span>
                <span className="text-sm text-muted-foreground">
                  {b.bajaAt ? fechaHora.format(b.bajaAt) : ""} · {b.bajaDetalle}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <a
        href="https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-base font-medium text-brand-orange hover:underline"
      >
        Documentación oficial de Meta
        <ExternalLink className="h-4 w-4" />
      </a>
    </div>
  );
}

const ESTADOS_PLANTILLA: Record<string, string> = {
  APPROVED: "aprobada",
  PENDING: "en revisión",
  REJECTED: "rechazada",
  PAUSED: "pausada por baja calidad",
  DISABLED: "desactivada",
  "NO CARGADA": "no cargada en Meta",
  IN_APPEAL: "en apelación",
};
