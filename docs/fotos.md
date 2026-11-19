# Las fotos del Drive de la clienta

El 19/11/2026 Lole compartió por Drive el material para la página: la guía de
marca del estudio Ranina, fotos de estudio de placas y ferretería, muestras de
Fibraplac y de la Enchapadora San Juan, y lo de Moldava. Esto es qué se usó,
dónde vive y cómo se sube a producción.

## Qué va a dónde

| Qué | Dónde vive | En git |
|---|---|---|
| Fotos del sitio (portada, encabezados, bloques) | `lib/sitio/*.webp`, importadas desde el código | sí |
| Portadas de rubro (las nombra la base) | `public/sitio/*-v1.webp` | sí |
| Biblioteca de fotos de producto por código | volumen privado, `CARPETA_BIBLIOTECA` (`/datos/privado/biblioteca`) | no |
| Fotos de estudio sin código (32) | se le pasan a la clienta para subir a mano, o a la biblioteca cuando diga el código | no |
| Logotipo e isotipo | `lib/marca/logotipo.ts` (trazos del PDF de la guía) | sí |
| Íconos | `public/icono.svg`, `app/favicon.ico`, `public/apple-icon.png`, `public/cropped-icon-180x180.png` (`scripts/marca/iconos.mjs`) | sí |
| Originales de 42 MP (unos 800 MB) | quedan en el Drive | no |

**Las del sitio van importadas** (`import galpon from "@/lib/sitio/galpon.webp"`):
Next les pone un nombre con hash y caché permanente, y el desenfoque mientras
cargan. **Las portadas de rubro van en `public/sitio/` con versión en el
nombre** porque las guarda la base (`categories.image`) y la caché de imágenes
de Next dura 30 días y sobrevive a los despliegues: un recorte nuevo va como
`placas-v2.webp`, nunca pisando el mismo nombre.

## Procesar

```sh
node scripts/fotos/procesar.mjs <carpeta del drive> <salida>
node scripts/fotos/procesar.mjs --solo ferreteria <carpeta del drive> <salida>  # solo esas
```

Correlo desde la raíz del repo, con la descarga en otra carpeta (es material
de afuera). La lista de qué foto va a dónde y con qué recorte está en
`scripts/fotos/seleccion.mjs`. Sale:

- `salida/estatico/` → copiar a `lib/sitio/`
- `salida/sitio/` → copiar a `public/sitio/`
- `salida/biblioteca/` → al servidor (abajo)
- `salida/sin-codigo/` → para la clienta
- `salida/hoja.jpg` y `salida/hoja-sin-codigo.jpg` → **mirarlas antes de copiar**:
  la foto de producto lleva dibujado el cuadrado que muestra el teléfono
  (la tarjeta es cuadrada en una columna), y cada banda de encabezado se ve
  como queda a 1440×300 y a 390×330.

Cada foto se gira según la cámara, se pasa a sRGB (las del celular vienen en
Display P3, los blancos de Fibraplac en CMYK), se recorta y se guarda en WebP
**sin metadatos**. La biblioteca rechaza fotos de menos de 1600 px por el lado
largo y los colores lisos. `tests/fotos.test.ts` vigila que lo que está en git
no tenga metadatos.

## La biblioteca de fotos por código

El código MJBJ de cada foto (el número entre paréntesis en el nombre del
archivo) es el `sku` de la medida. La lista vive en Go:
`backend/internal/fotos/biblioteca.go`. Hoy tiene 13 fotos y 14 códigos
(392, 391, 4145, 4159, 4147, 5743, 12724, 4696, 4172, 12848, 12850, 12851,
12801, 9035); los tres enchapados llevan además una foto de cerca de la veta.

Cuándo se engancha una foto:

- **Al crear una medida** con un código de la lista: en el importador de ISIS
  (`/admin/migracion`) y en la ficha del producto. Va después del commit y
  antes de contestar.
- **Nunca al guardar** una medida que ya existía: una foto que la clienta borró
  a propósito no vuelve.
- **En lote**, `mjbj fotos adjuntar`, para lo que ya estaba cargado: solo
  productos sin ninguna foto.

Cada producto recibe su copia del archivo (borrar la foto de uno no deja al
otro sin foto). `product_images.origen_biblioteca` (migración 00186) dice de
qué archivo salió cada foto: así la melamina en aglomerado (12724) y en MDF
(4696), si son medidas del mismo producto, suman cada una la suya.

### Subirla a producción

Después de desplegar (la 00185 y la 00186 las aplica `desplegar.sh`):

```sh
# 1. Desde la máquina donde se procesó
scp -r salida/biblioteca mjbj@179.197.224.61:<carpeta del despliegue>/entrada-fotos

# 2. En la VPS, en la carpeta del despliegue
chmod -R a+rX entrada-fotos   # la imagen corre como nonroot (65532)
docker compose --env-file .env.produccion -f docker-compose.prod.yml \
  run --rm --no-deps -v "$PWD/entrada-fotos:/entrada:ro" api fotos cargar /entrada
docker compose --env-file .env.produccion -f docker-compose.prod.yml \
  run --rm --no-deps api fotos adjuntar --probar
docker compose --env-file .env.produccion -f docker-compose.prod.yml \
  run --rm --no-deps api fotos adjuntar
rm -rf entrada-fotos
```

Sin `mjbj` delante de `fotos`: la imagen ya tiene `ENTRYPOINT ["/mjbj"]`.
`cargar` revisa cada archivo (que sea WebP, de 1600 px o más, de 8 MB o menos)
y si uno no pasa no copia ninguno; avisa cuáles de la lista faltan y cuáles
sobran. Hoy la base no tiene productos, así que `adjuntar` tiene que dar 0: el
enganche al importar ya lo cubre. Se puede volver a correr después de que la
maderera importe.

### Sumar una foto

1. Agregar la entrada a `scripts/fotos/seleccion.mjs` (`biblioteca/<código>.webp`).
2. Agregarla a `Lista` en `backend/internal/fotos/biblioteca.go`.
3. Procesar, mirar la hoja, desplegar y repetir `fotos cargar` + `fotos adjuntar`.

## Qué no se usó, y por qué

- **`PLACAS/mjbj enchapados` (7):** generadas con IA, con la marca C2PA de
  ChatGPT (`trainedAlgorithmicMedia`). Presentarlas como fotos sería mentir, y
  Google Merchant y Meta pueden leer la marca.
- **Los PNG de logos del Drive:** dicen «JUAN. B. JUSTO», con un punto de más.
  El PDF vectorial dice «JUAN B. JUSTO»; el logotipo del sitio sale de ahí.
- **`STOCK PLACAS` y `FENOLICOS TERCIPLAK`:** en grande, las marcas de los
  proveedores (Terciplak, Aguerco, LP, Placas Rivadavia). La primera foto del
  sitio no es una publicidad de nadie; la portada es el galpón propio.
- **`FENOLICOS PLACAS RIVADAVIA`:** la pintada de otro proveedor en el medio.
- **`SIDING` como portada:** blanco sobre blanco, se veía vacía. Va el OSB.
- **Las de 640 px:** las 14 de Moldava, los entramados 52010 y 52012, MADERAS
  VARIOS (además parecen de un proveedor) y las placas chicas.
- **Las 12 de WhatsApp de Moldava:** las mismas, peores.
- **Muestras de Fibraplac y San Juan:** esperan qué colores trabaja la maderera.
  Cuando lleguen: los colores lisos no van como foto (van como dato del color),
  los metalizados «Lunar» tampoco, y las de San Juan de 640 px con veta hay que
  pedirlas en alta. Los TIFF que sharp no abre los pasa `procesar.mjs` por sips.
- **Neo Sans:** licencia paga de Monotype. Sigue Geist; la fidelidad a la marca
  la trae el logotipo en vectores.
- **El catálogo de Moldava 2026 en PDF:** no se publicó todavía. Pesa 16,6 MiB
  (el tope es 16) y tiene defectos de imprenta (texto en una serif de reemplazo,
  el índice a medias). Espera que Lole confirme que es la versión final.
- **El PNG del logo de los PDF** (`public/marca/logo-maderera.png` y su copia en
  Go) no se cambió: es el del sitio viejo y dice bien el nombre; cambiarlo mueve
  los golden de los once documentos.

## Lo que hay que preguntarle a la clienta

1. Una planilla con archivo y código ISIS para las 20 fotos de ferretería y las
   12 de placas sin código.
2. Si los códigos de Moldava (9xxx y 19xxx) son los de ISIS, y los originales
   de esas 14 fotos.
3. Los originales de los entramados 52010 y 52012.
4. Qué colores Fibraplac y San Juan tiene en stock, con su código; cuál es cada
   uno de los tres blancos idénticos, y si cada melamina es aglomerado o MDF.
5. Fotos propias de machimbre, tirantes y deck (techos, pisos, decks), de la
   seccionadora, del local por fuera (para contacto) y del equipo.
6. Si el catálogo de Moldava 2026 es el final y puede ser público.
7. Que las fotos de estudio de 2021 son de la maderera y la cesión cubre la web
   y Google Merchant, no solo las redes.
8. Los PNG del logo dicen «JUAN. B.» y el PDF «JUAN B.»: ¿cuál es el final? Si
   es el PDF, pedirle a Ranina que corrija los PNG (y la foto de perfil).
9. Qué quiere decir el 👆 en cuatro archivos (¿son los que quiere destacar?).
10. El espesor de cada foto de estudio con código (en los enchapados se ven tres
    placas apiladas).
11. El vector de los íconos de rubro de las historias de Instagram, para usarlos
    como portada de los rubros sin foto propia.
