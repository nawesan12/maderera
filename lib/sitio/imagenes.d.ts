// Los tipos de las fotos importadas (`import galpon from "@/lib/sitio/galpon.webp"`).
// Los trae `next-env.d.ts`, pero ese archivo lo genera `next dev`/`next build`
// y no está en git: sin esto, `tsc --noEmit` de CI no sabría qué es un .webp.
/// <reference types="next/image-types/global" />
