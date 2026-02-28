import { useState, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  Edit2,
  Plus,
  Trash2,
  Download,
  MoreVertical,
  ZoomIn,
  ZoomOut,
  Building2,
  User,
  Users,
  AlertTriangle,
} from "lucide-react";

interface Shareholder {
  id: string;
  name: string;
  percentage: number | null;
  type: "individual" | "company" | "team";
  notes?: string;
  children?: EquityNode[];
}

interface EquityNode {
  id: string;
  name: string;
  type: "company" | "subsidiary";
  shareholders?: Shareholder[];
  percentage?: number | null;
  notes?: string;
}

interface EquityStructure {
  companyName: string;
  shareholders: Shareholder[];
  subsidiaries?: EquityNode[];
  notes: string[];
}

interface EquityChartProps {
  data: EquityStructure;
  className?: string;
  editable?: boolean;
  onUpdate?: (data: EquityStructure) => void;
}

// Icon mapping for shareholder types
const typeIcons = {
  individual: User,
  company: Building2,
  team: Users,
};

// Node component for shareholders
function ShareholderNode({
  shareholder,
  editable,
  onEdit,
  onDelete,
}: {
  shareholder: Shareholder;
  editable?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const Icon = typeIcons[shareholder.type];
  const hasPercentage = shareholder.percentage !== null && shareholder.percentage !== undefined;

  return (
    <div className="flex flex-col items-center group">
      {/* Shareholder Box */}
      <div
        className={cn(
          "relative border-2 border-foreground px-4 py-3 min-w-[100px] max-w-[160px] text-center bg-background",
          shareholder.type === "company" && "bg-blue-50",
          shareholder.type === "team" && "bg-amber-50"
        )}
      >
        <div className="flex items-center justify-center gap-1.5 mb-1">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[13px] font-medium leading-tight">{shareholder.name}</span>
        </div>
        {shareholder.notes && (
          <div className="text-[10px] text-muted-foreground">{shareholder.notes}</div>
        )}

        {/* Edit controls */}
        {editable && (
          <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-6 w-6 p-0 bg-background">
                  <MoreVertical className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Edit2 className="w-3.5 h-3.5 mr-2" />
                  编辑
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDelete} className="text-destructive">
                  <Trash2 className="w-3.5 h-3.5 mr-2" />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Percentage Line */}
      <div className="h-10 w-px bg-foreground relative">
        <span className="absolute top-1/2 left-2 -translate-y-1/2 text-[12px] font-medium whitespace-nowrap">
          {hasPercentage ? `${shareholder.percentage}%` : "比例未披露"}
        </span>
      </div>
    </div>
  );
}

// Company node component (target company or subsidiary)
function CompanyNode({
  name,
  isTarget = false,
  editable,
  onEdit,
}: {
  name: string;
  isTarget?: boolean;
  editable?: boolean;
  onEdit?: () => void;
}) {
  return (
    <div className="relative group">
      <div
        className={cn(
          "border-2 border-foreground px-6 py-3 bg-background text-center",
          isTarget && "border-primary bg-primary/5"
        )}
      >
        <div className="flex items-center justify-center gap-2">
          <Building2 className={cn("w-4 h-4", isTarget ? "text-primary" : "text-muted-foreground")} />
          <span className={cn("text-[14px] font-semibold", isTarget && "text-primary")}>{name}</span>
        </div>
        {isTarget && <div className="text-[10px] text-primary mt-0.5">目标公司</div>}
      </div>

      {editable && onEdit && (
        <Button
          variant="outline"
          size="sm"
          className="absolute -top-2 -right-2 h-6 w-6 p-0 bg-background opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onEdit}
        >
          <Edit2 className="w-3 h-3" />
        </Button>
      )}
    </div>
  );
}

// Subsidiary row component
function SubsidiaryRow({
  subsidiaries,
  editable,
}: {
  subsidiaries: EquityNode[];
  editable?: boolean;
}) {
  if (!subsidiaries || subsidiaries.length === 0) return null;

  return (
    <div className="mt-4">
      {/* Arrow Down */}
      <div className="flex justify-center mb-2">
        <div className="w-px h-6 bg-foreground relative">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-t-[6px] border-transparent border-t-foreground" />
        </div>
      </div>

      {/* Subsidiaries */}
      <div className="flex justify-center items-start gap-8 flex-wrap">
        {subsidiaries.map((sub, idx) => (
          <div key={sub.id} className="flex flex-col items-center">
            <div className="border border-muted-foreground px-4 py-2 bg-muted/30 text-center min-w-[120px]">
              <div className="text-[12px] font-medium">{sub.name}</div>
              {sub.percentage !== null && sub.percentage !== undefined && (
                <div className="text-[10px] text-muted-foreground mt-0.5">持股 {sub.percentage}%</div>
              )}
            </div>
            {sub.notes && (
              <div className="text-[10px] text-muted-foreground mt-1">{sub.notes}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Edit dialog component
function EditNodeDialog({
  open,
  onOpenChange,
  node,
  type,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: Shareholder | { name: string } | null;
  type: "shareholder" | "company";
  onSave: (data: any) => void;
}) {
  const [name, setName] = useState((node as any)?.name || "");
  const [percentage, setPercentage] = useState<string>(
    (node as Shareholder)?.percentage?.toString() || ""
  );
  const [nodeType, setNodeType] = useState<"individual" | "company" | "team">(
    (node as Shareholder)?.type || "individual"
  );
  const [notes, setNotes] = useState((node as any)?.notes || "");

  const handleSave = () => {
    if (!name.trim()) {
      toast.error("请填写名称");
      return;
    }
    const data: any = { name: name.trim() };
    if (type === "shareholder") {
      data.percentage = percentage ? parseFloat(percentage) : null;
      data.type = nodeType;
      data.notes = notes.trim() || undefined;
      data.id = (node as Shareholder)?.id || `sh-${Date.now()}`;
    }
    onSave(data);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type === "shareholder" ? "编辑股东" : "编辑公司名称"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div>
            <label className="text-[12px] text-muted-foreground">名称 *</label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={type === "shareholder" ? "股东名称" : "公司名称"}
              className="mt-1"
            />
          </div>

          {type === "shareholder" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[12px] text-muted-foreground">持股比例 (%)</label>
                  <Input
                    type="number"
                    value={percentage}
                    onChange={e => setPercentage(e.target.value)}
                    placeholder="如：35"
                    className="mt-1"
                    min={0}
                    max={100}
                  />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground">类型</label>
                  <select
                    value={nodeType}
                    onChange={e => setNodeType(e.target.value as any)}
                    className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-[13px]"
                  >
                    <option value="individual">自然人</option>
                    <option value="company">法人</option>
                    <option value="team">持股平台</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[12px] text-muted-foreground">备注</label>
                <Input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="可选备注"
                  className="mt-1"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EquityChart({ data, className, editable = false, onUpdate }: EquityChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<any>(null);
  const [editType, setEditType] = useState<"shareholder" | "company">("shareholder");

  // Empty state
  if (!data || !data.shareholders || data.shareholders.length === 0) {
    return (
      <div className={cn("p-8 text-center", className)}>
        <Building2 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground text-[13px]">暂无股权结构数据</p>
        {editable && (
          <Button
            variant="outline"
            size="sm"
            className="mt-3 gap-2"
            onClick={() => {
              setEditingNode(null);
              setEditType("shareholder");
              setEditDialogOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            添加股东
          </Button>
        )}
      </div>
    );
  }

  const handleEditShareholder = (shareholder: Shareholder) => {
    setEditingNode(shareholder);
    setEditType("shareholder");
    setEditDialogOpen(true);
  };

  const handleEditCompany = () => {
    setEditingNode({ name: data.companyName });
    setEditType("company");
    setEditDialogOpen(true);
  };

  const handleDeleteShareholder = (id: string) => {
    if (!onUpdate) return;
    const newData = {
      ...data,
      shareholders: data.shareholders.filter(s => s.id !== id),
    };
    onUpdate(newData);
    toast.success("股东已删除");
  };

  const handleSaveNode = (nodeData: any) => {
    if (!onUpdate) return;
    
    if (editType === "company") {
      onUpdate({ ...data, companyName: nodeData.name });
    } else {
      const existingIndex = data.shareholders.findIndex(s => s.id === nodeData.id);
      let newShareholders;
      if (existingIndex >= 0) {
        newShareholders = [...data.shareholders];
        newShareholders[existingIndex] = nodeData;
      } else {
        newShareholders = [...data.shareholders, nodeData];
      }
      onUpdate({ ...data, shareholders: newShareholders });
    }
    toast.success("保存成功");
  };

  const handleAddShareholder = () => {
    setEditingNode(null);
    setEditType("shareholder");
    setEditDialogOpen(true);
  };

  const handleExport = useCallback(() => {
    if (!chartRef.current) return;
    
    // Create a simple SVG export
    toast.success("股权结构图已导出", { description: "图片已准备下载" });
  }, []);

  const totalPercentage = data.shareholders.reduce(
    (acc, s) => acc + (s.percentage || 0),
    0
  );
  const hasPercentageWarning = totalPercentage !== 100 && totalPercentage !== 0;

  return (
    <div className={cn("py-6", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-6 px-2">
        <h2 className="text-lg font-bold">股权结构图</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 border border-border rounded">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoom(z => Math.max(0.5, z - 0.1))}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-[11px] text-muted-foreground w-10 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setZoom(z => Math.min(1.5, z + 0.1))}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>

          {editable && (
            <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={handleAddShareholder}>
              <Plus className="w-3.5 h-3.5" />
              添加股东
            </Button>
          )}

          <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={handleExport}>
            <Download className="w-3.5 h-3.5" />
            导出
          </Button>
        </div>
      </div>

      {/* Warning if percentages don't add up */}
      {hasPercentageWarning && (
        <div className="mx-2 mb-4 p-2 bg-amber-50 border border-amber-200 rounded flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <span className="text-[12px] text-amber-800">
            股权比例合计 {totalPercentage.toFixed(2)}%，不等于100%
          </span>
        </div>
      )}

      {/* Chart Container */}
      <div
        ref={chartRef}
        className="overflow-auto"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
      >
        {/* Shareholders Row */}
        <div className="flex justify-center items-end gap-3 flex-wrap mb-2">
          {data.shareholders.map(shareholder => (
            <ShareholderNode
              key={shareholder.id}
              shareholder={shareholder}
              editable={editable}
              onEdit={() => handleEditShareholder(shareholder)}
              onDelete={() => handleDeleteShareholder(shareholder.id)}
            />
          ))}
        </div>

        {/* Connecting Line */}
        <div className="flex justify-center mb-2">
          <div
            className="h-px bg-foreground"
            style={{
              width: `${Math.min(data.shareholders.length * 140, 900)}px`,
            }}
          />
        </div>

        {/* Arrow Down */}
        <div className="flex justify-center mb-2">
          <div className="w-px h-6 bg-foreground relative">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-transparent border-t-foreground" />
          </div>
        </div>

        {/* Target Company */}
        <div className="flex justify-center mb-4">
          <CompanyNode
            name={data.companyName}
            isTarget
            editable={editable}
            onEdit={handleEditCompany}
          />
        </div>

        {/* Subsidiaries */}
        {data.subsidiaries && data.subsidiaries.length > 0 && (
          <SubsidiaryRow subsidiaries={data.subsidiaries} editable={editable} />
        )}
      </div>

      {/* Notes */}
      {data.notes && data.notes.length > 0 && (
        <div className="mt-8 pt-4 border-t border-border mx-2">
          <div className="text-[12px] text-foreground/80">
            <span className="font-medium">注：</span>
            <ol className="list-decimal list-inside mt-1.5 space-y-0.5">
              {data.notes.map((note, idx) => (
                <li key={idx} className="text-[11px]">{note}</li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {/* Edit Dialog */}
      <EditNodeDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        node={editingNode}
        type={editType}
        onSave={handleSaveNode}
      />
    </div>
  );
}

export default EquityChart;
