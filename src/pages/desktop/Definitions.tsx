import { useState, useMemo, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookMarked,
  Plus,
  Search,
  Edit2,
  Trash2,
  AlertTriangle,
  FileText,
  MoreVertical,
  RefreshCw,
  Download,
  Building2,
  User,
  Landmark,
  Briefcase,
  ChevronRight,
  Eye,
  Loader2,
  Sparkles,
  Brain,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentProject } from "@/hooks/useProjects";
import { useFiles } from "@/hooks/useFiles";
import {
  useDefinitions,
  useCreateDefinition,
  useUpdateDefinition,
  useDeleteDefinition,
  useRegenerateDefinitions,
  calculateDefinitionStats,
  type Definition,
  type EntityType,
} from "@/hooks/useDefinitions";

const typeConfig: Record<EntityType, { label: string; icon: typeof Building2; color: string }> = {
  company: { label: "公司", icon: Building2, color: "bg-blue-100 text-blue-700" },
  individual: { label: "自然人", icon: User, color: "bg-green-100 text-green-700" },
  institution: { label: "机构", icon: Landmark, color: "bg-purple-100 text-purple-700" },
  transaction: { label: "交易", icon: Briefcase, color: "bg-amber-100 text-amber-700" },
  other: { label: "其他", icon: FileText, color: "bg-gray-100 text-gray-700" },
};

interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: Definition | null;
  projectId: string;
  files: Array<{ id: string; originalName: string }>;
  onSave: (data: {
    shortName: string;
    fullName: string;
    entityType: EntityType;
    notes?: string;
    sourceFileId?: string;
    sourcePageRef?: string;
  }) => void;
  isSaving: boolean;
}

function EditDefinitionDialog({
  open,
  onOpenChange,
  definition,
  projectId,
  files,
  onSave,
  isSaving,
}: EditDialogProps) {
  const [shortName, setShortName] = useState("");
  const [fullName, setFullName] = useState("");
  const [type, setType] = useState<EntityType>("company");
  const [notes, setNotes] = useState("");
  const [sourceFileId, setSourceFileId] = useState("");
  const [sourcePageRef, setSourcePageRef] = useState("");

  useEffect(() => {
    if (open) {
      setShortName(definition?.shortName || "");
      setFullName(definition?.fullName || "");
      setType(definition?.entityType || "company");
      setNotes(definition?.notes || "");
      setSourceFileId(definition?.sourceFileId || "");
      setSourcePageRef(definition?.sourcePageRef || "");
    }
  }, [open, definition]);

  const handleSave = () => {
    if (!shortName.trim() || !fullName.trim()) {
      toast.error("请填写必填项");
      return;
    }
    onSave({
      shortName: shortName.trim(),
      fullName: fullName.trim(),
      entityType: type,
      notes: notes.trim() || undefined,
      sourceFileId: sourceFileId || undefined,
      sourcePageRef: sourcePageRef.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{definition ? "编辑定义" : "新增定义"}</DialogTitle>
          <DialogDescription>
            {definition ? "修改定义项的简称或全称" : "添加新的定义项到列表"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-muted-foreground">简称 *</label>
              <Input
                value={shortName}
                onChange={(e) => setShortName(e.target.value)}
                placeholder="如：目标公司"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">类型</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as EntityType)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                {Object.entries(typeConfig).map(([key, config]) => (
                  <option key={key} value={key}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[12px] text-muted-foreground">全称 *</label>
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="如：星辰科技有限公司"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-muted-foreground">来源文件</label>
              <select
                value={sourceFileId}
                onChange={(e) => setSourceFileId(e.target.value)}
                className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-[13px]"
              >
                <option value="">-- 选择文件 --</option>
                {files.map((file) => (
                  <option key={file.id} value={file.id}>
                    {file.originalName.length > 30
                      ? file.originalName.slice(0, 30) + "..."
                      : file.originalName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">页码引用</label>
              <Input
                value={sourcePageRef}
                onChange={(e) => setSourcePageRef(e.target.value)}
                placeholder="如：P.1"
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] text-muted-foreground">备注</label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="可选备注信息"
              className="mt-1"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                保存中...
              </>
            ) : (
              "保存"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Definitions() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: currentProject, isLoading: isProjectLoading } = useCurrentProject();

  // Fetch real data
  const { data: definitions = [], isLoading: isDefinitionsLoading } = useDefinitions(projectId);
  const { data: files = [], isLoading: isFilesLoading } = useFiles(projectId);

  // Mutations
  const createMutation = useCreateDefinition();
  const updateMutation = useUpdateDefinition();
  const deleteMutation = useDeleteDefinition();
  const regenerateMutation = useRegenerateDefinitions();

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<EntityType | "all">("all");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<Definition | null>(null);

  // Filter definitions
  const filteredDefinitions = useMemo(() => {
    return definitions.filter((def) => {
      const matchesSearch =
        searchQuery === "" ||
        def.shortName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        def.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === "all" || def.entityType === filterType;
      return matchesSearch && matchesType;
    });
  }, [definitions, searchQuery, filterType]);

  // Statistics
  const stats = useMemo(() => calculateDefinitionStats(definitions), [definitions]);

  const handleEdit = (def: Definition) => {
    setEditingDefinition(def);
    setEditDialogOpen(true);
  };

  const handleAdd = () => {
    setEditingDefinition(null);
    setEditDialogOpen(true);
  };

  const handleSave = async (data: {
    shortName: string;
    fullName: string;
    entityType: EntityType;
    notes?: string;
    sourceFileId?: string;
    sourcePageRef?: string;
  }) => {
    if (!projectId) return;

    try {
      if (editingDefinition) {
        await updateMutation.mutateAsync({
          id: editingDefinition.id,
          ...data,
        });
        toast.success("定义已更新");
      } else {
        await createMutation.mutateAsync({
          projectId,
          ...data,
        });
        toast.success("定义已添加");
      }
      setEditDialogOpen(false);
    } catch (error) {
      toast.error("操作失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!projectId) return;

    try {
      await deleteMutation.mutateAsync({ id, projectId });
      toast.success("定义已删除");
    } catch (error) {
      toast.error("删除失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  const handleRegenerate = async () => {
    if (!projectId) return;

    try {
      const result = await regenerateMutation.mutateAsync(projectId);
      toast.success("定义列表已重新生成", {
        description: `已从数据室文件中提取 ${result.length} 个定义`,
      });
    } catch (error) {
      toast.error("重新生成失败", {
        description: error instanceof Error ? error.message : "请稍后重试",
      });
    }
  };

  const handleExport = () => {
    if (definitions.length === 0) {
      toast.error("暂无定义可导出");
      return;
    }

    // Generate CSV content
    const headers = ["简称", "全称", "类型", "备注", "来源文件", "页码"];
    const rows = definitions.map((def) => [
      def.shortName,
      def.fullName,
      typeConfig[def.entityType].label,
      def.notes || "",
      def.sourceFileName || "",
      def.sourcePageRef || "",
    ]);

    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");

    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentProject?.name || "项目"}_定义表.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success("定义表已导出");
  };

  const isLoading = isProjectLoading || isDefinitionsLoading || isFilesLoading;

  if (isLoading) {
    return (
      <div className="h-full flex flex-col p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    );
  }

  if (!currentProject) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <BookMarked className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-lg font-semibold mb-2">请先选择项目</h2>
          <p className="text-muted-foreground text-sm mb-4">返回仪表板选择一个项目</p>
          <Button onClick={() => navigate("/")}>返回项目列表</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-lg font-semibold text-foreground">定义与简称</h1>
          <p className="text-[13px] text-muted-foreground">确认或编辑报告中使用的主体简称，完成后可生成报告</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={regenerateMutation.isPending}
            className="gap-2"
          >
            {regenerateMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Brain className="w-4 h-4" />
            )}
            AI 重新提取
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            导出
          </Button>
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="w-4 h-4" />
            新增定义
          </Button>
        </div>
      </div>

      {/* Stats Banner */}
      <div className="mx-6 mt-4 p-4 bg-card border border-border rounded-lg">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookMarked className="w-5 h-5 text-primary" />
            </div>
            <div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">定义总数</div>
              <div className="text-[15px] font-semibold">{stats.total} 项</div>
            </div>
          </div>

          <div className="flex-1 flex items-center gap-4">
            {Object.entries(typeConfig).map(([key, config]) => {
              const Icon = config.icon;
              const count = stats.byType[key as EntityType];
              return (
                <div key={key} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-[13px]">
                    {config.label} <span className="font-semibold">{count}</span>
                  </span>
                </div>
              );
            })}
          </div>

          {stats.conflicts > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span className="text-[12px] text-amber-800 font-medium">{stats.conflicts} 个简称冲突</span>
            </div>
          )}
        </div>
      </div>

      {/* Empty State */}
      {definitions.length === 0 && !isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-md">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-2">暂无定义</h2>
            <p className="text-muted-foreground text-[13px] mb-6">
              点击"AI 重新提取"按钮，系统将自动从数据室文件中提取主体名称和简称，或手动添加定义。
            </p>
            <div className="flex justify-center gap-3">
              <Button variant="outline" onClick={handleAdd} className="gap-2">
                <Plus className="w-4 h-4" />
                手动添加
              </Button>
              <Button onClick={handleRegenerate} disabled={regenerateMutation.isPending} className="gap-2">
                {regenerateMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Brain className="w-4 h-4" />
                )}
                AI 自动提取
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search & Filter (only show when there are definitions) */}
      {definitions.length > 0 && (
        <>
          <div className="px-6 py-3 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索简称或全称..."
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-muted-foreground">类型：</span>
              <div className="flex gap-1">
                <Badge
                  variant={filterType === "all" ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setFilterType("all")}
                >
                  全部
                </Badge>
                {Object.entries(typeConfig).map(([key, config]) => (
                  <Badge
                    key={key}
                    variant={filterType === key ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => setFilterType(key as EntityType)}
                  >
                    {config.label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="flex-1 px-6 pb-6 overflow-hidden">
            <div className="h-full border border-border rounded-lg bg-card overflow-hidden">
              <ScrollArea className="h-full">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead className="w-[140px]">简称</TableHead>
                      <TableHead>全称</TableHead>
                      <TableHead className="w-[100px]">类型</TableHead>
                      <TableHead className="w-[200px]">来源文件</TableHead>
                      <TableHead className="w-[150px]">备注</TableHead>
                      <TableHead className="w-[80px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <AnimatePresence>
                      {filteredDefinitions.map((def, idx) => {
                        const TypeIcon = typeConfig[def.entityType].icon;
                        return (
                          <motion.tr
                            key={def.id}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ delay: idx * 0.02 }}
                            className={cn(
                              "border-b border-border hover:bg-muted/30 transition-colors",
                              def.hasConflict && "bg-amber-50/50"
                            )}
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-[13px]">"{def.shortName}"</span>
                                {def.hasConflict && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
                              </div>
                            </TableCell>
                            <TableCell className="text-[13px]">{def.fullName}</TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className={cn("text-[10px]", typeConfig[def.entityType].color)}
                              >
                                <TypeIcon className="w-3 h-3 mr-1" />
                                {typeConfig[def.entityType].label}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {def.sourceFileName ? (
                                <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 bg-muted rounded">
                                  <FileText className="w-3 h-3" />
                                  {def.sourceFileName.length > 20
                                    ? def.sourceFileName.slice(0, 20) + "..."
                                    : def.sourceFileName}
                                  {def.sourcePageRef && (
                                    <span className="text-muted-foreground">({def.sourcePageRef})</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="text-[12px] text-muted-foreground">
                              {def.hasConflict ? (
                                <span className="text-amber-600">与"{def.conflictWith}"冲突</span>
                              ) : (
                                def.notes || "-"
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => handleEdit(def)}>
                                    <Edit2 className="w-4 h-4 mr-2" />
                                    编辑
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => handleDelete(def.id)}
                                    className="text-destructive"
                                  >
                                    <Trash2 className="w-4 h-4 mr-2" />
                                    删除
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </TableCell>
                          </motion.tr>
                        );
                      })}
                    </AnimatePresence>
                  </TableBody>
                </Table>

                {filteredDefinitions.length === 0 && definitions.length > 0 && (
                  <div className="py-12 text-center">
                    <BookMarked className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-[13px] text-muted-foreground">未找到匹配的定义</p>
                  </div>
                )}
              </ScrollArea>
            </div>
          </div>
        </>
      )}

      {/* Bottom Action Bar */}
      <div className="px-6 py-4 border-t border-border bg-surface-subtle flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CheckCircle2 className="w-4 h-4 text-primary" />
            <span>定义表将自动插入报告的「定义与简称」章节</span>
          </div>
          {definitions.length > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              已配置 {definitions.length} 个定义
            </Badge>
          )}
        </div>
        <Button onClick={() => navigate(`/project/${projectId}/mapping`)} className="gap-2">
          下一步：AI智能分析
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Edit Dialog */}
      <EditDefinitionDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        definition={editingDefinition}
        projectId={projectId || ""}
        files={files.map((f) => ({ id: f.id, originalName: f.originalName }))}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />
    </div>
  );
}
