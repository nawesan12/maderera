import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowLeft, BellOff, Check, CircleAlert, ExternalLink, RefreshCw, Stethoscope } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import {
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
import { fechaHora } from "@/lib/formato";
import type { Diagnostico } from "@/lib/whatsapp/tipos";
import { FilaAviso } from "./aviso";
import { BotonAccion, MensajeDePrueba } from "./controles";

export const metadata: Metadata = { title: "WhatsApp · Configuración" };

/** USD por mensaje entregado a un número argentino, desde el 1/10/2026 (hoja oficial de Meta). */
const TARIFA: Record<string, number> = {
  marketing: 0.0618,
  utility: 0.026,
  authentication: 0.026,
  service: 0.026,
};

const NOMBRE_CATEGORIA: Record<string, string> = {
  marketing: "Promoción",
  utility: "Utilidad (avisos)",
  authentication: "Verificación",
  service: "Servicio (respuestas)",
};

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

  const [estado, avisos, guardadas, diagnosticoGuardado, gasto, bajas] = await Promise.all([
    estadoWhatsapp(),
    listarAvisos(),
    plantillasGuardadas(),
    ultimoDiagnostico(),
    gastoDelMes(),
    bajasRegistradas(),
  ]);

  const enDemo = estado.proveedor === "demo";
  const diagnostico = (diagnosticoGuardado?.diagnostico ?? null) as Diagnostico | null;
  const aprobada = (nombre: string) =>
    enDemo || guardadas.some((g) => g.nombre === nombre && g.estado === "APPROVED");
  const urlWebhook = `${urlBase()}/api/whatsapp/webhook`;

  const servicio = gasto.filter((g) => g.categoria === "service");
  const cobrables = gasto.filter((g) => g.cobrable);
  const totalUsd = cobrables.reduce((suma, g) => suma + g.total * (TARIFA[g.categoria] ?? 0), 0);

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

      {/* 2. Gasto */}
      <section>
        <h2 className="text-lg font-medium">Lo que va del mes</h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Desde el 1/10/2026 Meta cobra cada mensaje entregado, también las respuestas dentro de las 24 h (pasadas las
          primeras del mes, que son gratis). Esto se cuenta con lo que Meta informa en cada estado; la factura de
          Meta es la que vale.
        </p>
        {gasto.length === 0 ? (
          <p className="tarjeta-hundida mt-3 p-4 text-base text-muted-foreground">Este mes todavía no salió nada por la Cloud API.</p>
        ) : (
          <table className="tarjeta mt-3 w-full max-w-2xl text-base">
            <thead>
              <tr className="border-b text-left text-sm text-muted-foreground">
                <th className="px-4 py-2 font-medium">Categoría</th>
                <th className="px-4 py-2 text-right font-medium">Gratis</th>
                <th className="px-4 py-2 text-right font-medium">Cobrados</th>
                <th className="px-4 py-2 text-right font-medium">USD aprox.</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(NOMBRE_CATEGORIA)
                .filter((c) => gasto.some((g) => g.categoria === c))
                .map((categoria) => {
                  const gratis = gasto.filter((g) => g.categoria === categoria && !g.cobrable).reduce((s, g) => s + g.total, 0);
                  const cobrados = gasto.filter((g) => g.categoria === categoria && g.cobrable).reduce((s, g) => s + g.total, 0);
                  return (
                    <tr key={categoria} className="border-b last:border-0">
                      <td className="px-4 py-2">{NOMBRE_CATEGORIA[categoria]}</td>
                      <td className="tabular px-4 py-2 text-right">{gratis}</td>
                      <td className="tabular px-4 py-2 text-right">{cobrados}</td>
                      <td className="tabular px-4 py-2 text-right">{(cobrados * (TARIFA[categoria] ?? 0)).toFixed(2)}</td>
                    </tr>
                  );
                })}
              <tr className="font-medium">
                <td className="px-4 py-2" colSpan={3}>
                  Total estimado
                  {servicio.length > 0 && <span className="font-normal text-muted-foreground"> (sin impuestos)</span>}
                </td>
                <td className="tabular px-4 py-2 text-right">{totalUsd.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {/* 3. Avisos automáticos */}
      <section>
        <h2 className="text-lg font-medium">Avisos automáticos</h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Cuando pasa algo —un pedido queda listo, se registra un pago— el cliente recibe el mensaje sin que nadie lo
          escriba. Empiezan todos apagados a propósito: cada uno que sale se cobra (USD 0,026 a un número argentino).
          Si el cliente escribió hace menos de 24 h sale el texto de abajo; si no, la plantilla aprobada.
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
