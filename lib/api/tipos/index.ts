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
import type { paths as Cuentas, components as ComponentesCuentas } from "./cuentas";
import type { paths as Documentos, components as ComponentesDocumentos } from "./documentos";
import type { paths as Cortes, components as ComponentesCortes } from "./cortes";
import type { paths as Compras, components as ComponentesCompras } from "./compras";
import type { paths as Bitacora, components as ComponentesBitacora } from "./bitacora";
import type { paths as Portal, components as ComponentesPortal } from "./portal";
import type { paths as Existencia, components as ComponentesExistencia } from "./existencia";
import type { paths as Whatsapp, components as ComponentesWhatsapp } from "./whatsapp";
import type { paths as Campanas, components as ComponentesCampanas } from "./campanas";
import type { paths as Profesionales, components as ComponentesProfesionales } from "./profesionales";
import type { paths as Buscador, components as ComponentesBuscador } from "./buscador";
import type { paths as Facturacion, components as ComponentesFacturacion } from "./facturacion";
import type { paths as Mostrador, components as ComponentesMostrador } from "./mostrador";
import type { paths as Ventas, components as ComponentesVentas } from "./ventas";
import type { paths as Entregas, components as ComponentesEntregas } from "./entregas";
import type { paths as Caja, components as ComponentesCaja } from "./caja";
import type { paths as Reportes, components as ComponentesReportes } from "./reportes";
import type { paths as Migracion, components as ComponentesMigracion } from "./migracion";

export type paths = Sesion &
  Catalogo &
  Contenido &
  Productos &
  Precios &
  Stock &
  Cuentas &
  Documentos &
  Cortes &
  Compras &
  Bitacora &
  Portal &
  Existencia &
  Whatsapp &
  Campanas &
  Profesionales &
  Buscador &
  Facturacion &
  Mostrador &
  Ventas &
  Entregas &
  Caja &
  Reportes &
  Migracion;
export type Esquemas = ComponentesSesion["schemas"] &
  ComponentesCatalogo["schemas"] &
  ComponentesContenido["schemas"] &
  ComponentesProductos["schemas"] &
  ComponentesPrecios["schemas"] &
  ComponentesStock["schemas"] &
  ComponentesCuentas["schemas"] &
  ComponentesDocumentos["schemas"] &
  ComponentesCortes["schemas"] &
  ComponentesCompras["schemas"] &
  ComponentesBitacora["schemas"] &
  ComponentesPortal["schemas"] &
  ComponentesExistencia["schemas"] &
  ComponentesWhatsapp["schemas"] &
  ComponentesCampanas["schemas"] &
  ComponentesProfesionales["schemas"] &
  ComponentesBuscador["schemas"] &
  ComponentesFacturacion["schemas"] &
  ComponentesMostrador["schemas"] &
  ComponentesVentas["schemas"] &
  ComponentesEntregas["schemas"] &
  ComponentesCaja["schemas"] &
  ComponentesReportes["schemas"] &
  ComponentesMigracion["schemas"];
