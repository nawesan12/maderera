/**
 * Los caminos de la API de Go, todos juntos: un archivo por dominio,
 * generados de backend/api/<dominio>.yaml con `npm run api:gen`. Cada tanda de
 * la mudanza suma el suyo acá.
 */
import type { paths as Sesion, components as ComponentesSesion } from "./sesion";
import type { paths as Catalogo, components as ComponentesCatalogo } from "./catalogo";
import type { paths as Contenido, components as ComponentesContenido } from "./contenido";

export type paths = Sesion & Catalogo & Contenido;
export type Esquemas = ComponentesSesion["schemas"] & ComponentesCatalogo["schemas"] & ComponentesContenido["schemas"];
