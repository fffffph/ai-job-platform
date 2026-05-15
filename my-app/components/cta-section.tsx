"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export function CTASection() {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/20 blur-[150px] pointer-events-none" />
      
      <div className="container mx-auto px-4 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="max-w-3xl mx-auto text-center"
        >
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-6 text-balance">
            准备好开启你的
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              职业新旅程
            </span>
            了吗？
          </h2>
          <p className="text-lg text-muted-foreground mb-10 text-pretty">
            加入 50,000+ 求职者的行列，让 AI 助你更快找到理想工作。
            <br />
            免费开始，无需绑定信用卡。
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" className="bg-foreground text-background hover:bg-foreground/90 px-8 h-12 text-base">
              立即开始免费试用
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            <Button size="lg" variant="outline" className="border-border hover:bg-secondary px-8 h-12 text-base">
              预约产品演示
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
