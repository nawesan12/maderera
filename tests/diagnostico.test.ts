import { describe, expect, it } from "vitest";
import { limitesRepetidos } from "@/lib/diagnostico/limites";
import {
  esErrorDeHidratacion,
  leerReporte,
  lineaDelNavegador,
  lineaDelServidor,
} from "@/lib/diagnostico/registro";
import { esUuid } from "@/lib/uuid";

/**
 * El diagnóstico del React #419.
 *
 * `limitesRepetidos` es lo que encontró la causa: dos `B:5` en el HTML del
 * stock. Se prueba con el recorte de ese HTML tal como salía, para que un
 * cambio en la expresión no lo deje ciego al caso que lo justificó.
 */
describe("los límites repetidos", () => {
  // El HTML de /stock del 14/10/2026, reducido a las marcas: el «Productos»
  // del menú se mandó aparte como B:5 en la parte armada en el build, y el
  // esqueleto del listado, armado en la visita, volvió a ser B:5.
  const roto = [
    '<div><!--$?--><template id="B:5"></template><a href="/catalogo">Productos</a><!--/$--></div>',
    '<!--$?--><template id="B:0"></template><a href="/ingresar">Ingresar</a><!--/$-->',
    '<div hidden id="S:5"><a href="/catalogo">Productos</a></div><script>$RC("B:5","S:5")</script>',
    '<div hidden id="S:3"><template id="P:4"></template></div>',
    '<div hidden id="S:4"><!--$?--><template id="B:5"></template><div class="h-96"></div><!--/$--></div>',
    '<script>$RS("S:4","P:4")</script>',
    '<div hidden id="S:0"><a href="/mi-cuenta">Hola</a></div>',
    '<div hidden id="S:5"><div data-slot="card"></div></div><script>$RC("B:5","S:5")</script>',
  ].join("");

  it("encuentra el número repetido del stock", () => {
    expect(limitesRepetidos(roto).sort()).toEqual(["B:5", "S:5"]);
  });

  it("no confunde el hueco P:4 con su contenido S:4", () => {
    // El hueco y lo que lo llena comparten número a propósito.
    expect(limitesRepetidos(roto)).not.toContain("P:4");
    expect(limitesRepetidos(roto)).not.toContain("S:4");
  });

  it("un HTML sano no tiene nada repetido", () => {
    const sano = roto.replace(/B:5"><\/template><div class="h-96"/, 'B:8"></template><div class="h-96"');
    const sinSegundoS5 = sano.replace('<div hidden id="S:5"><div data-slot', '<div hidden id="S:8"><div data-slot');
    expect(limitesRepetidos(sinSegundoS5)).toEqual([]);
  });
});

describe("el reporte del navegador", () => {
  it("reconoce los errores de hidratación, minificados o no", () => {
    expect(esErrorDeHidratacion("Minified React error #419; visit https://react.dev/errors/419")).toBe(true);
    expect(esErrorDeHidratacion("https://react.dev/errors/418?args[]=HTML")).toBe(true);
    expect(esErrorDeHidratacion("The server could not finish this Suspense boundary")).toBe(true);
    expect(esErrorDeHidratacion("Hydration failed because the server rendered HTML didn't match")).toBe(true);
    // El #4190 no es el #419.
    expect(esErrorDeHidratacion("https://react.dev/errors/4190")).toBe(false);
    expect(esErrorDeHidratacion("TypeError: x is undefined")).toBe(false);
  });

  it("solo acepta un error de hidratación con una ruta del sitio", () => {
    const mensaje = "Minified React error #419";
    expect(leerReporte({ ruta: "/stock", mensaje })).toEqual({
      ruta: "/stock",
      mensaje,
      pila: undefined,
      build: undefined,
    });
    expect(leerReporte({ ruta: "https://otro.com/", mensaje })).toBeNull();
    expect(leerReporte({ ruta: "/stock", mensaje: "hola" })).toBeNull();
    expect(leerReporte("texto")).toBeNull();
    expect(leerReporte(null)).toBeNull();
  });

  it("recorta lo largo y aplana los saltos de línea: un renglón por error", () => {
    const reporte = leerReporte({
      ruta: "/stock",
      mensaje: "Minified React error #419 " + "x".repeat(5000),
      pila: "a\nb\nc",
    })!;
    expect(reporte.mensaje.length).toBe(500);
    expect(reporte.pila).toBe("a b c");
    expect(lineaDelNavegador(reporte)).not.toContain("\n");
    expect(JSON.parse(lineaDelNavegador(reporte)).scope).toBe("diagnostico.navegador");
  });
});

describe("el renglón del servidor", () => {
  it("lleva la ruta, el archivo y el digest", () => {
    const error = Object.assign(new Error("Failed query"), { digest: "123" });
    const linea = JSON.parse(
      lineaDelServidor(
        error,
        { path: "/stock?q=pino", method: "GET" },
        { routerKind: "App Router", routePath: "/(public)/stock", routeType: "render", renderSource: "react-server-components" },
      ),
    );
    expect(linea).toMatchObject({
      scope: "diagnostico.servidor",
      ruta: "/stock?q=pino",
      archivo: "/(public)/stock",
      digest: "123",
      mensaje: "Failed query",
    });
  });
});

describe("la forma de un uuid", () => {
  it("separa un id de un enlace mal copiado", () => {
    expect(esUuid("bc2b8e15-fccb-4307-b010-bdbe4c0757c6")).toBe(true);
    expect(esUuid("BC2B8E15-FCCB-4307-B010-BDBE4C0757C6")).toBe(true);
    expect(esUuid("no-existe")).toBe(false);
    expect(esUuid("bc2b8e15-fccb-4307-b010-bdbe4c0757c")).toBe(false);
    expect(esUuid("")).toBe(false);
  });
});
