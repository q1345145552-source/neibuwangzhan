import * as XLSX from "xlsx";

export interface ExportColumn<T = any> {
  header: string;
  key?: keyof T;
  render?: (row: T) => string;
  width?: number;
}

export function exportToExcel<T extends Record<string, any>>(
  data: T[],
  columns: ExportColumn<T>[],
  filename: string
) {
  const rows = data.map((row) => {
    const obj: Record<string, string> = {};
    columns.forEach((col) => {
      const key = (col.key as string) || col.header;
      obj[col.header] = col.render ? col.render(row) : String(row[col.key as string] ?? "");
    });
    return obj;
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  if (columns.some((c) => c.width)) {
    ws["!cols"] = columns.map((c) => ({ wch: c.width || 15 }));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
