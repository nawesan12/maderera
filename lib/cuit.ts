/**
 * Validación de CUIT/CUIL.
 *
 * Un CUIT son once dígitos: dos de tipo, ocho del documento y uno verificador
 * calculado sobre los diez anteriores. Verificarlo acá evita dos problemas
 * concretos: una factura rechazada por ARCA con un CUIT inexistente, y un alta
 * de profesional con un número tipeado mal que después no se puede facturar.
 *
 * No dice si el CUIT existe ni de quién es —eso solo lo sabe ARCA—: dice si el
 * número está bien formado. Es el filtro barato que atrapa los errores de
 * tipeo, que son la enorme mayoría.
 */

/** Pesos del algoritmo del dígito verificador. El orden importa. */
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Prefijos válidos: persona física, jurídica y los de contingencia. */
const PREFIJOS = new Set([20, 23, 24, 25, 26, 27, 30, 33, 34]);

/** Deja solo los dígitos. Acepta lo que la gente escribe: 20-12345678-9. */
export function soloDigitos(cuit: string): string {
  return cuit.replace(/\D/g, "");
}

export function digitoVerificador(diezDigitos: string): number | null {
  if (diezDigitos.length !== 10) return null;

  let suma = 0;
  for (let i = 0; i < 10; i++) {
    suma += Number(diezDigitos[i]) * PESOS[i];
  }

  const resto = suma % 11;

  // Los dos casos especiales del algoritmo. Sin ellos, los CUIT terminados en
  // 0 y en 9 de ciertos prefijos se rechazan siendo válidos.
  if (resto === 0) return 0;
  if (resto === 1) return diezDigitos.startsWith("2") ? 9 : 4;

  return 11 - resto;
}

export function cuitValido(cuit: string | null | undefined): boolean {
  if (!cuit) return false;

  const digitos = soloDigitos(cuit);
  if (digitos.length !== 11) return false;

  // Todos los dígitos iguales pasan el cálculo en algunos casos y nunca son un
  // CUIT real: 00000000000 y 11111111111 son los rellenos habituales.
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  if (!PREFIJOS.has(Number(digitos.slice(0, 2)))) return false;

  const esperado = digitoVerificador(digitos.slice(0, 10));
  return esperado !== null && esperado === Number(digitos[10]);
}

/** Formatea para mostrar: 20-12345678-9. Devuelve el original si no es válido. */
export function formatearCuitLargo(cuit: string): string {
  const digitos = soloDigitos(cuit);
  if (digitos.length !== 11) return cuit;

  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

/**
 * Las formas en que un mismo CUIT puede estar guardado.
 *
 * En el mostrador se carga con guiones y desde el formulario web sin ellos, así
 * que buscar por igualdad exacta no encuentra la ficha que ya existe —y ahí se
 * duplica el cliente, partiendo su cuenta corriente en dos—.
 *
 * Se usa para armar un `IN (...)` sobre la columna, en vez de normalizar con
 * `regexp_replace` dentro de la consulta: la comparación contra la columna usa
 * el índice, y la función no.
 */
export function variantesDeCuit(cuit: string): string[] {
  const digitos = soloDigitos(cuit);
  if (digitos.length !== 11) return [cuit];

  return [digitos, formatearCuitLargo(digitos)];
}
