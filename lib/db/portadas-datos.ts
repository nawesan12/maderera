/**
 * La portada de cada rubro: una foto por categoría.
 *
 * **Vive en su propio archivo y no en `seed.ts` a propósito.** `seed.ts` corre
 * `main()` apenas se lo importa, así que cualquiera que quisiera leer este mapa
 * desde otro script sembraría la base entera sin querer. Pasó: el script de
 * portadas importó `seed.ts` para reusar la lista y resembró el catálogo.
 * Un módulo de datos no tiene que hacer nada al cargarse.
 *
 * **Verificadas de dos maneras, y las dos hacen falta.** Que la URL responda
 * —varias de Unsplash que parecían válidas devolvían 404, y una portada rota
 * deja la tarjeta en gris— y que la foto muestre el rubro. Lo segundo faltaba:
 * «Techos» era una pala con tierra, «Construcción en seco» alguien dibujando un
 * plano y «Pisos» un living donde el piso casi no se ve. Daba igual mientras
 * nadie las miraba; desde que el menú las muestra en tarjetas grandes, es lo
 * primero que ve quien entra.
 *
 * Si se cambia alguna, **mirarla** después de comprobar que carga.
 *
 * Las de banco que quedan son provisorias: una foto del depósito le dice más a
 * un cliente de Mar del Plata que cualquier banco de imágenes. La misma tabla
 * vive en Go (backend/internal/catalogo/portadas.go) para los rubros que crea
 * el importador; tests/portadas-migracion.test.ts vigila que digan lo mismo.
 */
export const PORTADA: Record<string, string> = {
  // Machimbre y tirantes a la vista, que es lo que se vende para un techo.
  techos: "/fotos/photo-1776624383828-e1bf5d141aa7.jpg",
  // Fotos propias (Drive de la clienta, 19/11/2026; docs/fotos.md y la
  // migración 00185). Llevan versión en el nombre: la caché de imágenes de
  // Next dura 30 días, así que un recorte nuevo va con otro nombre.
  // Tablero de pino en dos espesores, con los cantos a la vista.
  placas: "/sitio/placas-v1.webp",
  // Los accesorios de cortinería que la clienta marcó con 👆.
  ferreteria: "/sitio/ferreteria-v1.webp",
  // OSB con el canto.
  "construccion-en-seco": "/sitio/seco-v1.webp",
  // Un zócalo Moldava de punta, sobre blanco: no la estantería, que ya está
  // en la tarjeta grande de Moldava, al lado.
  molduras: "/sitio/molduras-v1.webp",
  pisos: "/fotos/photo-1573869908170-64b53a60d8da.jpg",
  // Gris y de intemperie, para no confundirse con el piso interior de arriba.
  "decks-y-escaleras": "/fotos/photo-1585597985125-9ad0229ae71d.jpg",
};

/**
 * Las portadas de banco que tuvo cada rubro (las que la 00150 borra de los
 * productos). Placas, construcción en seco y molduras pasaron a fotos propias
 * en la 00185.
 */
export const PORTADAS_DE_BANCO: Record<string, string> = {
  techos: "/fotos/photo-1776624383828-e1bf5d141aa7.jpg",
  placas: "/fotos/photo-1700973408133-b45276ec8feb.jpg",
  pisos: "/fotos/photo-1573869908170-64b53a60d8da.jpg",
  molduras: "/fotos/photo-1764283824453-02cd00e49143.jpg",
  "decks-y-escaleras": "/fotos/photo-1585597985125-9ad0229ae71d.jpg",
  "construccion-en-seco": "/fotos/photo-1768321903269-8a1f17a45c25.jpg",
};

/**
 * Las portadas de banco que salieron (comité final, M18): la de Ferretería era
 * un taller cualquiera y la de Cubiertas un techo de tejas, que no se vende.
 * Sin portada, la tarjeta del rubro va con la placa de su tono de madera
 * (components/catalogo/fondo-de-rubro.tsx), la misma regla que los productos
 * sin foto. Quedan anotadas porque la 00150 las borra de los productos y la
 * 00180 de las categorías: tests/portadas-migracion.test.ts lo vigila.
 * Ferretería volvió a tener portada en la 00185, esta vez propia.
 */
export const PORTADAS_RETIRADAS: Record<string, string> = {
  ferreteria: "/fotos/photo-1558618666-fcd25c85cd64.jpg",
  cubiertas: "/fotos/photo-1632759145351-1d592919f522.jpg",
};
