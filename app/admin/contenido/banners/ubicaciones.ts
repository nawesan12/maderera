/**
 * Dónde puede ir un banner, en el idioma de quien lo carga.
 *
 * Módulo propio y no dentro de `actions.ts`: un archivo `"use server"` solo
 * puede exportar funciones asíncronas, y desde el cliente una constante
 * declarada ahí no llega como el arreglo que parece.
 */
export const UBICACIONES = [
  {
    valor: "franja",
    etiqueta: "Franja de arriba de todo",
    ayuda: "Una línea de texto sobre el encabezado, en todas las páginas. Para un aviso corto.",
  },
  {
    valor: "portada",
    etiqueta: "Portada, debajo del inicio",
    ayuda: "El lugar grande. Es donde va la promoción de la semana.",
  },
  {
    valor: "catalogo",
    etiqueta: "Arriba del catálogo",
    ayuda: "Lo ve quien ya está buscando productos.",
  },
] as const;
