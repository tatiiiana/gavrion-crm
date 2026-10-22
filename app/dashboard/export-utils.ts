"use client";

export type ExportColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => unknown;
};

function escapeCsv(value: unknown) {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Descarga los registros visibles en un CSV UTF-8 compatible con Excel y Sheets. */
export function downloadCsv<T>(filename: string, rows: T[], columns: ExportColumn<T>[]) {
  const header = columns.map(column => escapeCsv(column.label)).join(",");
  const body = rows.map(row => columns.map(column => escapeCsv(column.value(row))).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${header}\r\n${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${filename.replace(/[^a-z0-9_-]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function textValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
