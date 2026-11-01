/**
 * 底部悬浮图例：节点/连线颜色语义说明（04 §4.5）。
 */
export function GraphLegend(): JSX.Element {
  return (
    <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[#E2E8F0] bg-white/90 px-3 py-2 text-[11px] text-[#334155] shadow-card">
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-full bg-[#4F46E5]" /> 设备
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-3 w-3 rounded-sm bg-[#7C3AED]" /> Agent
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0 w-0 border-l-[6px] border-r-[6px] border-b-[10px] border-l-transparent border-r-transparent border-b-[#0891B2]" /> 任务
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-[#0891B2]" /> 消息流
      </span>
      <span className="h-3 w-px bg-[#E2E8F0]" />
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 bg-[#4F46E5]" /> 调用
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#10B981]" /> 返回
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#0891B2]" /> 流式
      </span>
    </div>
  );
}
