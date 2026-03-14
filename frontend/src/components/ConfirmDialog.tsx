import type { ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  children: ReactNode
  actions: ReactNode
}

export function ConfirmDialog({ title, children, actions }: ConfirmDialogProps) {
  return (
    <div className="confirm-overlay">
      <div className="confirm-dialog">
        <h3>{title}</h3>
        {children}
        <div className="form-actions">{actions}</div>
      </div>
    </div>
  )
}
