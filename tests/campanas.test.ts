import { describe, expect, it } from "vitest";
import { cuerpoComoParrafos, leerCuerpo } from "@/lib/campanas/cuerpo";
import { parametrosDeBaja, verificarBaja } from "@/lib/campanas/baja";
import { describirSegmento, duracionDelEnvio, leerSegmento } from "@/lib/campanas/segmento";
import { RUBROS_CLIENTE } from "@/lib/rubros-cliente";

/**
 * Las campañas de correo.
 *
 * Lo que se prueba es lo que, si falla, sale mal a cientos de casillas a la
 * vez: lo que escribe la clienta no puede volverse HTML, el enlace de baja no
 * se puede falsificar, y el segmento descarta lo que no entiende.
 */
describe("el cuerpo de una campaña", () => {
  it("párrafos, listas y negrita, sin dejar pasar HTML", () => {
    const bloques = leerCuerpo("Hola **gremio**.\n\n- Placas\n- Tirantes\n\n<script>alert(1)</script>");
    expect(bloques).toHaveLength(3);
    expect(bloques[0]).toMatchObject({ tipo: "parrafo", html: "Hola <strong>gremio</strong>." });
    expect(bloques[1]).toMatchObject({ tipo: "lista" });
    expect(cuerpoComoParrafos("<script>alert(1)</script>")[0]).not.toContain("<script>");
  });

  it("las direcciones se vuelven enlaces, sin comerse el punto final", () => {
    const [p] = cuerpoComoParrafos("Mirá https://mjbj.com.ar/catalogo.");
    expect(p).toContain('href="https://mjbj.com.ar/catalogo"');
    expect(p.endsWith(".")).toBe(true);
  });
});

describe("el enlace de baja", () => {
  const secreto = "secreto-de-prueba";

  it("verifica la dirección que firmó, sin importar mayúsculas", () => {
    const { e, t } = parametrosDeBaja("Ana@Ejemplo.com", secreto);
    expect(verificarBaja(e, t, secreto)).toBe("ana@ejemplo.com");
  });

  it("no se puede usar para dar de baja a otro", () => {
    const { t } = parametrosDeBaja("ana@ejemplo.com", secreto);
    const otro = parametrosDeBaja("beto@ejemplo.com", secreto).e;
    expect(verificarBaja(otro, t, secreto)).toBeNull();
    expect(verificarBaja(parametrosDeBaja("ana@ejemplo.com", secreto).e, t, "otro-secreto")).toBeNull();
    expect(verificarBaja("basura", "x", secreto)).toBeNull();
  });
});

describe("el segmento", () => {
  const rubros = RUBROS_CLIENTE.map((r) => r.valor);

  it("descarta lo que no entiende", () => {
    expect(leerSegmento({ tipo: "x", rubros: ["carpintero", "inventado"], actividad: "compraron", meses: 99 }, rubros))
      .toEqual({ tipo: "todos", rubros: ["carpintero"], actividad: null });
  });

  it("se describe en castellano", () => {
    expect(
      describirSegmento({ tipo: "profesional", rubros: ["carpintero"], actividad: { tipo: "sinComprar", meses: 6 } }),
    ).toBe("Profesionales de carpintería que no compran hace más de 6 meses con correo");
  });
});

describe("cuánto tarda en salir", () => {
  it("se dice como se dice", () => {
    expect(duracionDelEnvio(1, 3)).toBe("un minuto");
    expect(duracionDelEnvio(60, 3)).toBe("unos 20 minutos");
    expect(duracionDelEnvio(1000, 3)).toBe("unas 5,6 horas");
    expect(duracionDelEnvio(20000, 3)).toBe("unos 5 días");
  });
});
