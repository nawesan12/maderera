/**
 * La clave de un cobro (T3, hallazgo 14): nace cada vez que el diálogo pasa
 * de cerrado a abierto, venga de su botón o de afuera.
 *
 * «Cobrar y entregar» abre el diálogo desde afuera (la prop `abierto`) y no
 * pasaba por el botón, que era el que renovaba la clave: el segundo cobro
 * salía con la clave del primero, y Go devolvía el recibo viejo («ya se
 * registró») en vez de cobrar (comité final, bajo).
 */
export function claveAlAbrir(antes: boolean, ahora: boolean, clave: string, nueva: () => string): string {
  return !antes && ahora ? nueva() : clave;
}
