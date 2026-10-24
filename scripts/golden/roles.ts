/**
 * Golden de los permisos del panel (lib/roles.ts): el mapa ACCESO y lo que
 * contesta puedeEntrar para cada ruta y cada rol. El Go (internal/roles)
 * tiene que dar lo mismo; si alguien cambia uno sin el otro, el test falla.
 *
 *   npx tsx scripts/golden/roles.ts
 */
import { writeFileSync } from "node:fs";
import { ACCESO, inicioDelRol, puedeEntrar, quienEntra, type RolStaff } from "../../lib/roles";

const roles: (RolStaff | null)[] = ["admin", "vendedor", "deposito", "aserradero", null];
const rutas = new Set<string>(Object.keys(ACCESO));
for (const r of Object.keys(ACCESO)) {
  rutas.add(r + "/algo");
  rutas.add(r + "/nuevo/123");
}
for (const extra of ["/", "/admin/nada", "/adminx", "/mostradorx", "/admin/cortes/tarifas/x", "/admin/whatsapp/configuracion/plantillas", "/mi-cuenta", "/admin/compras/pagos/certificado/12"]) rutas.add(extra);

const matriz = [...rutas].sort().flatMap((ruta) => roles.map((rol) => ({ ruta, rol, puede: puedeEntrar(ruta, rol) })));
const salida = {
  acceso: ACCESO,
  quienEntra: Object.fromEntries([...rutas].sort().map((r) => [r, quienEntra(r)])),
  inicio: Object.fromEntries(roles.map((r) => [String(r), inicioDelRol(r)])),
  matriz,
};
const destino = new URL("../../backend/testdata/golden/roles/acceso.json", import.meta.url);
writeFileSync(destino, JSON.stringify(salida, null, 1) + "\n");
console.log(`${matriz.length} casos en ${destino.pathname}`);
