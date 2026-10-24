/**
 * Los caminos de la API de Go, todos juntos: un archivo por dominio,
 * generados de backend/api/<dominio>.yaml con `npm run api:gen`. Cada tanda de
 * la mudanza suma el suyo acá.
 */
import type { paths as Sesion, components as ComponentesSesion } from "./sesion";

export type paths = Sesion;
export type Esquemas = ComponentesSesion["schemas"];
