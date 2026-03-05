import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Demo template content for quick testing
export const DEMO_TEMPLATE_CONTENT = `
# 法律尽职调查报告

## 第一章 公司基本情况
1.1 公司设立
1.2 公司存续
1.3 工商登记信息

## 第二章 股权结构
2.1 股东信息
2.2 股权变更历史
2.3 股权代持情况

## 第三章 公司治理
3.1 公司章程
3.2 股东会决议
3.3 董事会决议
3.4 高级管理人员

## 第四章 重大资产
4.1 房产及土地
4.2 知识产权
4.3 其他重大资产

## 第五章 重大合同
5.1 业务合同
5.2 借款合同
5.3 担保合同

## 第六章 劳动人事
6.1 员工情况
6.2 劳动合同
6.3 社会保险

## 第七章 税务合规
7.1 税务登记
7.2 纳税情况
7.3 税收优惠

## 第八章 诉讼仲裁
8.1 诉讼案件
8.2 仲裁案件
8.3 行政处罚
`;

// Convert file to base64
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}

interface ParseTemplateParams {
  projectId: string;
  content: string;
  filename: string;
  fileType?: string;
}

interface ParsedChapter {
  title: string;
  number: string;
  description?: string;
  subsections?: string[];
}

// Parse template content and create chapters
export function useParseTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, content, filename, fileType }: ParseTemplateParams) => {
      // Simple parsing logic - extract chapters from content
      const chapters: ParsedChapter[] = [];
      const lines = content.split('\n');
      
      let currentChapter: ParsedChapter | null = null;
      let chapterIndex = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        
        // Match chapter headers like "## 第一章 公司基本情况" or "# 第一章"
        const chapterMatch = trimmed.match(/^#{1,2}\s*(第[一二三四五六七八九十]+章)\s*(.*)$/);
        if (chapterMatch) {
          if (currentChapter) {
            chapters.push(currentChapter);
          }
          chapterIndex++;
          currentChapter = {
            title: chapterMatch[2] || chapterMatch[1],
            number: String(chapterIndex),
            description: '',
            subsections: [],
          };
          continue;
        }

        // Match subsections like "1.1 公司设立"
        const subsectionMatch = trimmed.match(/^(\d+\.\d+)\s+(.+)$/);
        if (subsectionMatch && currentChapter) {
          currentChapter.subsections = currentChapter.subsections || [];
          currentChapter.subsections.push(subsectionMatch[2]);
        }
      }

      // Add last chapter
      if (currentChapter) {
        chapters.push(currentChapter);
      }

      // If no chapters found, create default structure
      if (chapters.length === 0) {
        chapters.push(
          { title: "公司基本情况", number: "1", description: "目标公司的工商登记、设立、存续情况" },
          { title: "股权结构", number: "2", description: "股东信息、持股比例、股权变更历史" },
          { title: "公司治理", number: "3", description: "章程、决议、高管信息" },
          { title: "重大资产", number: "4", description: "房产、土地、知识产权等重大资产" },
          { title: "重大合同", number: "5", description: "主要业务合同、借款合同、担保合同等" },
          { title: "劳动人事", number: "6", description: "员工情况、劳动合同、社保公积金" },
          { title: "税务合规", number: "7", description: "税务登记、纳税情况、税收优惠" },
          { title: "诉讼仲裁", number: "8", description: "诉讼、仲裁、行政处罚情况" },
        );
      }

      // Delete existing chapters for this project first
      await supabase
        .from("chapters")
        .delete()
        .eq("project_id", projectId);

      // Insert new chapters
      // Note: status must be one of: '未匹配', '资料不足', '已匹配' (per database constraint)
      const chaptersToInsert = chapters.map((chapter, index) => ({
        project_id: projectId,
        title: chapter.title,
        number: chapter.number,
        description: chapter.description || chapter.subsections?.join(", ") || "",
        order_index: index,
        status: "未匹配",
      }));

      const { data, error } = await supabase
        .from("chapters")
        .insert(chaptersToInsert)
        .select();

      if (error) {
        throw new Error(`Failed to create chapters: ${error.message}`);
      }

      return {
        chapters: data,
        parsedCount: chapters.length,
        filename,
      };
    },
    onSuccess: (data, variables) => {
      // Invalidate chapters query to refresh the list
      queryClient.invalidateQueries({ queryKey: ["chapters", variables.projectId] });
    },
  });
}
