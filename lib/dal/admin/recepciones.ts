import "server-only";

import { api, datos } from "@/lib/api/servidor";

/**
 * Las recepciones de mercadería. Las sirve la API de Go
 * (backend/internal/compras), que también las confirma y las anula.
 */
export async function listarRecepciones(limite = 50) {
  const filas = datos(await (await api()).GET("/api/v1/admin/recepciones", { params: { query: { limite } } }));
  return filas.map((f) => ({ ...f, fecha: new Date(f.fecha) }));
}

/** Una recepción con sus líneas y la cuenta del costo, si ya se confirmó. */
export async function obtenerRecepcion(id: string) {
  const r = await (await api()).GET("/api/v1/admin/recepciones/{id}", { params: { path: { id } } });
  if (r.response.status === 404) return null;
  const x = datos(r);
  return { ...x, fecha: new Date(x.fecha), confirmadaAt: x.confirmadaAt ? new Date(x.confirmadaAt) : null };
}

/** Buscar mercadería para cargar una recepción, con lo que cuesta hoy. */
export async function buscarParaRecibir(texto: string) {
  const consulta = texto.trim();
  if (consulta.length < 2) return [];
  return datos(
    await (await api()).GET("/api/v1/admin/compras/mercaderia", { params: { query: { texto: consulta.slice(0, 200) } } }),
  );
}

/** Las mismas variantes, por id (hasta 40): la orden armada desde reposición. */
export async function variantesParaPedir(ids: string[]) {
  const acotados = ids.filter(Boolean).slice(0, 40);
  if (acotados.length === 0) return [];
  return datos(
    await (await api()).GET("/api/v1/admin/compras/mercaderia", { params: { query: { ids: acotados.join(",") } } }),
  );
}
