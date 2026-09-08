-- El blog y los testimonios salen del sitio (pedido de la clienta, 7/9/2026).
--
-- Las seis notas las había escrito el prototipo y estaban publicadas con la
-- maderera como autora; los cuatro testimonios eran personas inventadas y ya
-- estaban ocultos. El contenido del blog se respaldó fuera del repo antes de
-- correr esto: es un DROP, no hay vuelta atrás desde acá.
--
-- Lo que la gente opina sobre los productos ahora sale de `product_reviews`,
-- que exige una compra entregada detrás de cada reseña.
DROP TABLE "blog_categories" CASCADE;--> statement-breakpoint
DROP TABLE "blog_posts" CASCADE;--> statement-breakpoint
DROP TABLE "testimonials" CASCADE;--> statement-breakpoint
DROP TYPE "public"."estado_publicacion";