import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({ variant = "primary", size = "md", loading = false, className = "", children, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return <button {...props} className={`g-btn g-btn-${variant} g-btn-${size} ${loading ? "g-btn-loading" : ""} ${className}`.trim()} disabled={disabled || loading} aria-busy={loading || undefined}>{loading && <span className="g-spinner" aria-hidden="true" />}{children}</button>;
}

export function Card({ interactive = false, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { interactive?: boolean }) {
  return <article {...props} className={`g-card ${interactive ? "g-card-interactive" : ""} ${className}`.trim()}>{children}</article>;
}

export function CardHeader({ title, description, actions, className = "" }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return <div className={`g-card-header ${className}`.trim()}><div><h3 className="g-card-title">{title}</h3>{description && <p className="g-card-description">{description}</p>}</div>{actions && <div className="g-cluster">{actions}</div>}</div>;
}

export function Badge({ tone = "neutral", children, className = "" }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: ReactNode; className?: string }) {
  return <span className={`g-badge g-badge-${tone} ${className}`.trim()}>{children}</span>;
}

export function Field({ label, hint, error, children, className = "" }: { label: string; hint?: string; error?: string; children: ReactNode; className?: string }) {
  return <label className={`g-field ${className}`.trim()}><span className="g-label">{label}</span>{children}{error ? <span className="g-error" role="alert">{error}</span> : hint ? <span className="g-help">{hint}</span> : null}</label>;
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`g-input ${props.className || ""}`.trim()} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`g-select ${props.className || ""}`.trim()} />;
}

export function EmptyState({ icon = "○", title, description, action, className = "" }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode; className?: string }) {
  return <div className={`g-empty ${className}`.trim()}><span className="g-empty-icon" aria-hidden="true">{icon}</span><h3 className="g-empty-title">{title}</h3>{description && <p className="g-empty-description">{description}</p>}{action}</div>;
}

export function Skeleton({ variant = "line", className = "" }: { variant?: "title" | "line" | "short"; className?: string }) {
  const shape = variant === "title" ? "g-skeleton-title" : variant === "short" ? "g-skeleton-line-short" : "g-skeleton-line";
  return <span className={`g-skeleton ${shape} ${className}`.trim()} aria-hidden="true" />;
}

/** Paginación compacta y accesible para listados grandes. Las páginas son 1-based. */
export function Pagination({ page, pageSize, total, onPageChange, label = "Registros" }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void; label?: string }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const pages = Array.from(new Set([1, safePage - 1, safePage, safePage + 1, pageCount].filter(value => value >= 1 && value <= pageCount))).sort((a, b) => a - b);
  const visiblePages: Array<number | "ellipsis"> = [];
  pages.forEach((value, index) => { if (index > 0 && value - pages[index - 1] > 1) visiblePages.push("ellipsis"); visiblePages.push(value); });
  return <nav className="g-pagination" aria-label={`Paginación de ${label.toLowerCase()}`}>
    <span className="g-pagination-summary">{Math.min((safePage - 1) * pageSize + 1, total)}–{Math.min(safePage * pageSize, total)} de {total}</span>
    <div className="g-pagination-controls">
      <button type="button" className="g-pagination-button" disabled={safePage === 1} onClick={() => onPageChange(safePage - 1)} aria-label="Página anterior">←</button>
      {visiblePages.map((value, index) => value === "ellipsis" ? <span key={`ellipsis-${index}`} className="g-pagination-ellipsis">…</span> : <button type="button" key={value} className={`g-pagination-button ${value === safePage ? "active" : ""}`} aria-current={value === safePage ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</button>)}
      <button type="button" className="g-pagination-button" disabled={safePage === pageCount} onClick={() => onPageChange(safePage + 1)} aria-label="Página siguiente">→</button>
    </div>
  </nav>;
}
