import { cn } from "@/lib/utils";

interface DefinitionItem {
  name: string;
  shortName: string;
  description?: string;
}

interface DefinitionsTableProps {
  data: DefinitionItem[];
  className?: string;
}

export function DefinitionsTable({ data, className }: DefinitionsTableProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("p-8 text-center text-muted-foreground", className)}>
        暂无定义数据
      </div>
    );
  }

  return (
    <div className={cn("py-8", className)}>
      {/* Title */}
      <h2 className="text-xl font-bold text-center mb-6">定义</h2>
      
      <p className="text-[13px] text-foreground/80 mb-4">本报告涉及的简称如下：</p>
      
      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse border border-border text-[13px]">
          <thead>
            <tr className="bg-muted/50">
              <th className="border border-border p-3 w-16 text-center font-semibold">序号</th>
              <th className="border border-border p-3 text-center font-semibold">名称</th>
              <th className="border border-border p-3 w-40 text-center font-semibold">简称</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item, idx) => (
              <tr key={idx} className="hover:bg-muted/20">
                <td className="border border-border p-3 text-center">{idx + 1}.</td>
                <td className="border border-border p-3 text-center">{item.name}</td>
                <td className="border border-border p-3 text-center">{item.shortName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default DefinitionsTable;
