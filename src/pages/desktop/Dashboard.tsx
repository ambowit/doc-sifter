import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  useProjects,
  useCreateProject,
  useUpdateProject,
  useDeleteProject,
  setCurrentProjectId,
  type CreateProjectData,
  type ProjectType,
  type ReportLanguage,
  type ProjectStatus,
} from "@/hooks/useProjects";
import {
  ProjectStatus as ProjectStatusEnum,
  ProjectStatusLabels,
  ProjectType as ProjectTypeEnum,
  ProjectTypeLabels,
  ReportLanguage as ReportLanguageEnum,
  ReportLanguageLabels,
} from "@/lib/enums";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Search,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Upload,
  ArrowRight,
  Trash2,
  Building2,
  User,
  FileCheck,
  Loader2,
  GitBranch,
  Eye,
  Edit3,
} from "lucide-react";

const statusConfig: Record<ProjectStatus, { label: string; color: string; icon: React.ReactNode }> = {
  [ProjectStatusEnum.NOT_UPLOADED]: { label: ProjectStatusLabels[ProjectStatusEnum.NOT_UPLOADED], color: "bg-muted text-muted-foreground", icon: <Upload className="w-3 h-3" /> },
  [ProjectStatusEnum.PARSING]: { label: ProjectStatusLabels[ProjectStatusEnum.PARSING], color: "bg-amber-100 text-amber-700", icon: <Clock className="w-3 h-3" /> },
  [ProjectStatusEnum.MAPPING]: { label: ProjectStatusLabels[ProjectStatusEnum.MAPPING], color: "bg-blue-100 text-blue-700", icon: <GitBranch className="w-3 h-3" /> },
  [ProjectStatusEnum.PENDING_REVIEW]: { label: ProjectStatusLabels[ProjectStatusEnum.PENDING_REVIEW], color: "bg-purple-100 text-purple-700", icon: <Eye className="w-3 h-3" /> },
  [ProjectStatusEnum.COMPLETED]: { label: ProjectStatusLabels[ProjectStatusEnum.COMPLETED], color: "bg-emerald-100 text-emerald-700", icon: <CheckCircle2 className="w-3 h-3" /> },
};

interface FormErrors {
  name?: string;
  client?: string;
  target?: string;
}

const initialFormData: CreateProjectData = {
  name: "",
  client: "",
  target: "",
  projectType: ProjectTypeEnum.EQUITY_ACQUISITION,
  reportLanguage: ReportLanguageEnum.ZH,
  strictEvidenceMode: true,
  description: "",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { data: projects = [], isLoading, error } = useProjects();
  const createProjectMutation = useCreateProject();
  const updateProjectMutation = useUpdateProject();
  const deleteProjectMutation = useDeleteProject();

  const [searchQuery, setSearchQuery] = useState("");
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [newProject, setNewProject] = useState<CreateProjectData>(initialFormData);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);

  // Filter projects based on search
  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.client.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.target.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Calculate stats
  const stats = {
    total: projects.length,
    completed: projects.filter((p) => p.status === ProjectStatusEnum.COMPLETED).length,
    inProgress: projects.filter((p) => [ProjectStatusEnum.PARSING, ProjectStatusEnum.MAPPING, ProjectStatusEnum.PENDING_REVIEW].includes(p.status)).length,
    pending: projects.filter((p) => p.status === ProjectStatusEnum.NOT_UPLOADED).length,
  };

  const validateForm = (): boolean => {
    const errors: FormErrors = {};

    if (!newProject.name?.trim()) {
      errors.name = "请输入项目名称";
    } else if (newProject.name.trim().length < 2) {
      errors.name = "项目名称至少需要2个字符";
    }

    if (!newProject.client?.trim()) {
      errors.client = "请输入客户名称";
    }

    if (!newProject.target?.trim()) {
      errors.target = "请输入标的公司名称";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateProject = async () => {
    // Prevent double submission
    if (createProjectMutation.isPending || updateProjectMutation.isPending) {
      return;
    }
    
    if (!validateForm()) {
      toast.error("请完善必填信息", {
        description: "项目名称、客户名称和标的公司为必填项",
      });
      return;
    }
    
    try {
      // 编辑模式
      if (editingProjectId) {
        console.log("[Dashboard] Updating project:", editingProjectId);
        await updateProjectMutation.mutateAsync({
          projectId: editingProjectId,
          data: newProject,
        });
        toast.success("项目更新成功");
        handleCloseDialog();
        return;
      }
      
      // 新建模式
      console.log("[Dashboard] Creating project:", newProject.name);
      const project = await createProjectMutation.mutateAsync(newProject);
      console.log("[Dashboard] Project created:", project.id);

      toast.success("项目创建成功", {
        description: `项目「${project.name}」已创建`,
      });

      setCurrentProjectId(project.id);
      setIsNewProjectOpen(false);
      setNewProject(initialFormData);
      setFormErrors({});

      // Navigate to template fingerprint page first
      navigate(`/project/${project.id}/template`);
    } catch (error) {
      console.error("[Dashboard] Create project failed:", error);
      toast.error("创建项目失败", {
        description: error instanceof Error ? error.message : "未知错误",
      });
    }
  };

  const handleOpenDialog = () => {
    setFormErrors({});
    setIsNewProjectOpen(true);
  };

  const handleCloseDialog = () => {
    setIsNewProjectOpen(false);
    setNewProject(initialFormData);
    setFormErrors({});
    setEditingProjectId(null);
  };

  const handleDeleteProject = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();

    // Prevent double-click or clicking while another delete is in progress
    if (deletingProjectId) {
      return;
    }

    setDeletingProjectId(projectId);
    try {
      await deleteProjectMutation.mutateAsync(projectId);
      toast.success("项目已删除");
    } catch (error) {
      toast.error("删除失败", {
        description: error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      setDeletingProjectId(null);
    }
  };

  const handleEnterProject = (projectId: string) => {
    setCurrentProjectId(projectId);
    navigate(`/project/${projectId}/template`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded" />
          ))}
        </div>
        <Skeleton className="h-10 w-80 mb-4" />
        <Skeleton className="h-64 rounded" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[400px]">
        <AlertCircle className="w-12 h-12 text-destructive mb-4" />
        <h2 className="text-lg font-semibold mb-2">加载失���</h2>
        <p className="text-muted-foreground mb-4">{error.message}</p>
        <Button onClick={() => window.location.reload()}>重试</Button>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-foreground tracking-tight">尽调项目</h1>
          <p className="text-[13px] text-muted-foreground mt-1">
            管理和跟踪所有尽职调查项目
          </p>
        </div>
        <Button onClick={handleOpenDialog} className="gap-2">
          <Plus className="w-4 h-4" />
          新建项目
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="border border-border rounded bg-card p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            全部项目
          </div>
          <div className="text-3xl font-semibold tabular-nums">{stats.total}</div>
        </div>
        <div className="border border-border rounded bg-card p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            已完成
          </div>
          <div className="text-3xl font-semibold tabular-nums text-status-success">{stats.completed}</div>
        </div>
        <div className="border border-border rounded bg-card p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            进行中
          </div>
          <div className="text-3xl font-semibold tabular-nums text-interactive">{stats.inProgress}</div>
        </div>
        <div className="border border-border rounded bg-card p-4">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            待上传
          </div>
          <div className="text-3xl font-semibold tabular-nums">{stats.pending}</div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="搜索项目名称、客户或标的公司..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-[13px]"
          />
        </div>
      </div>

      {/* Projects Table */}
      <div className="border border-border rounded overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 bg-surface-subtle border-b border-border text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-3 px-4">
          <div className="col-span-3">项目名称</div>
          <div className="col-span-2">客户</div>
          <div className="col-span-2">标的公司</div>
          <div className="col-span-1">类型</div>
          <div className="col-span-1">状态</div>
          <div className="col-span-1">更新时间</div>
          <div className="col-span-2 text-right">操作</div>
        </div>

        {/* Table Body */}
        {filteredProjects.length === 0 ? (
          <div className="py-12 text-center">
            <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-[13px] text-muted-foreground">
              {searchQuery ? "未找到匹配的项目" : "暂无项目，点击上方按钮创建"}
            </p>
          </div>
        ) : (
          filteredProjects.map((project) => {
            // Fallback to NOT_UPLOADED if status is not found in config
            const status = statusConfig[project.status] || statusConfig[ProjectStatusEnum.NOT_UPLOADED];
            const updatedDate = new Date(project.updatedAt).toLocaleDateString("zh-CN", {
              month: "2-digit",
              day: "2-digit",
            });

            return (
              <div
                key={project.id}
                className="grid grid-cols-12 items-center py-3 px-4 border-b border-border last:border-b-0 hover:bg-surface-subtle transition-colors cursor-pointer"
                onClick={() => handleEnterProject(project.id)}
              >
                <div className="col-span-3">
                  <div className="font-medium text-[13px] text-foreground">{project.name}</div>
                  <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {project.id.slice(0, 8)}
                  </div>
                </div>
                <div className="col-span-2 text-[13px] truncate">{project.client}</div>
                <div className="col-span-2 text-[13px] truncate">{project.target}</div>
                <div className="col-span-1">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {ProjectTypeLabels[project.projectType as keyof typeof ProjectTypeLabels] || project.projectType}
                  </span>
                </div>
                <div className="col-span-1">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded",
                      status.color
                    )}
                  >
                    {status.icon}
                    {status.label}
                  </span>
                </div>
                <div className="col-span-1 text-[12px] text-muted-foreground font-mono tabular-nums">
                  {updatedDate}
                </div>
                <div className="col-span-2 text-right flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[12px] gap-1 text-muted-foreground hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewProject({
                        name: project.name,
                        client: project.client,
                        target: project.target,
                        projectType: project.projectType as ProjectTypeEnum,
                        reportLanguage: project.reportLanguage as ReportLanguageEnum,
                        strictEvidenceMode: project.strictEvidenceMode,
                        description: project.description || "",
                      });
                      setEditingProjectId(project.id);
                      setIsNewProjectOpen(true);
                    }}
                  >
                    <Edit3 className="w-3 h-3" />
                    编辑
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDeleteProject(e, project.id)}
                    disabled={deletingProjectId === project.id}
                  >
                    {deletingProjectId === project.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[12px] gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEnterProject(project.id);
                    }}
                  >
                    进入
                    <ArrowRight className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Project Dialog */}
      <Dialog open={isNewProjectOpen} onOpenChange={handleCloseDialog}>
        <DialogContent className="sm:max-w-lg" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingProjectId ? <Edit3 className="w-5 h-5" /> : <FileCheck className="w-5 h-5" />}
              {editingProjectId ? "编辑项目" : "新建尽调项目"}
            </DialogTitle>
            <DialogDescription>
              {editingProjectId 
                ? "修改项目的基本信息" 
                : "创建新的尽职调查项目，系统将引导您完成文件上传和报告生成"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Project Name */}
            <div className="space-y-2">
              <Label htmlFor="project-name" className="text-[13px] flex items-center gap-1">
                项目名称 <span className="text-destructive">*</span>
              </Label>
              <Input
                id="project-name"
                placeholder="请输入项目名称"
                value={newProject.name}
                onChange={(e) => {
                  setNewProject({ ...newProject, name: e.target.value });
                  if (formErrors.name) setFormErrors({ ...formErrors, name: undefined });
                }}
                className={cn("text-[13px]", formErrors.name && "border-destructive")}
              />
              {formErrors.name && (
                <p className="text-[11px] text-destructive">{formErrors.name}</p>
              )}
            </div>

            {/* Client & Target */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[13px] flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  客户名称 <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="请输入客户名称"
                  value={newProject.client}
                  onChange={(e) => {
                    setNewProject({ ...newProject, client: e.target.value });
                    if (formErrors.client) setFormErrors({ ...formErrors, client: undefined });
                  }}
                  className={cn("text-[13px]", formErrors.client && "border-destructive")}
                />
                {formErrors.client && (
                  <p className="text-[11px] text-destructive">{formErrors.client}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-[13px] flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" />
                  标的公司 <span className="text-destructive">*</span>
                </Label>
                <Input
                  placeholder="请输入标的公司名称"
                  value={newProject.target}
                  onChange={(e) => {
                    setNewProject({ ...newProject, target: e.target.value });
                    if (formErrors.target) setFormErrors({ ...formErrors, target: undefined });
                  }}
                  className={cn("text-[13px]", formErrors.target && "border-destructive")}
                />
                {formErrors.target && (
                  <p className="text-[11px] text-destructive">{formErrors.target}</p>
                )}
              </div>
            </div>

            {/* Type & Language */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[13px]">项目类型</Label>
                <Select
                  value={newProject.projectType}
                  onValueChange={(value) =>
                    setNewProject({ ...newProject, projectType: value as ProjectType })
                  }
                >
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ProjectTypeEnum.EQUITY_ACQUISITION}>{ProjectTypeLabels[ProjectTypeEnum.EQUITY_ACQUISITION]}</SelectItem>
                    <SelectItem value={ProjectTypeEnum.ASSET_ACQUISITION}>{ProjectTypeLabels[ProjectTypeEnum.ASSET_ACQUISITION]}</SelectItem>
                    <SelectItem value={ProjectTypeEnum.IPO}>{ProjectTypeLabels[ProjectTypeEnum.IPO]}</SelectItem>
                    <SelectItem value={ProjectTypeEnum.BOND_ISSUANCE}>{ProjectTypeLabels[ProjectTypeEnum.BOND_ISSUANCE]}</SelectItem>
                    <SelectItem value={ProjectTypeEnum.FINANCING}>{ProjectTypeLabels[ProjectTypeEnum.FINANCING]}</SelectItem>
                    <SelectItem value={ProjectTypeEnum.OTHER}>{ProjectTypeLabels[ProjectTypeEnum.OTHER]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[13px]">报告语言</Label>
                <Select
                  value={newProject.reportLanguage}
                  onValueChange={(value) =>
                    setNewProject({ ...newProject, reportLanguage: value as ReportLanguage })
                  }
                >
                  <SelectTrigger className="text-[13px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ReportLanguageEnum.ZH}>{ReportLanguageLabels[ReportLanguageEnum.ZH]}</SelectItem>
                    <SelectItem value={ReportLanguageEnum.EN}>{ReportLanguageLabels[ReportLanguageEnum.EN]}</SelectItem>
                    <SelectItem value={ReportLanguageEnum.ZH_EN}>{ReportLanguageLabels[ReportLanguageEnum.ZH_EN]}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label className="text-[13px]">项目描述（可选）</Label>
              <Textarea
                placeholder="请输入项目描述"
                value={newProject.description}
                onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                className="text-[13px] min-h-[80px] resize-none"
              />
            </div>

          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={handleCloseDialog}
              disabled={createProjectMutation.isPending}
            >
              取消
            </Button>
            <Button
              onClick={handleCreateProject}
              className="gap-2"
              disabled={createProjectMutation.isPending || updateProjectMutation.isPending}
            >
              {(createProjectMutation.isPending || updateProjectMutation.isPending) ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {editingProjectId ? "保存中..." : "创建中..."}
                </>
              ) : (
                <>
                  {editingProjectId ? "保存" : "创建项目"}
                  {!editingProjectId && <ArrowRight className="w-4 h-4" />}
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
