/**
 * Las plantillas de los avisos de profesionales y de eventos, copiadas tal
 * cual de lib/notificaciones/profesionales.ts y lib/notificaciones/eventos.ts
 * (go-cuentas 56ef2a1), que no las exportaban. Ahora las arma Go
 * (internal/profesionales/avisos.go).
 *
 * `cuandoSeLee` usaba los formateadores de lib/formato sin zona: con la del
 * servidor. El golden se corre en la de Argentina, que es lo que hace Go.
 */
import { envolver, type CorreoArmado } from "@/lib/email/plantillas";
import { fechaLarga, formatearMonto, hora } from "@/lib/formato";
import { urlBase } from "@/lib/pagos/config";

export function acuseDeRecibo(nombre: string): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Recibimos tu solicitud",
    adelanto: "Estamos revisando tu acceso al portal de profesionales.",
    saludo: nombre,
    parrafos: [
      "Un asesor la va a revisar y te contestamos dentro de las próximas 24 horas hábiles.",
      "Si necesitás algo antes, escribinos por WhatsApp y lo vemos.",
    ],
  });

  return { asunto: "Recibimos tu solicitud de acceso profesional", ...cuerpo };
}

export function bienvenida(datos: { nombre: string; lista: string | null; limiteCredito: number }): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Tu acceso profesional está activo",
    adelanto: "Ya tenés precios diferenciados en el catálogo.",
    saludo: datos.nombre,
    parrafos: [
      "Los precios que ves en el catálogo ahora son los tuyos: entrás con tu cuenta y el sitio te muestra la lista profesional, con los descuentos por volumen ya aplicados.",
      datos.limiteCredito > 0 ? "También te habilitamos cuenta corriente, así podés comprar y abonar después." : "",
    ].filter(Boolean),
    datos: [
      ...(datos.lista ? [{ etiqueta: "Lista de precios", valor: datos.lista }] : []),
      ...(datos.limiteCredito > 0
        ? [{ etiqueta: "Límite de cuenta corriente", valor: `$ ${datos.limiteCredito.toLocaleString("es-AR")}` }]
        : []),
    ],
    cta: { texto: "Entrar al catálogo", url: `${urlBase()}/catalogo` },
    cierre:
      "Desde tu cuenta también podés pedir presupuestos express, con respuesta en 24 horas, y descargar la documentación técnica.",
  });

  return { asunto: "Tu acceso profesional está activo", ...cuerpo };
}

export function rechazo(nombre: string, motivo: string | null): CorreoArmado {
  const cuerpo = envolver({
    titulo: "Sobre tu solicitud de acceso profesional",
    adelanto: "Novedades de tu solicitud.",
    saludo: nombre,
    parrafos: [
      "Por ahora no pudimos habilitarte el acceso al portal de profesionales.",
      motivo ? `<strong>Motivo:</strong> ${motivo}` : "",
      "Si creés que hay un error o querés que lo revisemos, contestá este correo o escribinos por WhatsApp: la mayoría de los casos se resuelven hablando.",
    ].filter(Boolean),
  });

  return { asunto: "Sobre tu solicitud de acceso profesional", ...cuerpo };
}

export function confirmacion(datos: {
  nombre: string;
  evento: string;
  cuando: string;
  lugar: string | null;
  precio: number;
  slug: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Te esperamos en ${datos.evento}`,
    adelanto: `Quedaste anotado para el ${datos.cuando}.`,
    saludo: datos.nombre,
    parrafos: ["Quedaste anotado. Guardate la fecha."],
    datos: [
      { etiqueta: "Cuándo", valor: datos.cuando },
      ...(datos.lugar ? [{ etiqueta: "Dónde", valor: datos.lugar }] : []),
      { etiqueta: "Costo", valor: datos.precio > 0 ? formatearMonto(datos.precio) : "Sin cargo" },
    ],
    cta: { texto: "Ver los detalles", url: `${urlBase()}/eventos/${datos.slug}` },
    cierre: "Si no vas a poder venir, avisanos así le damos el lugar a otra persona.",
  });

  return { asunto: `Anotado: ${datos.evento}`, ...cuerpo };
}

export function recordatorio(datos: {
  nombre: string;
  evento: string;
  cuando: string;
  lugar: string | null;
  slug: string;
}): CorreoArmado {
  const cuerpo = envolver({
    titulo: `Mañana: ${datos.evento}`,
    adelanto: `Te esperamos ${datos.cuando}.`,
    saludo: datos.nombre,
    parrafos: ["Es mañana. Te dejamos los datos para que no los busques."],
    datos: [
      { etiqueta: "Cuándo", valor: datos.cuando },
      ...(datos.lugar ? [{ etiqueta: "Dónde", valor: datos.lugar }] : []),
    ],
    cta: { texto: "Cómo llegar", url: `${urlBase()}/eventos/${datos.slug}` },
  });

  return { asunto: `Mañana te esperamos: ${datos.evento}`, ...cuerpo };
}

export function cuandoSeLee(inicia: Date): string {
  return `${fechaLarga.format(inicia)}, ${hora.format(inicia)}`;
}
