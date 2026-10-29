/**
 * Los caminos de la API de Go, todos juntos: un archivo por dominio,
 * generados de backend/api/<dominio>.yaml con `npm run api:gen`. Cada tanda de
 * la mudanza suma el suyo acá.
 */
import type { paths as Sesion, components as ComponentesSesion } from "./sesion";
import type { paths as Catalogo, components as ComponentesCatalogo } from "./catalogo";
import type { paths as Contenido, components as ComponentesContenido } from "./contenido";
import type { paths as Productos, components as ComponentesProductos } from "./productos";
import type { paths as Precios, components as ComponentesPrecios } from "./precios";
import type { paths as Stock, components as ComponentesStock } from "./stock";
import type { paths as Compras, components as ComponentesCompras } from "./compras";

export type paths = Sesion & Catalogo & Contenido & Productos & Precios & Stock &
  Compras;
export type Esquemas = ComponentesSesion["schemas"] &
  ComponentesCatalogo["schemas"] &
  ComponentesContenido["schemas"] &
  ComponentesProductos["schemas"] &
  ComponentesPrecios["schemas"] &
  ComponentesStock["schemas"] &
  ComponentesCompras["schemas"];
