import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, TriangleAlert } from "lucide-react";
import { EncabezadoPanel } from "@/components/admin/encabezado";
import { fechaHora } from "@/lib/formato";
import {
  estadoCorreo,
  listarAvisosEmail,
  ultimosAvisosEnviados,
} from "@/lib/dal/admin/avisos";
import { sembrarAvisosEmail } from "@/lib/notificaciones/sembrar";
import { FilaAvisoEmail } from "./fila";

export const metadata: Metadata = { title: "Avisos automáticos" };

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  enviada: { texto: "Enviado", clase: "text-brand-green" },
  simulada: { texto: "Simulado", clase: "text-muted-foreground" },
  omitida: { texto: "Apagado", clase: "text-muted-foreground" },
  fallida: { texto: "Falló", clase: "text-destructive" },
};

/**
 * Los avisos automáticos al cliente, de los dos canales.
 *
 * El correo se configura entero acá. WhatsApp tiene su propia pantalla porque
 * necesita el nombre de una plantilla aprobada por Meta y la ventana de 24 h,
 * que no tienen equivalente en el correo; duplicar esa configuración en dos
 * lugares es la forma segura de que queden distintas.
 *
 * Lo que sí va junto es la bitácora: la pregunta que aparece cuando un cliente
 * dice que nunca le llegó nada no es "¿le mandamos el mail?", es "¿le
 * avisamos?".
 */
export default async function AvisosPage() {
  await sembrarAvisosEmail();

  const [avisos, correo, enviados] = await Promise.all([
    listarAvisosEmail(),
    estadoCorreo(),
    ultimosAvisosEnviados(30),
  ]);

  return (
    <div className="space-y-6">
      <EncabezadoPanel
        titulo="Avisos automáticos"
        detalle="Qué se le escribe al cliente solo, y por dónde."
      >
        <Link
          href="/admin/whatsapp/configuracion"
          className="inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-base font-medium transition-colors hover:bg-muted"
        >
          <MessageCircle className="h-5 w-5" />
          Avisos de WhatsApp
        </Link>
      </EncabezadoPanel>

      {!correo.enVivo && (
        <section className="tarjeta-atencion flex flex-wrap items-start gap-x-4 gap-y-2 p-5">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
          <div className="min-w-[18rem] flex-1">
            <h2 className="text-base font-medium">
              Los correos todavía no salen
            </h2>
            <p className="mt-1 text-base text-muted-foreground">
              {correo.detalle} Hasta entonces cada aviso se arma completo y
              queda en la bitácora de abajo marcado como{" "}
              <strong>simulado</strong>, para poder revisar los textos sin
              escribirle a nadie.
            </p>
          </div>
        </section>
      )}

      <section className="tarjeta">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-base font-medium">
            <Mail className="h-5 w-5 text-muted-foreground" />
            Avisos por correo
          </h2>
          <p className="text-base text-muted-foreground">
            Salen desde{" "}
            <span className="tabular">{correo.remitente}</span>
          </p>
        </div>

        <ul className="divide-y">
          {avisos.map((aviso) => (
            <FilaAvisoEmail key={aviso.id} aviso={aviso} />
          ))}
        </ul>
      </section>

      <section className="tarjeta">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-5 py-4">
          <h2 className="text-base font-medium">Últimos avisos</h2>
          <p className="text-base text-muted-foreground">
            Los dos canales, del más nuevo al más viejo
          </p>
        </div>

        {enviados.length === 0 ? (
          <p className="px-5 py-10 text-center text-base text-muted-foreground">
            Todavía no se mandó ningún aviso.
          </p>
        ) : (
          <ul className="divide-y">
            {enviados.map((aviso) => {
              const estado = ESTADOS[aviso.estado] ?? {
                texto: aviso.estado,
                clase: "text-muted-foreground",
              };

              return (
                <li
                  key={aviso.id}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3"
                >
                  <span className="tabular w-40 shrink-0 text-base text-muted-foreground">
                    {fechaHora.format(aviso.createdAt)}
                  </span>

                  <span className="inline-flex shrink-0 items-center gap-1.5 text-base text-muted-foreground">
                    {aviso.canal === "email" ? (
                      <Mail className="h-4 w-4" />
                    ) : (
                      <MessageCircle className="h-4 w-4" />
                    )}
                  </span>

                  <span className="min-w-[12rem] flex-1 text-base">
                    {aviso.asunto ?? aviso.evento}
                    <span className="block text-muted-foreground">
                      {aviso.destinatario}
                    </span>
                  </span>

                  <span className={`text-base ${estado.clase}`}>
                    {estado.texto}
                  </span>

                  {aviso.error && (
                    <span className="w-full text-base text-destructive">
                      {aviso.error}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
