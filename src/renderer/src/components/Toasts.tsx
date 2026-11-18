import { CheckCircle2, Info, TriangleAlert } from 'lucide-react'
import type { Toast } from '../types/board'

export function Toasts({ toasts }: { toasts: Toast[] }): React.JSX.Element {
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={`toast glass ${t.kind}`}>
          {t.kind === 'success' ? (
            <CheckCircle2 size={16} />
          ) : t.kind === 'error' ? (
            <TriangleAlert size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
