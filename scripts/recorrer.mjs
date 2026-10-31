/**
 * Recorre el panel con cada rol, y el sitio como anónimo y como cliente, en un
 * navegador de verdad: abre cada pantalla (y la primera ficha de cada lista) y
 * anota la pantalla de error, los errores de la página y de la consola, y las
 * respuestas >= 400 de la API. Un 200 de curl no alcanza: la pantalla de error
 * también responde 200, y algunos errores saltan recién en el navegador.
 *
 *   BASE=https://179-197-224-61.sslip.io IP=179.197.224.61 CLAVE=... node scripts/recorrer.mjs
 *   ANCHO=390 ... (como un teléfono, con control de desborde horizontal)
 *   BASE=http://localhost:3100 CLAVE=Prueba1234 TALLER=aserradero node scripts/recorrer.mjs
 *
 * Los usuarios son <rol>@mjbj.com.ar (TALLER cambia el del aserradero) y, si
 * CLIENTE está, ese correo con la misma clave. Sale con 1 si encontró algo.
 */
import { chromium } from "playwright";
const H = process.env.BASE ?? "http://localhost:3100";
const CLAVE = process.env.CLAVE ?? "Prueba1234";
const IP = process.env.IP;
// ANCHO=390 recorre como un teléfono y además avisa si la página se desborda
// a lo ancho (scroll horizontal).
const ANCHO = Number(process.env.ANCHO ?? 1280);
const SOLO_ESCRITORIO = new Set(["/mostrador"]);
const PANEL = {
  admin: ["/admin","/admin/pedidos","/admin/whatsapp","/admin/whatsapp/configuracion","/admin/presupuestos","/admin/presupuestos/nuevo","/admin/cortes","/admin/cortes/nuevo","/mostrador","/atencion","/taller","/admin/productos","/admin/stock","/admin/precios","/admin/calculadoras","/admin/clientes","/admin/profesionales","/admin/documentacion","/admin/contenido","/admin/eventos","/admin/pagos","/admin/facturacion","/admin/arca","/admin/avisos","/admin/campanas","/admin/caja","/admin/proveedores","/admin/recepciones","/admin/compras","/admin/compras/ordenes","/admin/compras/facturas","/admin/compras/pagos","/admin/compras/gastos","/admin/cheques","/admin/cierre","/admin/reportes","/admin/sucursales","/admin/envios","/admin/cortes/tarifas","/admin/precios/formas-de-pago","/admin/migracion","/admin/bitacora","/admin/ayuda"],
  vendedor: ["/admin","/admin/pedidos","/admin/whatsapp","/admin/presupuestos","/admin/cortes","/mostrador","/atencion","/taller","/admin/productos","/admin/stock","/admin/clientes","/admin/profesionales","/admin/documentacion","/admin/eventos","/admin/ayuda"],
  deposito: ["/admin","/admin/pedidos","/admin/cortes","/taller","/admin/stock","/admin/ayuda"],
  taller: ["/taller","/admin/cortes","/admin/cortes/nuevo","/admin/ayuda"],
};
const PUBLICO = ["/","/catalogo","/carrito","/corte","/calculadora","/profesionales","/eventos","/sucursales","/nosotros","/contacto","/stock","/documentacion","/cambios-y-devoluciones","/ingresar"];
const CLIENTE = ["/mi-cuenta","/mi-cuenta/pedidos","/mi-cuenta/presupuestos","/mi-cuenta/cuenta-corriente","/mi-cuenta/comprobantes","/mi-cuenta/movimientos","/mi-cuenta/datos","/mi-cuenta/direcciones","/mi-lista-de-precios","/catalogo","/carrito"];
const hallazgos = [];
const b = await chromium.launch({ args: IP ? [`--host-resolver-rules=MAP ${new URL(H).hostname} ${IP}`] : [] });
async function recorrer(quien, correo, rutas, detalles) {
  const c = await b.newContext({ viewport: { width: ANCHO, height: 900 }, isMobile: ANCHO < 600, hasTouch: ANCHO < 600 });
  const p = await c.newPage();
  if (correo) {
    await p.goto(H + "/ingresar");
    const st = await p.evaluate(async ([correo, clave]) => (await fetch("/api/v1/sesion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ correo, clave }) })).status, [correo, CLAVE]);
    if (st !== 200) { hallazgos.push({ quien, ruta: "login", que: "login " + st }); return; }
  }
  let ruta = "";
  p.on("pageerror", (e) => hallazgos.push({ quien, ruta, que: "pageerror: " + e.message.slice(0, 200) }));
  p.on("console", (m) => { if (m.type() === "error") hallazgos.push({ quien, ruta, que: "console: " + m.text().slice(0, 200) }); });
  p.on("response", (r) => { const u = r.url(); if (r.status() >= 500 || (r.status() >= 400 && u.includes("/api/") && r.status() !== 401)) hallazgos.push({ quien, ruta, que: r.status() + " " + r.request().method() + " " + u.replace(H, "") }); });
  const visitar = async (x) => {
    ruta = x;
    try {
      const resp = await p.goto(H + x, { waitUntil: "networkidle", timeout: 45000 });
      const texto = await p.locator("body").innerText();
      if (/Esta pantalla no cargó|Se nos rompió algo/.test(texto)) hallazgos.push({ quien, ruta: x, que: "PANTALLA DE ERROR" });
      if (resp && resp.status() >= 400) hallazgos.push({ quien, ruta: x, que: "HTTP " + resp.status() + " → " + p.url().replace(H, "") });
      // El mostrador es para la PC de la caja (panel lateral fijo de 420 px):
      // no se le pide que entre en un teléfono.
      if (ANCHO < 600 && !SOLO_ESCRITORIO.has(x)) {
        // El body tiene overflow-x: hidden, así que lo que se sale no da
        // scroll: queda recortado. Se busca lo que pasa el borde derecho sin
        // estar adentro de algo con su propio desplazamiento (una tabla ancha,
        // un carrusel), que está bien.
        const recortados = await p.evaluate(() => {
          const ancho = window.innerWidth;
          const enScroll = (el) => {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const o = getComputedStyle(a).overflowX;
              if (o === "auto" || o === "scroll") return true;
            }
            return false;
          };
          const fuera = [];
          for (const el of document.querySelectorAll("body *")) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || r.right <= ancho + 1) continue;
            const cs = getComputedStyle(el);
            if (cs.position === "fixed" || cs.visibility === "hidden" || enScroll(el)) continue;
            if ([...fuera].some((f) => f.el.contains(el))) continue;
            fuera.push({ el, d: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.split(" ").slice(0, 4).join(".") : "") + " (" + Math.round(r.right) + "px)" });
            if (fuera.length >= 3) break;
          }
          return fuera.map((f) => f.d);
        });
        if (recortados.length) hallazgos.push({ quien, ruta: x, que: "se sale a lo ancho: " + recortados.join(" | ") });
      }
      if (p.url().includes("/ingresar") && x !== "/ingresar") hallazgos.push({ quien, ruta: x, que: "mandó a ingresar" });
    } catch (e) { hallazgos.push({ quien, ruta: x, que: "timeout/err " + e.message.slice(0, 120) }); }
  };
  for (const x of rutas) {
    await visitar(x);
    if (detalles) {
      const re = new RegExp("^" + x.replace(/\//g, "\\/") + "\\/[0-9a-f-]{36}$");
      const hrefs = await p.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      const det = hrefs.find((h) => h && re.test(h));
      if (det) await visitar(det);
    }
  }
  await c.close();
}
await recorrer("anonimo", null, PUBLICO, false);
if (process.env.CLIENTE) await recorrer("cliente", process.env.CLIENTE, CLIENTE, false);
for (const [rol, rutas] of Object.entries(PANEL)) await recorrer(rol, (rol === "taller" ? (process.env.TALLER ?? "taller") : rol) + "@mjbj.com.ar", rutas, rol === "admin" || rol === "vendedor");
await b.close();
const reales = hallazgos.filter((x) => !/Download is starting|uncached data/.test(x.que));
for (const x of reales) console.log(`${x.quien.padEnd(9)} ${x.ruta}  ${x.que}`);
console.log(reales.length ? `${reales.length} hallazgos` : "Sin hallazgos.");
process.exitCode = reales.length ? 1 : 0;
