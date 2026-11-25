/**
 * El espejo drizzle de la base.
 *
 * Las migraciones son las de goose (`backend/db/migraciones`); esto queda
 * para las semillas y los scripts del frente, y no genera nada. Tiene todas
 * las columnas de cada tabla espejada; las tablas que solo usa Go están
 * listadas en `scripts/espejo-drizzle.ts`. Después de una migración nueva,
 * `npm run db:espejo` contra una base migrada dice qué falta.
 */
export * from "./auditoria";
export * from "./auth";
export * from "./cart";
export * from "./catalog";
export * from "./contenido";
export * from "./customers";
export * from "./entregas";
export * from "./facturacion";
export * from "./inventory";
export * from "./migracion";
export * from "./notificaciones";
export * from "./pagos";
export * from "./profesionales";
export * from "./pricing";
export * from "./profiles";
export * from "./sales";
export * from "./whatsapp";
export * from "./caja";
export * from "./compras";
export * from "./costos";
export * from "./retenciones";
export * from "./gastos";
export * from "./comercial";
export * from "./cheques";
export * from "./circuito";
export * from "./limites";
export * from "./recibos";
export * from "./tareas";
export * from "./campanas";
