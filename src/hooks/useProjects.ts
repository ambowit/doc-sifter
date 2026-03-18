import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { 
  ProjectStatus, 
  ProjectType, 
  ReportLanguage,
  type ProjectStatusType,
  type ProjectTypeType,
  type ReportLanguageType,
} from "@/lib/enums";

export type { ProjectStatusType as ProjectStatus };
export type { ProjectTypeType as ProjectType };
export type { ReportLanguageType as ReportLanguage };

export interface Project {
  id: string;
  userId: string;
  name: string;
  client: string;
  target: string;
  description: string | null;
  projectType: ProjectTypeType;
  reportLanguage: ReportLanguageType;
  strictEvidenceMode: boolean;
  status: ProjectStatusType;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectData {
  name: string;
  client: string;
  target: string;
  description?: string;
  projectType?: ProjectTypeType;
  reportLanguage?: ReportLanguageType;
  strictEvidenceMode?: boolean;
}

export interface UpdateProjectData {
  name?: string;
  client?: string;
  target?: string;
  description?: string;
  projectType?: ProjectTypeType;
  reportLanguage?: ReportLanguageType;
  strictEvidenceMode?: boolean;
  status?: ProjectStatusType;
  progress?: number;
}

// Transform database row to Project interface
const transformProject = (row: Record<string, unknown>): Project => ({
  id: row.id as string,
  userId: row.user_id as string,
  name: row.name as string,
  client: row.client as string,
  target: row.target as string,
  description: row.description as string | null,
  projectType: row.project_type as ProjectTypeType,
  reportLanguage: row.report_language as ReportLanguageType,
  strictEvidenceMode: row.strict_evidence_mode as boolean,
  status: row.status as ProjectStatusType,
  progress: row.progress as number,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

// Hook to fetch all projects for the current user
export function useProjects() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();

  return useQuery({
    queryKey: ["projects", user?.id],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");

      console.log("[useProjects] Fetching projects for user:", user.id);
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[useProjects] Error fetching projects:", error);
        throw error;
      }
      
      console.log("[useProjects] Fetched", data?.length || 0, "projects");
      return (data || []).map(transformProject);
    },
    // Only query when: auth loaded, has user, and is authenticated
    enabled: !!user && !authLoading && isAuthenticated,
    staleTime: 1000 * 30, // 30 seconds - keep data fresh
    gcTime: 1000 * 60 * 5, // 5 minutes garbage collection
    refetchOnWindowFocus: true,
    refetchOnMount: "always", // Always refetch on mount
    retry: 2,
    retryDelay: 1000,
  });
}

// Hook to fetch a single project by ID
export function useProject(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!projectId) throw new Error("Project ID is required");

      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .eq("user_id", user.id)
        .single();

      if (error) throw error;
      return transformProject(data);
    },
    enabled: !!user && !!projectId,
  });
}

// Hook to create a new project
export function useCreateProject() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (data: CreateProjectData) => {
      if (!user) {
        throw new Error("用户未登录，请先登录");
      }

      console.log("[useCreateProject] Creating project for user:", user.id);

      const { data: project, error } = await supabase
        .from("projects")
        .insert({
          user_id: user.id,
          name: data.name,
          client: data.client,
          target: data.target,
          description: data.description || null,
          project_type: data.projectType || ProjectType.EQUITY_ACQUISITION,
          report_language: data.reportLanguage || ReportLanguage.ZH,
          strict_evidence_mode: data.strictEvidenceMode ?? true,
        })
        .select()
        .single();

      if (error) {
        console.error("[useCreateProject] Database error:", error);
        throw new Error(`创建失败: ${error.message}`);
      }

      if (!project) {
        throw new Error("创建失败: 未返回项目数据");
      }

      console.log("[useCreateProject] Project created:", project.id);
      return transformProject(project);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => {
      console.error("[useCreateProject] Mutation error:", error);
    },
  });
}

// Hook to update a project
export function useUpdateProject() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, data }: { projectId: string; data: UpdateProjectData }) => {
      if (!user) throw new Error("User not authenticated");

      const updates: Record<string, unknown> = {};
      if (data.name !== undefined) updates.name = data.name;
      if (data.client !== undefined) updates.client = data.client;
      if (data.target !== undefined) updates.target = data.target;
      if (data.description !== undefined) updates.description = data.description;
      if (data.projectType !== undefined) updates.project_type = data.projectType;
      if (data.reportLanguage !== undefined) updates.report_language = data.reportLanguage;
      if (data.strictEvidenceMode !== undefined) updates.strict_evidence_mode = data.strictEvidenceMode;
      if (data.status !== undefined) updates.status = data.status;
      if (data.progress !== undefined) updates.progress = data.progress;

      const { data: project, error } = await supabase
        .from("projects")
        .update(updates)
        .eq("id", projectId)
        .eq("user_id", user.id)
        .select()
        .single();

      if (error) throw error;
      return transformProject(project);
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });
}

// Hook to delete a project
export function useDeleteProject() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (projectId: string) => {
      if (!user) throw new Error("User not authenticated");

      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", projectId)
        .eq("user_id", user.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

// Hook to get current project from localStorage with validation
export function useCurrentProject() {
  const { user, isLoading: authLoading, isAuthenticated } = useAuth();
  // Use state to make currentProjectId reactive
  const [currentProjectId, setCurrentProjectIdState] = useState<string | null>(
    () => localStorage.getItem("dd-organizer-current-project")
  );
  
  // Sync with localStorage changes via custom event
  useEffect(() => {
    const handleProjectChange = (e: Event) => {
      const customEvent = e as CustomEvent<string | null>;
      console.log("[useCurrentProject] Project changed event:", customEvent.detail);
      setCurrentProjectIdState(customEvent.detail);
    };
    
    // Listen for cross-tab changes
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "dd-organizer-current-project") {
        console.log("[useCurrentProject] Storage changed:", e.newValue);
        setCurrentProjectIdState(e.newValue);
      }
    };
    
    window.addEventListener("project-changed", handleProjectChange);
    window.addEventListener("storage", handleStorageChange);
    
    return () => {
      window.removeEventListener("project-changed", handleProjectChange);
      window.removeEventListener("storage", handleStorageChange);
    };
  }, []);
  
  const query = useQuery({
    queryKey: ["current-project", currentProjectId, user?.id],
    queryFn: async () => {
      if (!user) throw new Error("User not authenticated");
      if (!currentProjectId) return null;

      console.log("[useCurrentProject] Fetching project:", currentProjectId, "for user:", user.id);
      
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", currentProjectId)
        .eq("user_id", user.id)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          console.warn("[useCurrentProject] Project not found, clearing");
          localStorage.removeItem("dd-organizer-current-project");
          setCurrentProjectIdState(null);
          return null;
        }
        console.error("[useCurrentProject] Query error:", error);
        throw error;
      }
      
      if (!data) {
        console.warn("[useCurrentProject] No data returned, clearing");
        localStorage.removeItem("dd-organizer-current-project");
        setCurrentProjectIdState(null);
        return null;
      }
      
      console.log("[useCurrentProject] Project found:", data.name);
      return transformProject(data);
    },
    enabled: !!user && !!currentProjectId && !authLoading && isAuthenticated,
    staleTime: 1000 * 60 * 2,
    retry: 2,
    retryDelay: 1000,
  });
  
  return {
    ...query,
    data: query.data || undefined,
  };
}

// Function to set current project - dispatches event for reactivity
export function setCurrentProjectId(projectId: string | null) {
  if (projectId) {
    localStorage.setItem("dd-organizer-current-project", projectId);
  } else {
    localStorage.removeItem("dd-organizer-current-project");
  }
  // Dispatch custom event for same-tab reactivity
  window.dispatchEvent(new CustomEvent("project-changed", { detail: projectId }));
}

// Function to validate project exists in database
export async function validateProjectExists(projectId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();
    
    if (error || !data) {
      console.warn(`[Project] Project ${projectId} not found in database`);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Function to clear invalid project from localStorage
export function clearInvalidProject() {
  const currentProjectId = localStorage.getItem("dd-organizer-current-project");
  if (currentProjectId) {
    console.log("[Project] Clearing invalid project ID from localStorage:", currentProjectId);
    localStorage.removeItem("dd-organizer-current-project");
  }
}
