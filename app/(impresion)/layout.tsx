/**
 * Documentos para imprimir.
 *
 * Grupo de rutas propio, sin el menú del panel ni el navbar del sitio: lo que
 * se ve en pantalla es la hoja, y es exactamente lo que sale de la impresora.
 * Estas páginas las abren tanto el personal como los clientes desde su portal,
 * así que cada una verifica por su cuenta quién puede verla.
 */
export default function ImpresionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
