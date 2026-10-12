import { FileText } from 'lucide-react'

/** A page's emoji icon, or the default page glyph. */
export function PageIcon({ icon, size = 18, className }: { icon: string | null | undefined; size?: number; className?: string }) {
  if (icon) {
    return (
      <span className={`page-icon ${className ?? ''}`} style={{ fontSize: size * 0.95, width: size, height: size }} aria-hidden="true">
        {icon}
      </span>
    )
  }
  return (
    <span className={`page-icon is-default ${className ?? ''}`} style={{ width: size, height: size }} aria-hidden="true">
      <FileText size={size * 0.85} strokeWidth={1.6} />
    </span>
  )
}
