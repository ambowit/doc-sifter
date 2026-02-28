import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Search,
  BookOpen,
  FileQuestion,
  MessageCircle,
  Mail,
  ExternalLink,
  Upload,
  GitBranch,
  FileText,
  Shield,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Zap,
} from "lucide-react";

const faqs = [
  {
    category: "基础使用",
    questions: [
      {
        question: "如何创建新的尽调项目？",
        answer:
          "在项目列表页面点击右上角的「新建项目」按钮，填写项目名称、客户名称、标的公司等必要信息，选择项目类型和报告语言后点击创建即可。",
      },
      {
        question: "支持哪些文件格式上传？",
        answer:
          "系统支持 PDF、Word (.doc/.docx)、Excel (.xls/.xlsx)、图片 (JPG/PNG)、文本文件 (TXT) 以及 ZIP 压缩包格式。单个文件最大支持 500MB。",
      },
      {
        question: "什么是「严格证据模式」？",
        answer:
          "严格证据模式下，AI 仅基于已上传的文件内容生成报告，不会进行任何推测或补充。所有内容都可追溯到具体的源文件，确保报告的准确性和合规性。",
      },
    ],
  },
  {
    category: "文件处理",
    questions: [
      {
        question: "如何上传尽调报告模板？",
        answer:
          "在文件上传页面的左侧面板，您可以拖拽或点击上传您的尽调报告模板文件。系统也提供标准模板供您使用。AI 会自动解析模板结构，识别各个章节。",
      },
      {
        question: "文件解析失败怎么办？",
        answer:
          "请检查文件格式是否正确、文件是否损坏。如果问题持续，可以尝试将文件另存为 PDF 格式后重新上传。对于扫描件 PDF，建议先进行 OCR 处理。",
      },
      {
        question: "可以批量上传文件吗？",
        answer:
          "可以。您可以在数据室面板一次选择多个文件上传，也可以将多个文件打包成 ZIP 压缩包后上传。系统会自动解压并分类整理。",
      },
    ],
  },
  {
    category: "章节映射",
    questions: [
      {
        question: "什么是章节映射？",
        answer:
          "章节映射是将上传的尽调资料与报告模板章节进行关联的过程。AI 会分析文件内容，自动建议最相关的章节匹配，您也可以手动拖拽调整映射关系。",
      },
      {
        question: "如何调整 AI 的映射建议？",
        answer:
          "在章节映射页面，您可以通过拖拽的方式将文件移动到正确的章节，也可以移除不相关的映射。系统会记住您的调整，用于优化后续的映射建议。",
      },
      {
        question: "映射置信度代表什么？",
        answer:
          "置信度表示 AI 对该映射建议的确定程度。高置信度（>80%）通常表示文件内容与章节要求高度匹配，低置信度建议您仔细审核后决定是否采纳。",
      },
    ],
  },
  {
    category: "报告生成",
    questions: [
      {
        question: "报告生成需要多长时间？",
        answer:
          "报告生成时间取决于文件数量和内容复杂度，通常在几分钟内完成。系统会实时显示生成进度，完成后会通知您。",
      },
      {
        question: "生成的报告可以编辑吗？",
        answer:
          "可以。在报告预览页面，您可以对生成的内容进行编辑和修改。所有修改都会保存，且保留原始 AI 生成版本供对比。",
      },
      {
        question: "支持哪些导出格式？",
        answer:
          "目前支持导出为 Word (.docx) 和 PDF 格式。您可以选择是否包含引用附录、页眉页脚等选项。",
      },
    ],
  },
];

const guides = [
  {
    title: "快速入门指南",
    description: "5分钟了解 DD Organizer 的核心功能",
    icon: Zap,
    color: "text-amber-600 bg-amber-100",
  },
  {
    title: "文件上传最佳实践",
    description: "如何组织和上传尽调资料",
    icon: Upload,
    color: "text-blue-600 bg-blue-100",
  },
  {
    title: "章节映射指南",
    description: "掌握智能映射和手动调整技巧",
    icon: GitBranch,
    color: "text-emerald-600 bg-emerald-100",
  },
  {
    title: "报告生成与导出",
    description: "生成专业尽调报告的完整流程",
    icon: FileText,
    color: "text-purple-600 bg-purple-100",
  },
];

export default function Help() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Filter FAQs based on search
  const filteredFaqs = faqs
    .map((category) => ({
      ...category,
      questions: category.questions.filter(
        (q) =>
          q.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          q.answer.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    }))
    .filter((category) => category.questions.length > 0);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground tracking-tight">帮助中心</h1>
        <p className="text-[13px] text-muted-foreground mt-1">
          查找常见问题解答和使用指南
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative mb-8">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
        <Input
          placeholder="搜索帮助文档..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-12 h-12 text-[14px]"
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        {guides.map((guide) => {
          const Icon = guide.icon;
          return (
            <Card
              key={guide.title}
              className="cursor-pointer hover:shadow-md transition-shadow"
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", guide.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium text-[14px]">{guide.title}</div>
                  <div className="text-[12px] text-muted-foreground">{guide.description}</div>
                </div>
                <ExternalLink className="w-4 h-4 text-muted-foreground ml-auto" />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Key Features */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[hsl(66,70%,45%)]" />
            <CardTitle className="text-lg">核心特性</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 bg-surface-subtle rounded-lg">
              <Shield className="w-6 h-6 text-primary mb-2" />
              <div className="font-medium text-[13px] mb-1">证据驱动</div>
              <div className="text-[11px] text-muted-foreground">
                所有内容基于已上传文件，不允许 AI 编造事实
              </div>
            </div>
            <div className="p-4 bg-surface-subtle rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-[hsl(var(--status-success))] mb-2" />
              <div className="font-medium text-[13px] mb-1">可追溯性</div>
              <div className="text-[11px] text-muted-foreground">
                每段内容都可点击查看源文件和原文
              </div>
            </div>
            <div className="p-4 bg-surface-subtle rounded-lg">
              <AlertTriangle className="w-6 h-6 text-amber-500 mb-2" />
              <div className="font-medium text-[13px] mb-1">缺失提示</div>
              <div className="text-[11px] text-muted-foreground">
                自动识别并标注资料不足的章节
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* FAQ Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileQuestion className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg">常见问题</CardTitle>
          </div>
          <CardDescription>
            {searchQuery
              ? `找到 ${filteredFaqs.reduce((acc, cat) => acc + cat.questions.length, 0)} 个相关问题`
              : "浏览常见问题和解答"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Category Tabs */}
          {!searchQuery && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <Button
                variant={selectedCategory === null ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(null)}
                className="text-[12px]"
              >
                全部
              </Button>
              {faqs.map((cat) => (
                <Button
                  key={cat.category}
                  variant={selectedCategory === cat.category ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat.category)}
                  className="text-[12px]"
                >
                  {cat.category}
                </Button>
              ))}
            </div>
          )}

          {/* FAQ Accordion */}
          {(searchQuery ? filteredFaqs : faqs)
            .filter((cat) => !selectedCategory || cat.category === selectedCategory)
            .map((category) => (
              <div key={category.category} className="mb-6 last:mb-0">
                {!searchQuery && (
                  <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {category.category}
                  </div>
                )}
                <Accordion type="single" collapsible className="space-y-2">
                  {category.questions.map((faq, index) => (
                    <AccordionItem
                      key={index}
                      value={`${category.category}-${index}`}
                      className="border rounded-lg px-4"
                    >
                      <AccordionTrigger className="text-[13px] font-medium hover:no-underline py-3">
                        {faq.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-[13px] text-muted-foreground pb-4">
                        {faq.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}

          {searchQuery && filteredFaqs.length === 0 && (
            <div className="text-center py-8">
              <FileQuestion className="w-10 h-10 text-muted-foreground mx-auto mb-2" />
              <p className="text-[13px] text-muted-foreground">未找到相关问题</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Support */}
      <Card className="mt-6">
        <CardContent className="flex items-center justify-between p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <MessageCircle className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="font-medium text-[14px]">还有其他问题？</div>
              <div className="text-[12px] text-muted-foreground">
                联系我们的技术支持团队获取帮助
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2">
              <Mail className="w-4 h-4" />
              发送邮件
            </Button>
            <Button className="gap-2">
              <BookOpen className="w-4 h-4" />
              查看文档
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
