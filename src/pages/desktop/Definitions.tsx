import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  BookMarked,
  Brain,
  Briefcase,
  Building2,
  CheckCircle2,
  Download,
  Edit2,
  FileText,
  Landmark,
  Loader2,
  MoreVertical,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  WandSparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentProject } from "@/hooks/useProjects";
import { useFiles } from "@/hooks/useFiles";
import {
  calculateCandidateStats,
  calculateDefinitionStats,
  type CandidateStatus,
  type Definition,
  type DefinitionCandidate,
  type EntityType,
  useApproveDefinitionCandidates,
  useCreateDefinition,
  useDefinitionCandidates,
  useDefinitions,
  useDeleteDefinition,
  useExtractDefinitions,
  useRejectDefinitionCandidates,
  useUpdateDefinition,
} from "@/hooks/useDefinitions";

const typeConfig: Record<EntityType, { label: string; icon: typeof Building2; color: string }> = {
  company: { label: "公司", icon: Building2, color: "bg-blue-100 text-blue-700" },
  individual: { label: "自然人", icon: User, color: "bg-green-100 text-green-700" },
  institution: { label: "机构", icon: Landmark, color: "bg-purple-100 text-purple-700" },
  transaction: { label: "交易", icon: Briefcase, color: "bg-amber-100 text-amber-700" },
  other: { label: "其他", icon: FileText, color: "bg-gray-100 text-gray-700" },
};

const candidateStatusConfig: Record<CandidateStatus, { label: string; className: string }> = {
  pending_review: { label: "待复核", className: "bg-amber-100 text-amber-700" },
  approved: { label: "已接受", className: "bg-green-100 text-green-700" },
  rejected: { label: "已拒绝", className: "bg-slate-100 text-slate-700" },
  archived: { label: "已归档", className: "bg-gray-100 text-gray-700" },
};

const originConfig = {
  manual: { label: "人工", className: "bg-slate-100 text-slate-700" },
  ai: { label: "AI", className: "bg-indigo-100 text-indigo-700" },
  imported: { label: "导入", className: "bg-cyan-100 text-cyan-700" },
} as const;

const reviewReasonLabel: Record<string, string> = {
  short_name_conflict: "简称冲突",
  full_name_alias: "全称别名冲突",
  incomplete_definition: "信息不完整",
  missing_source: "缺少来源",
  matched_existing_definition: "命中既有定义",
  matched_locked_definition: "命中锁定定义",
};

type SortDir = "asc" | "desc";
type DefinitionSortKey = "shortName" | "fullName" | "entityType";
type CandidateSortKey = "shortName" | "fullName" | "entityType" | "status";

function normalizeDefinitionKey(value: string | null | undefined): string {
  return (value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[“”"'《》()（）\[\]【】,，。.；;:：·]/g, "")
    .replace(/\s+/g, "");
}

function isInvalidDefinition(shortName: string | null | undefined, fullName: string | null | undefined): boolean {
  const shortKey = normalizeDefinitionKey(shortName);
  const fullKey = normalizeDefinitionKey(fullName);
  return Boolean(shortKey && fullKey && shortKey === fullKey);
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { sensitivity: "base" });
}

function compareWithDir(a: string, b: string, dir: SortDir): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const result = compareText(a, b);
  return dir === "asc" ? result : -result;
}

function isDuplicateDefinitionPair(
  definitions: Definition[],
  shortName: string,
  fullName: string,
  ignoreId?: string,
): boolean {
  const shortKey = normalizeDefinitionKey(shortName);
  const fullKey = normalizeDefinitionKey(fullName);
  if (!shortKey || !fullKey) return false;
  return definitions.some((definition) => {
    if (ignoreId && definition.id === ignoreId) return false;
    return normalizeDefinitionKey(definition.shortName) === shortKey
      && normalizeDefinitionKey(definition.fullName) === fullKey;
  });
}

function candidateDedupKey(candidate: DefinitionCandidate): string {
  const shortKey = normalizeDefinitionKey(candidate.shortName);
  const fullKey = normalizeDefinitionKey(candidate.fullName);
  if (!shortKey && !fullKey) return `id:${candidate.id}`;
  return `${shortKey}|${fullKey}`;
}

function candidatePriority(status: CandidateStatus): number {
  if (status === "pending_review") return 3;
  if (status === "rejected") return 2;
  if (status === "approved") return 1;
  return 0;
}

function dedupeCandidates(candidates: DefinitionCandidate[]): DefinitionCandidate[] {
  const byKey = new Map<string, DefinitionCandidate>();

  candidates.forEach((candidate) => {
    const key = candidateDedupKey(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      return;
    }

    const currentPriority = candidatePriority(candidate.status);
    const existingPriority = candidatePriority(existing.status);
    if (currentPriority > existingPriority) {
      byKey.set(key, candidate);
      return;
    }
    if (currentPriority < existingPriority) {
      return;
    }

    const currentConfidence = candidate.confidence ?? -1;
    const existingConfidence = existing.confidence ?? -1;
    if (currentConfidence > existingConfidence) {
      byKey.set(key, candidate);
      return;
    }

    if (currentConfidence === existingConfidence && candidate.updatedAt > existing.updatedAt) {
      byKey.set(key, candidate);
    }
  });

  return [...byKey.values()];
}

interface EditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: Definition | null;
  files: Array<{ id: string; originalName: string }>;
  onSave: (data: {
    shortName: string;
    fullName: string;
    entityType: EntityType;
    notes?: string;
    sourceFileId?: string;
    sourcePageRef?: string;
    sourceExcerpt?: string;
  }) => void;
  isSaving: boolean;
}

function SourceEvidence({ fileName, pageRef, excerpt, confidence }: { fileName?: string | null; pageRef?: string | null; excerpt?: string | null; confidence?: number | null; }) {
  return (
    <div className="space-y-1">
      {fileName ? (
        <div className="inline-flex items-center gap-1 text-[11px] px-2 py-1 bg-muted rounded">
          <FileText className="w-3 h-3" />
          <span className="truncate max-w-[180px]">{fileName}</span>
          {pageRef ? <span className="text-muted-foreground">({pageRef})</span> : null}
        </div>
      ) : <span className="text-[11px] text-muted-foreground">未关联来源文件</span>}
      {typeof confidence === "number" ? <div className="text-[11px] text-muted-foreground">置信度 {(confidence * 100).toFixed(0)}%</div> : null}
      {excerpt ? <p className="text-[11px] text-muted-foreground line-clamp-2 max-w-[360px]">{excerpt}</p> : null}
    </div>
  );
}

function EditDefinitionDialog({ open, onOpenChange, definition, files, onSave, isSaving }: EditDialogProps) {
  const [shortName, setShortName] = useState("");
  const [fullName, setFullName] = useState("");
  const [type, setType] = useState<EntityType>("company");
  const [notes, setNotes] = useState("");
  const [sourceFileId, setSourceFileId] = useState("");
  const [sourcePageRef, setSourcePageRef] = useState("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");

  useEffect(() => {
    if (!open) return;
    setShortName(definition?.shortName || "");
    setFullName(definition?.fullName || "");
    setType(definition?.entityType || "company");
    setNotes(definition?.notes || "");
    setSourceFileId(definition?.sourceFileId || "");
    setSourcePageRef(definition?.sourcePageRef || "");
    setSourceExcerpt(definition?.sourceExcerpt || "");
  }, [definition, open]);

  const handleSave = () => {
    const nextShortName = shortName.trim();
    const nextFullName = fullName.trim();
    if (!nextShortName || !nextFullName) {
      toast.error("请填写简称和全称");
      return;
    }
    if (isInvalidDefinition(nextShortName, nextFullName)) {
      toast.error("简称与全称一致，视为无效定义");
      return;
    }
    onSave({
      shortName: nextShortName,
      fullName: nextFullName,
      entityType: type,
      notes: notes.trim() || undefined,
      sourceFileId: sourceFileId || undefined,
      sourcePageRef: sourcePageRef.trim() || undefined,
      sourceExcerpt: sourceExcerpt.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{definition ? "编辑最终定义" : "新增最终定义"}</DialogTitle>
          <DialogDescription>维护最终定义表中的实体定义信息。</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-muted-foreground">简称 *</label>
              <Input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="如：目标公司" className="mt-1" />
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">类型</label>
              <select value={type} onChange={(e) => setType(e.target.value as EntityType)} className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-[13px]">
                {Object.entries(typeConfig).map(([key, config]) => <option key={key} value={key}>{config.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground">全称 *</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="如：星辰科技有限公司" className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[12px] text-muted-foreground">来源文件</label>
              <select value={sourceFileId} onChange={(e) => setSourceFileId(e.target.value)} className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-[13px]">
                <option value="">-- 选择文件 --</option>
                {files.map((file) => <option key={file.id} value={file.id}>{file.originalName}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] text-muted-foreground">页码引用</label>
              <Input value={sourcePageRef} onChange={(e) => setSourcePageRef(e.target.value)} placeholder="如：P12" className="mt-1" />
            </div>
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground">来源片段</label>
            <Textarea value={sourceExcerpt} onChange={(e) => setSourceExcerpt(e.target.value)} placeholder="记录定义原文或证据片段" className="mt-1 min-h-[88px]" />
          </div>
          <div>
            <label className="text-[12px] text-muted-foreground">备注</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选备注" className="mt-1" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>取消</Button>
          <Button onClick={handleSave} disabled={isSaving}>{isSaving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />保存中...</> : "保存"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Definitions() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const { data: currentProject, isLoading: isProjectLoading } = useCurrentProject();
  const { data: definitions = [], isLoading: isDefinitionsLoading } = useDefinitions(projectId);
  const { data: candidates = [], isLoading: isCandidatesLoading } = useDefinitionCandidates(projectId);
  const { data: files = [], isLoading: isFilesLoading } = useFiles(projectId);

  const createMutation = useCreateDefinition();
  const updateMutation = useUpdateDefinition();
  const deleteMutation = useDeleteDefinition();
  const extractMutation = useExtractDefinitions();
  const approveMutation = useApproveDefinitionCandidates();
  const rejectMutation = useRejectDefinitionCandidates();

  const [finalSearch, setFinalSearch] = useState("");
  const [finalViewFilter, setFinalViewFilter] = useState<"all" | "conflicts">("all");
  const [filterType, setFilterType] = useState<EntityType | "all">("all");
  const [candidateSearch, setCandidateSearch] = useState("");
  const [candidateFilter, setCandidateFilter] = useState<"all" | "pending" | "conflicts" | "risky">("all");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingDefinition, setEditingDefinition] = useState<Definition | null>(null);
  const [reExtractConfirmOpen, setReExtractConfirmOpen] = useState(false);
  const [finalSortKey, setFinalSortKey] = useState<DefinitionSortKey>("shortName");
  const [finalSortDir, setFinalSortDir] = useState<SortDir>("asc");
  const [candidateSortKey, setCandidateSortKey] = useState<CandidateSortKey>("shortName");
  const [candidateSortDir, setCandidateSortDir] = useState<SortDir>("asc");

  const validDefinitions = useMemo(
    () => definitions.filter((definition) => !isInvalidDefinition(definition.shortName, definition.fullName)),
    [definitions],
  );
  const definitionStats = useMemo(() => calculateDefinitionStats(validDefinitions), [validDefinitions]);

  const normalizedCandidates = useMemo(
    () => dedupeCandidates(candidates.filter((candidate) => !isInvalidDefinition(candidate.shortName, candidate.fullName))),
    [candidates],
  );
  const actionableCandidates = useMemo(
    () => normalizedCandidates.filter((candidate) => candidate.status === "pending_review"),
    [normalizedCandidates],
  );
  const candidateStats = useMemo(() => calculateCandidateStats(actionableCandidates), [actionableCandidates]);
  const actionableCandidateCount = actionableCandidates.length;
  const historicalCandidateCount = normalizedCandidates.length;

  const filteredDefinitions = useMemo(() => validDefinitions.filter((definition) => {
    const matchesSearch = !finalSearch || definition.shortName.toLowerCase().includes(finalSearch.toLowerCase()) || definition.fullName.toLowerCase().includes(finalSearch.toLowerCase()) || (definition.sourceFileName || "").toLowerCase().includes(finalSearch.toLowerCase());
    const matchesType = filterType === "all" || definition.entityType === filterType;
    const matchesView = finalViewFilter === "all" || definition.hasConflict;
    return matchesSearch && matchesType && matchesView;
  }), [validDefinitions, finalSearch, filterType, finalViewFilter]);

  const sortedDefinitions = useMemo(() => {
    const list = [...filteredDefinitions];
    list.sort((a, b) => {
      if (finalSortKey === "entityType") {
        return compareWithDir(typeConfig[a.entityType].label, typeConfig[b.entityType].label, finalSortDir);
      }
      if (finalSortKey === "shortName") {
        return compareWithDir(normalizeDefinitionKey(a.shortName), normalizeDefinitionKey(b.shortName), finalSortDir);
      }
      return compareWithDir(normalizeDefinitionKey(a.fullName), normalizeDefinitionKey(b.fullName), finalSortDir);
    });
    return list;
  }, [filteredDefinitions, finalSortDir, finalSortKey]);

  const filteredCandidates = useMemo(() => normalizedCandidates.filter((candidate) => {
    // 已接受的候选不再显示
    if (candidate.status === "approved") return false;
    const haystack = [candidate.shortName, candidate.fullName, candidate.sourceFileName, candidate.sourceExcerpt].filter(Boolean).join(" ").toLowerCase();
    const matchesSearch = !candidateSearch || haystack.includes(candidateSearch.toLowerCase());
    if (!matchesSearch) return false;
    if (candidateFilter === "pending") return candidate.status === "pending_review";
    if (candidateFilter === "conflicts") return candidate.hasConflict && candidate.status === "pending_review";
    if (candidateFilter === "risky") return candidate.status === "pending_review" && (!candidate.sourceFileId || !candidate.sourceExcerpt || ((candidate.confidence ?? 0) > 0 && (candidate.confidence ?? 0) < 0.6));
    return true;
  }), [candidateFilter, candidateSearch, normalizedCandidates]);

  const sortedCandidates = useMemo(() => {
    const list = [...filteredCandidates];
    list.sort((a, b) => {
      if (candidateSortKey === "entityType") {
        return compareWithDir(typeConfig[a.entityType].label, typeConfig[b.entityType].label, candidateSortDir);
      }
      if (candidateSortKey === "status") {
        return compareWithDir(candidateStatusConfig[a.status].label, candidateStatusConfig[b.status].label, candidateSortDir);
      }
      if (candidateSortKey === "shortName") {
        return compareWithDir(normalizeDefinitionKey(a.shortName), normalizeDefinitionKey(b.shortName), candidateSortDir);
      }
      return compareWithDir(normalizeDefinitionKey(a.fullName), normalizeDefinitionKey(b.fullName), candidateSortDir);
    });
    return list;
  }, [candidateSortDir, candidateSortKey, filteredCandidates]);

  const visibleCandidateCount = sortedCandidates.length;
  const selectableCandidates = useMemo(() => sortedCandidates.filter((candidate) => candidate.status === "pending_review"), [sortedCandidates]);
  const allSelectableChecked = selectableCandidates.length > 0 && selectableCandidates.every((candidate) => selectedCandidateIds.includes(candidate.id));
  const isLoading = isProjectLoading || isDefinitionsLoading || isCandidatesLoading || isFilesLoading;

  useEffect(() => {
    const selectableIdSet = new Set(selectableCandidates.map((candidate) => candidate.id));
    setSelectedCandidateIds((current) => {
      const next = current.filter((id) => selectableIdSet.has(id));
      return next.length === current.length ? current : next;
    });
  }, [selectableCandidates]);

  const handleAdd = () => { setEditingDefinition(null); setEditDialogOpen(true); };
  const handleEdit = (definition: Definition) => { setEditingDefinition(definition); setEditDialogOpen(true); };

  const handleSave = async (payload: { shortName: string; fullName: string; entityType: EntityType; notes?: string; sourceFileId?: string; sourcePageRef?: string; sourceExcerpt?: string; }) => {
    if (!projectId) return;
    if (isDuplicateDefinitionPair(validDefinitions, payload.shortName, payload.fullName, editingDefinition?.id)) {
      toast.error("简称与全称组合已存在，无需重复定义");
      return;
    }
    try {
      if (editingDefinition) {
        await updateMutation.mutateAsync({ id: editingDefinition.id, ...payload });
        toast.success("最终定义已更新");
      } else {
        await createMutation.mutateAsync({ projectId, ...payload });
        toast.success("最终定义已新增");
      }
      setEditDialogOpen(false);
    } catch (error) {
      toast.error("保存失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };

  const handleDelete = async (id: string) => {
    if (!projectId) return;
    try {
      await deleteMutation.mutateAsync({ id, projectId });
      toast.success("最终定义已删除");
    } catch (error) {
      toast.error("删除失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };



  const handleExtractConfirm = async () => {
    if (!projectId) return;
    setReExtractConfirmOpen(false);
    try {
      const result = await extractMutation.mutateAsync({ projectId, mode: "refresh" });
      toast.success("AI 候选已刷新", { description: `新增 ${result.inserted} 条候选，冲突 ${result.conflicts} 条，归档旧候选 ${result.archived} 条` });
      setSelectedCandidateIds([]);
    } catch (error) {
      toast.error("AI 提取失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };

  const handleApprove = async (candidateIds: string[]) => {
    if (!projectId || candidateIds.length === 0) return;
    try {
      const result = await approveMutation.mutateAsync({ projectId, candidateIds });
      toast.success("候选已写入最终定义", { description: `接受 ${result.approved} 条，新增 ${result.inserted} 条，更新 ${result.updated} 条` });
      setSelectedCandidateIds((current) => current.filter((id) => !candidateIds.includes(id)));
    } catch (error) {
      toast.error("接受候选失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };

  const handleReject = async (candidateIds: string[]) => {
    if (!projectId || candidateIds.length === 0) return;
    try {
      const result = await rejectMutation.mutateAsync({ projectId, candidateIds });
      toast.success("候选已拒绝", { description: `已拒绝 ${result.rejected} 条候选` });
      setSelectedCandidateIds((current) => current.filter((id) => !candidateIds.includes(id)));
    } catch (error) {
      toast.error("拒绝候选失败", { description: error instanceof Error ? error.message : "请稍后重试" });
    }
  };

  const handleExport = () => {
    if (validDefinitions.length === 0) {
      toast.error("暂无最终定义可导出");
      return;
    }
    const headers = ["简称", "全称", "类型", "来源", "页码", "来源片段", "备注"];
    const rows = validDefinitions.map((definition) => [definition.shortName, definition.fullName, typeConfig[definition.entityType].label, definition.sourceFileName || "", definition.sourcePageRef || "", definition.sourceExcerpt || "", definition.notes || ""]);
    const csvContent = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${currentProject?.name || "项目"}_最终定义表.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success("最终定义表已导出");
  };

  const toggleCandidateSelection = (candidateId: string, checked: boolean) => {
    setSelectedCandidateIds((current) => checked ? [...new Set([...current, candidateId])] : current.filter((id) => id !== candidateId));
  };

  const toggleAllSelectable = (checked: boolean) => {
    if (checked) {
      setSelectedCandidateIds((current) => [...new Set([...current, ...selectableCandidates.map((candidate) => candidate.id)])]);
      return;
    }
    setSelectedCandidateIds((current) => current.filter((id) => !selectableCandidates.some((candidate) => candidate.id === id)));
  };

  const handleFinalSort = (key: DefinitionSortKey) => {
    setFinalSortKey((prevKey) => {
      if (prevKey === key) {
        setFinalSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setFinalSortDir("asc");
      return key;
    });
  };

  const handleCandidateSort = (key: CandidateSortKey) => {
    setCandidateSortKey((prevKey) => {
      if (prevKey === key) {
        setCandidateSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
        return prevKey;
      }
      setCandidateSortDir("asc");
      return key;
    });
  };

  const renderSortIndicator = (active: boolean, dir: SortDir) => {
    if (!active) {
      return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    }
    return dir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  if (isLoading) {
    return <div className="h-full flex flex-col p-6 space-y-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-[600px] w-full" /></div>;
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
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background">
        <div>
          <h1 className="text-lg font-semibold text-foreground">定义管理</h1>
          <p className="text-[13px] text-muted-foreground">先抽取 AI 候选，再人工确认进入最终定义，报告仅使用最终定义。</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setReExtractConfirmOpen(true)} disabled={extractMutation.isPending} className="gap-2">
            {extractMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
            AI 重新提取
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />导出最终定义
          </Button>
          <Button onClick={handleAdd} className="gap-2">
            <Plus className="w-4 h-4" />新增最终定义
          </Button>
        </div>
      </div>

      <div className="mx-6 mt-4 p-4 bg-card border border-border rounded-lg grid grid-cols-3 gap-4">
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"><ShieldCheck className="w-5 h-5 text-primary" /></div><div><div className="text-[11px] text-muted-foreground uppercase tracking-wider">最终定义</div><div className="text-[16px] font-semibold">{definitionStats.total}</div></div></div>
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><WandSparkles className="w-5 h-5 text-amber-700" /></div><div><div className="text-[11px] text-muted-foreground uppercase tracking-wider">待复核候选</div><div className="text-[16px] font-semibold">{actionableCandidateCount}</div></div></div>
        <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-lg bg-rose-100 flex items-center justify-center"><AlertTriangle className="w-5 h-5 text-rose-700" /></div><div><div className="text-[11px] text-muted-foreground uppercase tracking-wider">冲突候选</div><div className="text-[16px] font-semibold">{candidateStats.conflicts}</div></div></div>
      </div>

      <div className="flex-1 px-6 pb-6 pt-4 overflow-hidden">
        <Tabs defaultValue="final" className="h-full flex flex-col min-h-0">
          <div className="flex items-center justify-between gap-3 flex-shrink-0">
            <TabsList className="w-fit">
              <TabsTrigger value="final">最终定义（{validDefinitions.length}）</TabsTrigger>
              <TabsTrigger value="candidates">AI 候选（{actionableCandidateCount}）</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="final" className="flex-1 flex flex-col mt-4 overflow-hidden min-h-0 data-[state=inactive]:hidden">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={finalSearch}
                  onChange={(e) => setFinalSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                  placeholder="搜索最终定义、来源文件..."
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={finalViewFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFinalViewFilter("all")}>全部</Badge>
                <Badge variant={finalViewFilter === "conflicts" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFinalViewFilter("conflicts")}>只看冲突</Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={filterType === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterType("all")}>类型：全部</Badge>
                {Object.entries(typeConfig).map(([key, config]) => <Badge key={key} variant={filterType === key ? "default" : "outline"} className="cursor-pointer" onClick={() => setFilterType(key as EntityType)}>{config.label}</Badge>)}
              </div>
            </div>

            <div className="flex-1 border border-border rounded-lg bg-card overflow-hidden">
              <ScrollArea className="h-full">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow>
                      <TableHead className="w-[140px] cursor-pointer select-none" onClick={() => handleFinalSort("shortName")}>
                        <span className="inline-flex items-center">简称{renderSortIndicator(finalSortKey === "shortName", finalSortDir)}</span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleFinalSort("fullName")}>
                        <span className="inline-flex items-center">全称{renderSortIndicator(finalSortKey === "fullName", finalSortDir)}</span>
                      </TableHead>
                      <TableHead className="w-[110px] cursor-pointer select-none" onClick={() => handleFinalSort("entityType")}>
                        <span className="inline-flex items-center">类型{renderSortIndicator(finalSortKey === "entityType", finalSortDir)}</span>
                      </TableHead>
                      <TableHead className="w-[240px]">来源证据</TableHead>
                      <TableHead className="w-[150px]">标记</TableHead>
                      <TableHead className="w-[80px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedDefinitions.map((definition) => {
                      const TypeIcon = typeConfig[definition.entityType].icon;
                      return (
                        <TableRow key={definition.id} className={cn(definition.hasConflict && "bg-amber-50/50")}>
                          <TableCell><div className="flex items-center gap-2"><span className="font-medium text-[13px]">“{definition.shortName}”</span>{definition.hasConflict ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" /> : null}</div></TableCell>
                          <TableCell className="text-[13px]">{definition.fullName}</TableCell>
                          <TableCell><Badge variant="secondary" className={cn("text-[10px]", typeConfig[definition.entityType].color)}><TypeIcon className="w-3 h-3 mr-1" />{typeConfig[definition.entityType].label}</Badge></TableCell>
                          <TableCell><SourceEvidence fileName={definition.sourceFileName} pageRef={definition.sourcePageRef} excerpt={definition.sourceExcerpt} confidence={definition.sourceTrace[0]?.confidence ?? null} /></TableCell>
                          <TableCell><div className="flex flex-wrap gap-2"><Badge variant="secondary" className={originConfig[definition.origin].className}>{originConfig[definition.origin].label}</Badge>{definition.hasConflict && definition.conflictWith ? <Badge variant="secondary" className="bg-amber-100 text-amber-700">与 {definition.conflictWith} 冲突</Badge> : null}</div></TableCell>
                          <TableCell className="text-right">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="h-8 w-8 p-0"><MoreVertical className="w-4 h-4" /></Button></DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEdit(definition)}><Edit2 className="w-4 h-4 mr-2" />编辑</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleDelete(definition.id)} className="text-destructive"><Trash2 className="w-4 h-4 mr-2" />删除</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
                {sortedDefinitions.length === 0 ? <div className="py-14 text-center text-muted-foreground text-sm">当前没有匹配的最终定义</div> : null}
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="candidates" className="flex-1 flex flex-col mt-4 overflow-hidden min-h-0 data-[state=inactive]:hidden">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
                  placeholder="搜索候选、来源片段..."
                  className="pl-9"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={candidateFilter === "all" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCandidateFilter("all")}>全部</Badge>
                <Badge variant={candidateFilter === "pending" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCandidateFilter("pending")}>待复核</Badge>
                <Badge variant={candidateFilter === "conflicts" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCandidateFilter("conflicts")}>只看冲突</Badge>
                <Badge variant={candidateFilter === "risky" ? "default" : "outline"} className="cursor-pointer" onClick={() => setCandidateFilter("risky")}>只看低质量</Badge>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 p-3 border border-border rounded-lg bg-muted/30 mb-4">
              <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <Sparkles className="w-4 h-4" />
                <span>已选 {selectedCandidateIds.length} 条候选</span>
                <span>当前可操作 {actionableCandidateCount} 条，当前可见 {visibleCandidateCount} 条。</span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => handleReject(selectedCandidateIds)} disabled={selectedCandidateIds.length === 0 || rejectMutation.isPending}>{rejectMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}批量拒绝</Button>
                <Button size="sm" onClick={() => handleApprove(selectedCandidateIds)} disabled={selectedCandidateIds.length === 0 || approveMutation.isPending} className="gap-2">{approveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}批量接受</Button>
              </div>
            </div>

            <div className="flex-1 border border-border rounded-lg bg-card overflow-hidden">
              <ScrollArea className="h-full">
                <table className="w-full caption-bottom text-sm">
                  <TableHeader className="sticky top-0 z-20 bg-card">
                    <TableRow>
                      <TableHead className="w-[44px]"><Checkbox checked={allSelectableChecked} onCheckedChange={(checked) => toggleAllSelectable(Boolean(checked))} /></TableHead>
                      <TableHead className="w-[130px] cursor-pointer select-none" onClick={() => handleCandidateSort("shortName")}>
                        <span className="inline-flex items-center">简称{renderSortIndicator(candidateSortKey === "shortName", candidateSortDir)}</span>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none" onClick={() => handleCandidateSort("fullName")}>
                        <span className="inline-flex items-center">全称{renderSortIndicator(candidateSortKey === "fullName", candidateSortDir)}</span>
                      </TableHead>
                      <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => handleCandidateSort("entityType")}>
                        <span className="inline-flex items-center">类型{renderSortIndicator(candidateSortKey === "entityType", candidateSortDir)}</span>
                      </TableHead>
                      <TableHead className="w-[220px]">来源证据</TableHead>
                      <TableHead className="w-[140px] cursor-pointer select-none" onClick={() => handleCandidateSort("status")}>
                        <span className="inline-flex items-center">状态{renderSortIndicator(candidateSortKey === "status", candidateSortDir)}</span>
                      </TableHead>
                      <TableHead className="w-[160px]">审核原因</TableHead>
                      <TableHead className="w-[140px] text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedCandidates.map((candidate) => {
                      const TypeIcon = typeConfig[candidate.entityType].icon;
                      const isSelected = selectedCandidateIds.includes(candidate.id);
                      const reviewLabel = candidate.reviewReason ? reviewReasonLabel[candidate.reviewReason] || candidate.reviewReason : null;
                      const isRisky = !candidate.sourceFileId || !candidate.sourceExcerpt || ((candidate.confidence ?? 0) > 0 && (candidate.confidence ?? 0) < 0.6);
                      return (
                        <TableRow key={candidate.id} className={cn(candidate.hasConflict && "bg-amber-50/50", isRisky && "bg-rose-50/40")}>
                          <TableCell><Checkbox checked={isSelected} disabled={candidate.status !== "pending_review"} onCheckedChange={(checked) => toggleCandidateSelection(candidate.id, Boolean(checked))} /></TableCell>
                          <TableCell className="font-medium text-[13px]">{candidate.shortName || <span className="text-muted-foreground">待补全</span>}</TableCell>
                          <TableCell className="text-[13px]">{candidate.fullName || <span className="text-muted-foreground">待补全</span>}</TableCell>
                          <TableCell><Badge variant="secondary" className={cn("text-[10px]", typeConfig[candidate.entityType].color)}><TypeIcon className="w-3 h-3 mr-1" />{typeConfig[candidate.entityType].label}</Badge></TableCell>
                          <TableCell><SourceEvidence fileName={candidate.sourceFileName} pageRef={candidate.sourcePageRef} excerpt={candidate.sourceExcerpt} confidence={candidate.confidence} /></TableCell>
                          <TableCell><div className="flex flex-col gap-2"><Badge variant="secondary" className={candidateStatusConfig[candidate.status].className}>{candidateStatusConfig[candidate.status].label}</Badge>{candidate.hasConflict ? <Badge variant="secondary" className="bg-amber-100 text-amber-700">冲突</Badge> : null}{isRisky ? <Badge variant="secondary" className="bg-rose-100 text-rose-700">低质量</Badge> : null}</div></TableCell>
                          <TableCell className="text-[12px] text-muted-foreground">{reviewLabel ? <span>{reviewLabel}</span> : <span>-</span>}{candidate.conflictWith ? <div className="text-amber-700 mt-1">关联：{candidate.conflictWith}</div> : null}</TableCell>
                          <TableCell className="text-right"><div className="flex justify-end gap-2"><Button variant="outline" size="sm" onClick={() => handleReject([candidate.id])} disabled={candidate.status !== "pending_review" || rejectMutation.isPending}>拒绝</Button><Button size="sm" onClick={() => handleApprove([candidate.id])} disabled={candidate.status !== "pending_review" || approveMutation.isPending}>接受</Button></div></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </table>
                {sortedCandidates.length === 0 ? <div className="py-14 text-center"><Sparkles className="w-10 h-10 text-muted-foreground mx-auto mb-3" /><p className="text-sm text-muted-foreground">当前没有匹配的 AI 候选</p></div> : null}
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <div className="px-6 py-4 border-t border-border bg-surface-subtle flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground"><CheckCircle2 className="w-4 h-4 text-primary" /><span>报告与导出只读取最终定义，不读取 AI 候选。</span></div>
          {definitionStats.manual > 0 ? <Badge variant="secondary">人工定义 {definitionStats.manual}</Badge> : null}
          {definitionStats.ai > 0 ? <Badge variant="secondary">AI 定义 {definitionStats.ai}</Badge> : null}
        </div>
        <Button onClick={() => navigate(`/project/${projectId}/mapping`)} className="gap-2">下一步：AI 智能分析<ArrowRight className="w-4 h-4" /></Button>
      </div>

      <EditDefinitionDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        definition={editingDefinition}
        files={files.map((file) => ({ id: file.id, originalName: file.originalName }))}
        onSave={handleSave}
        isSaving={createMutation.isPending || updateMutation.isPending}
      />

      {/* AI 重新提取确认弹窗 */}
      <Dialog open={reExtractConfirmOpen} onOpenChange={setReExtractConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认重新提取</DialogTitle>
            <DialogDescription>
              此操作将清除当前未处理的 AI 候选（待复核），并重新从数据室文件中提取。已接受或已拒绝的候选不会受到影响，最终定义表不受影响。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setReExtractConfirmOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleExtractConfirm}>确认重新提取</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
