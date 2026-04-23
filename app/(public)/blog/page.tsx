"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { Search, BookOpen, Clock, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { blogPosts } from "@/lib/products";

const allCategories = ["Todos", ...Array.from(new Set(blogPosts.map((p) => p.category)))];

export default function BlogPage() {
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("Todos");

  const filtered = blogPosts.filter((post) => {
    if (selectedCat !== "Todos" && post.category !== selectedCat) return false;
    if (search && !post.title.toLowerCase().includes(search.toLowerCase()) && !post.excerpt.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="min-h-screen">
      <div className="bg-brand-gray text-white py-12">
        <div className="container mx-auto px-4">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="h-8 w-8 text-brand-orange" />
            <h1 className="text-3xl font-bold">Blog & Novedades</h1>
          </div>
          <p className="text-white/70">
            Tips, guías y novedades del mundo de la madera y la construcción.
          </p>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Search & filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar artículos..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {allCategories.map((cat) => (
              <Button
                key={cat}
                variant={selectedCat === cat ? "default" : "outline"}
                size="sm"
                className={selectedCat === cat ? "bg-brand-orange hover:bg-brand-orange-dark text-white" : ""}
                onClick={() => setSelectedCat(cat)}
              >
                {cat}
              </Button>
            ))}
          </div>
        </div>

        {/* Featured post */}
        {filtered.length > 0 && (
          <motion.div
            className="mb-10"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Link href={`/blog/${filtered[0].slug}`}>
              <Card className="overflow-hidden group hover:shadow-lg transition-shadow">
                <div className="grid md:grid-cols-2">
                  <div className="relative h-64 md:h-auto overflow-hidden">
                    <Image
                      src={filtered[0].image}
                      alt={filtered[0].title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </div>
                  <CardContent className="p-8 flex flex-col justify-center">
                    <Badge className="w-fit bg-brand-orange border-0 text-white mb-3">
                      {filtered[0].category}
                    </Badge>
                    <h2 className="text-2xl font-bold mb-3 group-hover:text-brand-orange transition-colors">
                      {filtered[0].title}
                    </h2>
                    <p className="text-muted-foreground mb-4">{filtered[0].excerpt}</p>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground mb-6">
                      <span>{filtered[0].date}</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {filtered[0].readTime} lectura
                      </span>
                    </div>
                    <Button variant="outline" className="w-fit">
                      Leer artículo <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </CardContent>
                </div>
              </Card>
            </Link>
          </motion.div>
        )}

        {/* Grid */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.slice(1).map((post, i) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
            >
              <Link href={`/blog/${post.slug}`}>
                <Card className="group overflow-hidden hover:shadow-lg transition-all h-full">
                  <div className="relative h-48 overflow-hidden">
                    <Image
                      src={post.image}
                      alt={post.title}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <Badge className="absolute top-3 left-3 bg-brand-orange border-0 text-white text-xs">
                      {post.category}
                    </Badge>
                  </div>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                      <span>{post.date}</span>
                      <span>·</span>
                      <span>{post.readTime} lectura</span>
                    </div>
                    <h3 className="font-semibold mb-2 group-hover:text-brand-orange transition-colors line-clamp-2">
                      {post.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {post.excerpt}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <Card>
            <CardContent className="p-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
              <p className="text-muted-foreground">No se encontraron artículos.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
