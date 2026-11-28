/**
 * El formulario sin los campos que agrega Next (`$ACTION_REF_1`, `$ACTION_1:0`)
 * ni los que se nombran en `sin`: el validador de la API rechaza las partes que
 * el contrato no declara. El `id` de una edición, por ejemplo, va en la ruta:
 * mandado también como parte, Go contestaba «part id: undefined» y el banner
 * no se guardaba (mes simulado, M2S1-005).
 */
export function soloCampos(formData: FormData, ...sin: string[]): FormData {
  const limpio = new FormData();
  for (const [clave, valor] of formData) {
    if (!clave.startsWith("$") && !sin.includes(clave)) limpio.append(clave, valor);
  }
  return limpio;
}
