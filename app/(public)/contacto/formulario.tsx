"use client";

import { useActionState } from "react";
import {
  AtSign,
  CheckCircle,
  Loader2,
  MessageCircle,
  Phone,
  Send,
  TriangleAlert,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { enviarConsulta, type EstadoConsulta } from "./actions";

/**
 * Formulario de contacto.
 *
 * Es la única parte de la página que necesita JavaScript, así que es lo único
 * que baja al navegador: el resto —los datos de cada sucursal, los accesos
 * directos, el texto— se arma en el servidor.
 */

const MOTIVOS = [
  { valor: "presupuesto", etiqueta: "Pedido de presupuesto" },
  { valor: "stock", etiqueta: "Consulta de stock" },
  { valor: "envio", etiqueta: "Envíos y entregas" },
  { valor: "corte", etiqueta: "Servicio de corte" },
  { valor: "profesional", etiqueta: "Cuenta de profesional" },
  { valor: "otro", etiqueta: "Otra consulta" },
];

export function FormularioContacto({ whatsapp }: { whatsapp: string }) {
  const [estado, accion, enviando] = useActionState<EstadoConsulta, FormData>(
    enviarConsulta,
    {},
  );

  if (estado.ok) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-green">
          <CheckCircle className="h-8 w-8 text-white" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">Consulta enviada</h2>
        <p className="text-muted-foreground">{estado.ok}</p>
      </div>
    );
  }

  return (
    <form action={accion} className="space-y-5 rounded-2xl border bg-card p-6 sm:p-8">
      <div>
        <h2 className="text-2xl font-bold">Escribinos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contestamos en el día durante el horario de atención.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="motivo">¿Sobre qué nos consultás?</Label>
        {/* Un <select> nativo: es un campo de seis opciones en un formulario
            público, y el nativo anda en cualquier teléfono sin JavaScript. */}
        <select
          id="motivo"
          name="motivo"
          required
          defaultValue="presupuesto"
          className="h-12 w-full rounded-xl border border-border/60 bg-background px-3 text-base focus:border-brand-orange focus:outline-none"
        >
          {MOTIVOS.map((motivo) => (
            <option key={motivo.valor} value={motivo.valor}>
              {motivo.etiqueta}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="nombre">Nombre completo</Label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              id="nombre"
              name="nombre"
              required
              autoComplete="name"
              placeholder="Tu nombre"
              className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Correo</Label>
          <div className="relative">
            <AtSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="tu@correo.com"
              className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
            />
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="telefono">
          Teléfono o WhatsApp{" "}
          <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <div className="relative">
          <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/50" />
          <Input
            id="telefono"
            name="telefono"
            type="tel"
            autoComplete="tel"
            placeholder="223 ..."
            className="h-12 rounded-xl border-border/60 pl-10 focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="mensaje">Mensaje</Label>
        <Textarea
          id="mensaje"
          name="mensaje"
          required
          rows={5}
          placeholder="Contanos en qué podemos ayudarte. Si ya sabés medidas, cantidades o el tipo de proyecto, mejor."
          className="resize-none rounded-xl border-border/60 focus:border-brand-orange"
        />
      </div>

      {estado.error && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-brand-orange/10 p-3 text-sm text-brand-orange-dark"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {estado.error}
        </p>
      )}

      {/* `sm:flex-1` y no `flex-1`: en fila reparte el ancho entre los dos
          botones, pero apilados en teléfono el eje principal es el vertical y
          `flex: 1 1 0%` les pone la altura de base en cero. Así el `h-12` se
          perdía y el botón de enviar quedaba en 22px de alto en el celular. En
          columna el ancho ya lo da el estirado del eje cruzado. */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row">
        <Button
          type="submit"
          disabled={enviando}
          className="h-12 rounded-full bg-brand-orange font-semibold text-white shadow-lg shadow-brand-orange/20 hover:bg-brand-orange-dark sm:flex-1"
        >
          {enviando ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Send className="mr-2 h-4 w-4" />
          )}
          {enviando ? "Enviando…" : "Enviar consulta"}
        </Button>

        <a
          href={`https://wa.me/${whatsapp}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex h-12 items-center justify-center rounded-full border font-medium transition-colors hover:bg-muted sm:flex-1 ${
            estado.usarWhatsapp ? "border-brand-green text-brand-green" : ""
          }`}
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          Prefiero WhatsApp
        </a>
      </div>
    </form>
  );
}
