import { useState, useEffect, useCallback } from "react";
import { type Project } from "@/lib/mockData";

const STORAGE_KEY = "dd-organizer-projects";
const CURRENT_PROJECT_KEY = "dd-organizer-current-project";

// Initial mock projects
const initialProjects: Project[] = [
  {
    id: "PRJ-2026-001",
    name: "星辰科技并购尽调",
    client: "华创资本",
    target: "星辰科技有限公司",
    type: "并购",
    status: "已生成",
    progress: 100,
    updatedAt: "2026-01-21 14:30",
    filesCount: 156,
    chaptersCount: 8,
  },
  {
    id: "PRJ-2026-002",
    name: "云海数据A轮投资尽调",
    client: "红杉中国",
    target: "云海数据科技",
    type: "投资",
    status: "可生成",
    progress: 85,
    updatedAt: "2026-01-21 10:15",
    filesCount: 89,
    chaptersCount: 6,
  },
  {
    id: "PRJ-2026-003",
    name: "博远医疗合规审查",
    client: "博远医疗集团",
    target: "博远医疗集团",
    type: "合规",
    status: "解析中",
    progress: 45,
    updatedAt: "2026-01-20 16:42",
    filesCount: 234,
    chaptersCount: 12,
  },
];

export interface NewProjectData {
  name: string;
  client: string;
  target: string;
  type: "并购" | "投资" | "合规" | "自定义";
  language: "中文" | "英文";
  strictMode: boolean;
  description?: string;
}

export function useProjectStore() {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.error("Failed to parse stored projects:", error);
    }
    return initialProjects;
  });

  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(CURRENT_PROJECT_KEY);
    } catch {
      return null;
    }
  });

  // Persist projects to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    } catch (error) {
      console.error("Failed to save projects:", error);
    }
  }, [projects]);

  // Persist current project ID
  useEffect(() => {
    try {
      if (currentProjectId) {
        localStorage.setItem(CURRENT_PROJECT_KEY, currentProjectId);
      } else {
        localStorage.removeItem(CURRENT_PROJECT_KEY);
      }
    } catch (error) {
      console.error("Failed to save current project:", error);
    }
  }, [currentProjectId]);

  const generateProjectId = useCallback(() => {
    const year = new Date().getFullYear();
    const existingIds = projects
      .map((p) => p.id)
      .filter((id) => id.startsWith(`PRJ-${year}-`))
      .map((id) => parseInt(id.split("-")[2], 10))
      .filter((n) => !isNaN(n));
    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    return `PRJ-${year}-${String(maxId + 1).padStart(3, "0")}`;
  }, [projects]);

  const createProject = useCallback(
    (data: NewProjectData): Project => {
      const now = new Date();
      const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      const newProject: Project = {
        id: generateProjectId(),
        name: data.name,
        client: data.client,
        target: data.target,
        type: data.type,
        status: "未上传",
        progress: 0,
        updatedAt: formattedDate,
        filesCount: 0,
        chaptersCount: 0,
      };

      setProjects((prev) => [newProject, ...prev]);
      setCurrentProjectId(newProject.id);
      return newProject;
    },
    [generateProjectId]
  );

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
    );
  }, []);

  const deleteProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    if (currentProjectId === id) {
      setCurrentProjectId(null);
    }
  }, [currentProjectId]);

  const getCurrentProject = useCallback(() => {
    return projects.find((p) => p.id === currentProjectId) || null;
  }, [projects, currentProjectId]);

  const selectProject = useCallback((id: string) => {
    setCurrentProjectId(id);
  }, []);

  return {
    projects,
    currentProjectId,
    currentProject: getCurrentProject(),
    createProject,
    updateProject,
    deleteProject,
    selectProject,
  };
}
