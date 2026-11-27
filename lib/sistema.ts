/**
 * Los nombres de los trabajos de la cola y de las tareas del worker como los
 * lee la dueña en /admin/sistema: salían crudos («next.revalidar»,
 * «parte-y-limpieza») (mes 23). Uno que no esté acá sale con su nombre
 * interno.
 */
const TRABAJOS: Record<string, string> = {
  "next.revalidar": "Actualizar el sitio",
  "pago.aviso": "Aviso de Mercado Pago",
  "pago.resultado": "Resultado de un pago",
  "email.reintento": "Reenvío de un correo",
  "campana.tanda": "Envío de una campaña",
  "recibo.aviso": "Recibo al cliente",
  "cheque.rechazado": "Aviso de cheque rechazado",
  "pedido.recibido": "Aviso de pedido recibido",
  "pedido.estado": "Aviso de cambio de estado del pedido",
  "presupuesto.recibido": "Aviso de presupuesto recibido",
  "presupuesto.enviado": "Presupuesto por WhatsApp",
  "presupuesto.correo": "Presupuesto por correo",
  "remito.firmado": "Remito firmado al cliente",
  "remito.para-firmar": "Remito para firmar",
  "factura.aviso": "Factura al cliente",
  "factura.baja": "Aviso de factura anulada",
  "factura.renumerada": "Aviso de factura renumerada",
  "whatsapp.estado": "Estado de un mensaje de WhatsApp",
  "whatsapp.medio": "Archivo de WhatsApp",
  "whatsapp.audio": "Audio de WhatsApp",
  "whatsapp.payload": "Mensaje entrante de WhatsApp",
  "whatsapp.reenvio": "Reenvío por WhatsApp",
  "whatsapp.turno": "Respuesta del bot de WhatsApp",
};

const TAREAS: Record<string, string> = {
  "resenas-google": "Reseñas de Google",
  "candidatos-baja": "Productos para revisar",
  "vencer-portada": "Vencer avisos de la portada",
  "vencer-ofertas": "Vencer ofertas",
  "parte-y-limpieza": "Parte del día y limpieza",
  "plantillas-whatsapp": "Plantillas de WhatsApp",
  "correo-certificado": "Certificado del correo",
  "vencer-presupuestos": "Vencer presupuestos",
  "recordatorios-eventos": "Recordatorios de eventos",
};

export function nombreDelTrabajo(tipo: string): string {
  return TRABAJOS[tipo] ?? tipo;
}

export function nombreDeLaTarea(tarea: string): string {
  return TAREAS[tarea] ?? tarea;
}
