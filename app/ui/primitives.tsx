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
