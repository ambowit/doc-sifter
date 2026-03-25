import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { ClassifyProgressState } from "@/hooks/useFiles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  Pause,
  Play,
  X,
  FileText,
  Sparkles,
} from "lucide-react";

interface AIClassifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  progress: ClassifyProgressState;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onReset: () => void;
  fileCount: number;
}

export function AIClassifyDialog({
  open,
  onOpenChange,
  progress,
  onStart,
  onPause,
  onResume,
  onCancel,
  onReset,
  fileCount,
}: AIClassifyDialogProps) {
  const { isRunning, isPaused, total, current, currentFileName, completed, failed, results } = progress;

  const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;
  const isComplete = !isRunning && total > 0 && current === total;
  const hasStarted = total > 0;

  // 任务完成后自动关闭（延迟 2 秒）
  useEffect(() => {
    if (isComplete && !isPaused) {
      const timer = setTimeout(() => {
        onOpenChange(false);
        onReset();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [isComplete, isPaused, onOpenChange, onReset]);

  const handleClose = () => {
    if (isRunning) {
      onCancel();
    }
    onOpenChange(false);
    if (!isRunning) {
      onReset();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-primary" />
            AI 智能分类
          </DialogTitle>
          <DialogDescription>
            {!hasStarted
              ? `将对 ${fileCount} 个文件进行智能分类`
              : isComplete
              ? "分类完成"
              : isPaused
              ? "已暂停"
              : "正在分析文件..."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 未开始状态 */}
          {!hasStarted && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Sparkles className="w-8 h-8 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                AI 将根据文件名和内容自动匹配到对应章节
              </p>
              <Button onClick={onStart} className="gap-2">
                <Brain className="w-4 h-4" />
                开始分析
              </Button>
            </div>
          )}

          {/* 进行中/完成状态 */}
          {hasStarted && (
            <>
              {/* 进度条 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">进度</span>
                  <span className="font-medium">
                    {current} / {total}
                  </span>
                </div>
                <Progress value={progressPercent} className="h-2" />
              </div>

              {/* 当前处理文件 */}
              {isRunning && currentFileName && (
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
                  <Loader2 className="w-4 h-4 text-primary animate-spin flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-muted-foreground">正在分析</div>
                    <div className="text-sm font-medium truncate">{currentFileName}</div>
                  </div>
                </div>
              )}

              {/* 统计信息 */}
              <div className="flex items-center justify-center gap-6">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-sm font-medium">{completed}</span>
                  <span className="text-xs text-muted-foreground">成功</span>
                </div>
                {failed > 0 && (
                  <div className="flex items-center gap-1.5">
                    <XCircle className="w-4 h-4 text-red-500" />
                    <span className="text-sm font-medium">{failed}</span>
                    <span className="text-xs text-muted-foreground">失败</span>
                  </div>
                )}
              </div>

              {/* 结果列表（滚动） */}
              {results.length > 0 && (
                <ScrollArea className="h-[200px] border rounded-lg">
                  <div className="p-2 space-y-1">
                    {results.map((result, idx) => (
                      <div
                        key={result.fileId}
                        className={cn(
                          "flex items-center gap-2 px-2 py-1.5 rounded text-sm",
                          result.success ? "bg-emerald-50" : "bg-red-50"
                        )}
                      >
                        <span className="text-xs text-muted-foreground w-5">{idx + 1}</span>
                        {result.success ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                        )}
                        <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate flex-1 min-w-0">{result.fileName}</span>
                        {result.success && result.chapterId && (
                          <Badge variant="secondary" className="text-[10px] h-5 flex-shrink-0">
                            已分类
                          </Badge>
                        )}
                        {result.success && !result.chapterId && (
                          <Badge variant="outline" className="text-[10px] h-5 flex-shrink-0 text-muted-foreground">
                            未匹配
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-end gap-2 pt-2">
                {isRunning && !isPaused && (
                  <>
                    <Button variant="outline" size="sm" onClick={onPause} className="gap-1.5">
                      <Pause className="w-3.5 h-3.5" />
                      暂停
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onCancel} className="gap-1.5">
                      <X className="w-3.5 h-3.5" />
                      取消
                    </Button>
                  </>
                )}
                {isRunning && isPaused && (
                  <>
                    <Button variant="outline" size="sm" onClick={onResume} className="gap-1.5">
                      <Play className="w-3.5 h-3.5" />
                      继续
                    </Button>
                    <Button variant="destructive" size="sm" onClick={onCancel} className="gap-1.5">
                      <X className="w-3.5 h-3.5" />
                      取消
                    </Button>
                  </>
                )}
                {isComplete && (
                  <Button size="sm" onClick={handleClose} className="gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    完成
                  </Button>
                )}
              </div>

              {/* 完成提示 */}
              {isComplete && (
                <div className="text-center text-sm text-emerald-600 bg-emerald-50 rounded-lg py-2">
                  分类完成！{completed} 个文件已处理
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
