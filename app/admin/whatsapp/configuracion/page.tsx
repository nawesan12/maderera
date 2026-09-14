import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Check, CircleDot, ExternalLink } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { estadoWhatsapp, listarAvisos, listarPlantillas } from "@/lib/dal/admin/whatsapp";
import { sembrarAvisos } from "@/lib/whatsapp/avisos";
import { FilaAviso } from "./aviso";

export const metadata: Metadata = { title: "WhatsApp · Configuración" };

/**
 * Pasos para que WhatsApp salga del modo demostración.
 *
 * Están escritos como lo que son: trámites del cliente ante Meta, no cosas que
 * se resuelvan tocando el sistema. Tenerlos a la vista y en orden evita la
 * conversación de "¿por qué todavía no anda?" cada dos semanas.
 */
const PASOS = [
  {
    titulo: "Verificar la empresa en Meta",
    detalle:
      "Meta pide la constancia de CUIT y los datos fiscales para confirmar que el negocio existe. Lo hace el titular y suele tardar días.",
    quien: "negocio",
    variable: null,
  },
  {
    titulo: "Pasar el número de WhatsApp a la cuenta de empresa",
    detalle:
      "Es el paso que más cuesta: el número que hoy se usa en la aplicación de WhatsApp Business hay que mudarlo, y una vez mudado deja de funcionar en el teléfono. Se puede arrancar con un número nuevo para no cortar la atención.",
    quien: "negocio",
    variable: "WHATSAPP_PHONE_NUMBER_ID",
  },
  {
    titulo: "Permiso permanente para enviar mensajes",
    detalle:
      "Lo genera quien mantiene el sistema, dentro de la cuenta de Meta del negocio. El permiso de prueba se vence en un día y no sirve para trabajar.",
    quien: "sistema",
    variable: "WHATSAPP_ACCESS_TOKEN",
  },
  {
    titulo: "Avisarle a Meta a qué dirección mandar los mensajes",
    detalle:
      "Sin esto los mensajes de los clientes no entran a la bandeja. Lo configura quien mantiene el sistema.",
    quien: "sistema",
    variable: "WHATSAPP_WEBHOOK_SECRET",
  },
  {
    titulo: "La clave que prueba que los mensajes vienen de Meta",
    detalle:
      "Sin ella el sistema rechaza todo lo que llega: es lo que impide que cualquiera que descubra la dirección escriba mensajes falsos.",
    quien: "sistema",
    variable: "WHATSAPP_APP_SECRET",
  },
  {
    titulo: "Que Meta apruebe los textos de los avisos",
    detalle:
      "Meta revisa y aprueba cada texto antes de que se pueda usar. Los que necesita el sistema están más abajo, listos para copiar tal cual.",
    quien: "negocio",
    variable: "WHATSAPP_BUSINESS_ACCOUNT_ID",
  },
];

export default async function ConfiguracionWhatsappPage() {
  // La primera vez deja los interruptores creados y apagados: una pantalla
  // vacía no deja entender qué se puede prender.
  await sembrarAvisos();

  const [estado, avisos, plantillas] = await Promise.all([
    estadoWhatsapp(),
    listarAvisos(),
    listarPlantillas(),
  ]);

  const enDemo = estado.proveedor === "demo";

  return (
    <div className="space-y-6">
      <Link
        href="/admin/whatsapp"
        className="inline-flex items-center gap-2 text-base text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-5 w-5" />
        Volver a la bandeja
      </Link>

      <EncabezadoPanel
        titulo="WhatsApp: configuración"
        detalle="Qué falta para que los mensajes salgan de verdad, y qué se avisa solo."
      />

      {/* Avisos automáticos */}
      <section>
        <h2 className="text-lg font-medium">Avisos automáticos</h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Cuando un pedido cambia de estado, el cliente recibe el mensaje sin
          que nadie tenga que escribirlo. Empiezan todos apagados a propósito:
          cada aviso que sale fuera de las 24 horas de la última respuesta del
          cliente es una conversación que Meta cobra.
        </p>

        <ul className="mt-4 space-y-3">
          {avisos.map((aviso) => (
            <FilaAviso
              key={aviso.id}
              aviso={{
                id: aviso.id,
                evento: aviso.evento,
                plantilla: aviso.plantilla,
                textoLibre: aviso.textoLibre,
                activo: aviso.activo,
              }}
            />
          ))}
        </ul>
      </section>

      {/* Pasos de conexión */}
      <section>
        <h2 className="text-lg font-medium">
          {enDemo ? "Qué falta para conectar" : "Conexión"}
        </h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          {enDemo
            ? "Hoy la bandeja está en modo demostración: guarda todo pero no envía. Estos son los pasos, en orden."
            : "El número está conectado a la Cloud API de Meta."}
        </p>

        <ol className="mt-4 space-y-3">
          {PASOS.map((paso, i) => {
            const listo = paso.variable
              ? Boolean(process.env[paso.variable])
              : !enDemo;

            return (
              <li
                key={paso.titulo}
                className={listo ? "tarjeta p-5" : "tarjeta-hundida p-5"}
              >
                <div className="flex gap-3.5">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                      listo
                        ? "estado-ok bg-[var(--estado-fondo)] text-[var(--estado-tinta)]"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {listo ? <Check className="h-4 w-4" /> : i + 1}
                  </span>

                  <div>
                    <h3 className="text-base font-medium">{paso.titulo}</h3>
                    <p className="mt-0.5 text-base text-muted-foreground">
                      {paso.detalle}
                    </p>
                    <p className="mt-1.5 text-sm text-muted-foreground">
                      {paso.quien === "negocio"
                        ? "Lo hace el titular del negocio."
                        : "Lo hace quien mantiene el sistema."}
                    </p>
                    {paso.variable && (
                      <p className="tabular mt-1 text-sm text-muted-foreground">
                        <span className="font-medium">Dato técnico:</span>{" "}
                        {paso.variable}
                        {listo ? " — cargada" : " — falta"}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <a
          href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 inline-flex items-center gap-2 text-base font-medium text-brand-orange hover:underline"
        >
          Guía oficial de Meta
          <ExternalLink className="h-4 w-4" />
        </a>
      </section>

      {/* Plantillas a registrar */}
      <section>
        <h2 className="text-lg font-medium">Mensajes a aprobar en Meta</h2>
        <p className="mt-1 max-w-2xl text-base text-muted-foreground">
          Estos son los textos que usa el sistema. Hay que cargarlos en Meta con
          el mismo nombre y esperar la aprobación; si se registran tal cual,
          después no hay que tocar nada acá.
        </p>

        <ul className="mt-4 space-y-2.5">
          {plantillas.map((plantilla) => (
            <li
              key={`${plantilla.nombre}-${plantilla.idioma}`}
              className="tarjeta p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="tabular text-base font-medium">
                  {plantilla.nombre}
                </span>
                <span className="text-sm text-muted-foreground">
                  {plantilla.idioma}
                  {plantilla.categoria ? ` · ${plantilla.categoria}` : ""}
                </span>
                {plantilla.variables > 0 && (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <CircleDot className="h-3 w-3" />
                    {plantilla.variables} datos
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-base">{plantilla.cuerpo}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
