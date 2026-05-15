"use client";

import { motion } from "framer-motion";
import { 
  FileText, 
  MessageSquare, 
  Target, 
  Zap, 
  TrendingUp, 
  Shield 
} from "lucide-react";

const features = [
  {
    icon: Target,
    title: "智能职位匹配",
    description: "基于你的技能、经验和职业目标，AI 精准推荐最适合的职位，节省海量筛选时间。",
  },
  {
    icon: FileText,
    title: "一键简历优化",
    description: "AI 深度分析简历，针对目标岗位智能优化措辞和排版，大幅提升 HR 通过率。",
  },
  {
    icon: MessageSquare,
    title: "AI 模拟面试",
    description: "真实还原面试场景，AI 面试官针对性提问并给出专业反馈，让你面试不再紧张。",
  },
  {
    icon: Zap,
    title: "实时行业洞察",
    description: "掌握最新行业趋势、薪资水平和技能需求，让你的求职策略始终领先一步。",
  },
  {
    icon: TrendingUp,
    title: "职业路径规划",
    description: "AI 根据市场需求和你的发展潜力，为你量身定制短期和长期职业发展建议。",
  },
  {
    icon: Shield,
    title: "隐私安全保障",
    description: "企业级数据加密，你的简历和求职信息绝对保密，只有你授权才能被查看。",
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: { 
    opacity: 1, 
    y: 0,
    transition: { duration: 0.5 }
  },
};

export function FeatureSection() {
  return (
    <section className="py-24 relative">
      {/* Background accent */}
      <div className="absolute top-1/2 left-0 w-[300px] h-[300px] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />
      
      <div className="container mx-auto px-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold text-foreground mb-4 text-balance">
            为你的求职之路
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              全程护航
            </span>
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-pretty">
            从职位发现到面试准备，AI 助手覆盖求职全流程，让每一步都更高效
          </p>
        </motion.div>
        
        <motion.div 
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {features.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group relative p-6 rounded-xl bg-card border border-border hover:border-primary/50 transition-all duration-300"
            >
              {/* Hover gradient effect */}
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              
              <div className="relative z-10">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
