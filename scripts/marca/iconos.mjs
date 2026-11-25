#!/usr/bin/env node
/**
 * Los íconos del sitio, desde el isotipo en vectores (lib/marca/logotipo.ts).
 *
 *   node scripts/marca/iconos.mjs
 *
 * - `public/icono.svg` y `app/favicon.ico` (16, 32 y 48): la variante circular
 *   de la guía, círculo naranja con la «m» blanca. Es la que se lee a 16 px.
 * - `public/apple-icon.png` (180): cuadrado lleno naranja con la «m» blanca al
 *   60 %, sin círculo: iOS ya redondea las esquinas, y un círculo adentro deja
 *   esquinas que no son de la marca.
 * - `public/cropped-icon-180x180.png`: el mismo círculo, para quien lo pide por
 *   ese nombre (el sitio viejo, los datos estructurados, el ingreso).
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";
import { NARANJA_MARCA, TRAZO_ISOTIPO } from "../../lib/marca/logotipo.ts";

const ISO_W = 74.5;
const ISO_H = 67.5;

/** La «m» blanca centrada en un lado de `lado`, ocupando `fraccion` del ancho. */
function m(lado, fraccion) {
  const escala = (lado * fraccion) / ISO_W;
  const x = (lado - ISO_W * escala) / 2;
  const y = (lado - ISO_H * escala) / 2;
  return `<path fill="#fff" fill-rule="evenodd" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${escala.toFixed(4)})" d="${TRAZO_ISOTIPO}"/>`;
}

const circulo = (lado) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}"><circle cx="${lado / 2}" cy="${lado / 2}" r="${lado / 2}" fill="${NARANJA_MARCA}"/>${m(lado, 0.56)}</svg>`;
const cuadrado = (lado) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado}"><rect width="${lado}" height="${lado}" fill="${NARANJA_MARCA}"/>${m(lado, 0.6)}</svg>`;

const png = (svg, lado) => sharp(Buffer.from(svg), { density: 600 }).resize(lado, lado).png({ compressionLevel: 9 }).toBuffer();

writeFileSync("public/icono.svg", circulo(100));
writeFileSync("public/apple-icon.png", await png(cuadrado(180), 180));
writeFileSync("public/cropped-icon-180x180.png", await png(circulo(180), 180));

// El .ico con PNG adentro (válido desde Windows Vista y en todos los navegadores).
const lados = [16, 32, 48];
const imagenes = await Promise.all(lados.map((l) => png(circulo(l), l)));
const cabecera = Buffer.alloc(6 + 16 * lados.length);
cabecera.writeUInt16LE(0, 0);
cabecera.writeUInt16LE(1, 2);
cabecera.writeUInt16LE(lados.length, 4);
let desplazamiento = cabecera.length;
lados.forEach((l, i) => {
  const o = 6 + 16 * i;
  cabecera.writeUInt8(l, o);
  cabecera.writeUInt8(l, o + 1);
  cabecera.writeUInt16LE(1, o + 4);
  cabecera.writeUInt16LE(32, o + 6);
  cabecera.writeUInt32LE(imagenes[i].length, o + 8);
  cabecera.writeUInt32LE(desplazamiento, o + 12);
  desplazamiento += imagenes[i].length;
});
writeFileSync("app/favicon.ico", Buffer.concat([cabecera, ...imagenes]));
console.log("Listo: icono.svg, apple-icon.png, cropped-icon-180x180.png y favicon.ico.");
