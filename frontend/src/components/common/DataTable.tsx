import type { ReactNode } from 'react';

/**
 * 轻量数据表格：表头 bg-subtle、行高 48px、悬停高亮。
 */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  width?: string;
}

export function DataTable<T extends { taskId?: string; deviceId?: string }>({
  columns,
  rows,
  rowKey,
  onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
}): ReactNode {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-[#F8FAFC] text-left text-xs text-[#64748B]">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-2 font-medium" style={{ width: c.width }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-[#94A3B8]">
                暂无数据
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className="cursor-pointer border-t border-[#E2E8F0] transition-colors hover:bg-[#F8FAFC]"
                style={{ height: 48 }}
              >
                {columns.map((c) => (
                  <td key={c.key} className="px-4 py-2 text-[#334155]">
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
