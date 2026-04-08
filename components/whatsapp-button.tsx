"use client";

import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";

export function WhatsAppButton() {
  return (
    <motion.a
      href="https://wa.me/5492235903118?text=Hola!%20Quisiera%20consultar%20sobre..."
      target="_blank"
      rel="noopener noreferrer"
      className="fixed bottom-6 right-6 z-50 bg-[#25D366] text-white rounded-full w-14 h-14 flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-110 transition-all"
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      transition={{ delay: 1, type: "spring", stiffness: 200 }}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      <MessageCircle className="h-7 w-7" />
    </motion.a>
  );
}
