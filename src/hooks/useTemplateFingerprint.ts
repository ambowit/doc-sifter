import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TemplateSection {
  id: string;
  name: string;
  description?: string;
  requiredFields: string[];
  optionalFields?: string[];
  order: number;
}

export interface TemplateFingerprint {
  id: string;
  projectId: string;
  name: string;
  version: string;
  description?: string;
  sections: TemplateSection[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DbTemplateFingerprint {
  id: string;
  project_id: string;
  name: string;
  version: string;
  description: string | null;
  sections: TemplateSection[];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Transform DB record to frontend format
function transformTemplateFingerprint(db: DbTemplateFingerprint): TemplateFingerprint {
  return {
    id: db.id,
    projectId: db.project_id,
    name: db.name,
    version: db.version,
    description: db.description || undefined,
    sections: db.sections || [],
    metadata: db.metadata || undefined,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

// Default template for new projects
export const DEFAULT_TEMPLATE: Omit<TemplateFingerprint, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> = {
  name: "法律尽职调查报告模板",
  version: "1.0",
  description: "标准法律尽职调查报告模板，包含公司基本情况、股权结构、重大资产等章节",
  sections: [
    {
      id: "1",
      name: "公司基本情况",
      description: "目标公司的工商登记、设立、存续情况",
      requiredFields: ["公司名称", "统一社会信用代码", "成立日期", "注册资本", "实缴资本"],
      optionalFields: ["经营范围", "注册地址", "营业期限"],
      order: 1,
    },
    {
      id: "2",
      name: "股权结构",
      description: "股东信息、持股比例、股权变更历史",
      requiredFields: ["股东名称", "持股比例", "出资额", "出资方式"],
      optionalFields: ["股权代持情况", "股权质押情况"],
      order: 2,
    },
    {
      id: "3",
      name: "公司治理",
      description: "章程、决议、高管信息",
      requiredFields: ["法定代表人", "董事", "监事"],
      optionalFields: ["高级管理人员", "章程特殊条款"],
      order: 3,
    },
    {
      id: "4",
      name: "重大资产",
      description: "房产、土地、知识产权等重大资产",
      requiredFields: ["资产类型", "资产名称", "权属状态"],
      optionalFields: ["抵押情况", "使用限制"],
      order: 4,
    },
    {
      id: "5",
      name: "重大合同",
      description: "主要业务合同、借款合同、担保合同等",
      requiredFields: ["合同类型", "合同金额", "合同期限"],
      optionalFields: ["履行情况", "风险提示"],
      order: 5,
    },
    {
      id: "6",
      name: "劳动人事",
      description: "员工情况、劳动合同、社保公积金",
      requiredFields: ["员工总数", "劳动合同签订率"],
      optionalFields: ["社保缴纳情况", "劳动争议"],
      order: 6,
    },
    {
      id: "7",
      name: "税务合规",
      description: "税务登记、纳税情况、税收优惠",
      requiredFields: ["纳税人类型", "主要税种"],
      optionalFields: ["欠税情况", "税收优惠"],
      order: 7,
    },
    {
      id: "8",
      name: "诉讼仲裁",
      description: "诉讼、仲裁、行政处罚情况",
      requiredFields: ["案件类型", "案件状态"],
      optionalFields: ["涉案金额", "潜在风险"],
      order: 8,
    },
  ],
};

export function useTemplateFingerprint(projectId: string | undefined) {
  const queryClient = useQueryClient();

  // Fetch template fingerprint for a project
  const {
    data: templateFingerprint,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["templateFingerprint", projectId],
    queryFn: async () => {
      if (!projectId) return null;

      const { data, error } = await supabase
        .from("template_fingerprints")
        .select("*")
        .eq("project_id", projectId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      }

      return null;
    },
    enabled: !!projectId,
  });

  // Create or update template fingerprint
  const saveMutation = useMutation({
    mutationFn: async (template: Partial<TemplateFingerprint> & { projectId: string }) => {
      const { projectId: pid, sections, metadata, ...rest } = template;

      const payload = {
        project_id: pid,
        name: rest.name || DEFAULT_TEMPLATE.name,
        version: rest.version || DEFAULT_TEMPLATE.version,
        description: rest.description || DEFAULT_TEMPLATE.description,
        sections: sections || DEFAULT_TEMPLATE.sections,
        metadata: metadata || {},
      };

      // Check if template exists
      const { data: existing } = await supabase
        .from("template_fingerprints")
        .select("id")
        .eq("project_id", pid)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from("template_fingerprints")
          .update(payload)
          .eq("project_id", pid)
          .select()
          .single();

        if (error) throw error;
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("template_fingerprints")
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        return transformTemplateFingerprint(data as DbTemplateFingerprint);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["templateFingerprint", data.projectId], data);
    },
  });

  // Delete template fingerprint
  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      const { error } = await supabase
        .from("template_fingerprints")
        .delete()
        .eq("id", templateId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.setQueryData(["templateFingerprint", projectId], null);
    },
  });

  // Initialize with default template if none exists
  const initializeTemplate = async () => {
    if (!projectId) return null;
    
    return saveMutation.mutateAsync({
      projectId,
      ...DEFAULT_TEMPLATE,
    });
  };

  return {
    templateFingerprint,
    isLoading,
    error,
    refetch,
    saveTemplate: saveMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
    initializeTemplate,
    isSaving: saveMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
