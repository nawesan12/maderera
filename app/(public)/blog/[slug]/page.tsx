"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Clock, Calendar, Tag, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { blogPosts } from "@/lib/products";

export default function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const post = blogPosts.find((p) => p.slug === slug);

  if (!post) return notFound();

  const related = blogPosts
    .filter((p) => p.category === post.category && p.id !== post.id)
    .slice(0, 3);

  const contentParagraphs = post.content.split("\n\n");

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative h-[50vh] min-h-[400px] overflow-hidden">
        <Image
          src={post.image}
          alt={post.title}
          fill
          className="object-cover"
          priority
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/20" />
        <div className="absolute inset-0 flex items-end">
          <div className="container mx-auto px-4 pb-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <Badge className="bg-brand-orange border-0 text-white mb-4">
                {post.category}
              </Badge>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-4 max-w-3xl leading-tight">
                {post.title}
              </h1>
              <div className="flex items-center gap-5 text-white/70 text-sm">
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  {post.date}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="h-4 w-4" />
                  {post.readTime} lectura
                </span>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Breadcrumb */}
      <div className="bg-white border-b">
        <div className="container mx-auto px-4 py-3">
          <nav className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/" className="hover:text-brand-orange transition-colors">
              Inicio
            </Link>
            <ChevronRight className="h-3 w-3" />
            <Link href="/blog" className="hover:text-brand-orange transition-colors">
              Blog
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground font-medium truncate">
              {post.title}
            </span>
          </nav>
        </div>
      </div>

      <div className="container mx-auto px-4 py-10">
        <div className="max-w-3xl mx-auto">
          {/* Back */}
          <Link href="/blog">
            <Button variant="ghost" size="sm" className="mb-8 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver al blog
            </Button>
          </Link>

          {/* Content */}
          <motion.article
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-5"
          >
            {contentParagraphs.map((paragraph, i) => {
              const trimmed = paragraph.trim();

              if (trimmed.startsWith("## ")) {
                return (
                  <h2
                    key={i}
                    className="text-2xl font-bold mt-10 mb-4 text-brand-gray"
                  >
                    {trimmed.replace("## ", "")}
                  </h2>
                );
              }

              if (trimmed.startsWith("- ") || trimmed.startsWith("1. ")) {
                const items = trimmed.split("\n");
                const isOrdered = trimmed.startsWith("1.");
                const ListTag = isOrdered ? "ol" : "ul";
                return (
                  <ListTag
                    key={i}
                    className={`space-y-2 pl-5 ${isOrdered ? "list-decimal" : "list-disc"} text-muted-foreground leading-relaxed`}
                  >
                    {items.map((item, j) => (
                      <li
                        key={j}
                        className="text-base"
                        dangerouslySetInnerHTML={{
                          __html: item
                            .replace(/^[-\d.]+\s*/, "")
                            .replace(
                              /\*\*(.*?)\*\*/g,
                              '<strong class="text-foreground">$1</strong>'
                            ),
                        }}
                      />
                    ))}
                  </ListTag>
                );
              }

              return (
                <p
                  key={i}
                  className="text-base text-muted-foreground leading-relaxed"
                  dangerouslySetInnerHTML={{
                    __html: trimmed.replace(
                      /\*\*(.*?)\*\*/g,
                      '<strong class="text-foreground">$1</strong>'
                    ),
                  }}
                />
              );
            })}
          </motion.article>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mt-16"
          >
            <Card className="bg-brand-orange border-0 text-white overflow-hidden">
              <CardContent className="p-8 text-center">
                <h3 className="text-2xl font-bold mb-3">
                  ¿Necesitás asesoramiento?
                </h3>
                <p className="text-white/80 mb-6 max-w-md mx-auto">
                  Nuestro equipo te puede ayudar a elegir los materiales
                  correctos para tu proyecto.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link href="/contacto">
                    <Button className="bg-white text-brand-orange hover:bg-white/90 rounded-full px-8 h-12 font-semibold">
                      Contactanos
                    </Button>
                  </Link>
                  <Link href="/calculadora">
                    <Button
                      variant="outline"
                      className="border-white text-white hover:bg-white/10 rounded-full px-8 h-12 font-semibold"
                    >
                      Usar calculadora
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>

        {/* Related posts */}
        {related.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.7 }}
            className="mt-16 max-w-5xl mx-auto"
          >
            <h2 className="text-2xl font-bold mb-6">Artículos relacionados</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {related.map((relPost, i) => (
                <motion.div
                  key={relPost.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                >
                  <Link href={`/blog/${relPost.slug}`}>
                    <Card className="group overflow-hidden hover:shadow-lg transition-all h-full">
                      <div className="relative h-48 overflow-hidden">
                        <Image
                          src={relPost.image}
                          alt={relPost.title}
                          fill
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                        />
                        <Badge className="absolute top-3 left-3 bg-brand-orange border-0 text-white text-xs">
                          {relPost.category}
                        </Badge>
                      </div>
                      <CardContent className="p-5">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <span>{relPost.date}</span>
                          <span>·</span>
                          <span>{relPost.readTime} lectura</span>
                        </div>
                        <h3 className="font-semibold group-hover:text-brand-orange transition-colors line-clamp-2">
                          {relPost.title}
                        </h3>
                      </CardContent>
                    </Card>
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
}
