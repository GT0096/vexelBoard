import React, { useState } from 'react'
import { Download, FileText, Image as ImageIcon, Code2, X } from 'lucide-react'
import type { BoardState, ThemeId } from '../types/board'
import { downloadPdf, downloadImage, downloadSvg } from '../board/exportUtils'

interface ExportModalProps {
  isOpen: boolean
  onClose: () => void
  board: BoardState
  themeId: ThemeId
  backgroundColor?: string
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onToast: (kind: 'info' | 'success' | 'error', msg: string) => void
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  board,
  themeId,
  backgroundColor,
  canvasRef,
  onToast
}) => {
  const [downloading, setDownloading] = useState<string | null>(null)

  if (!isOpen) return null

  const handleExportSvg = async (): Promise<void> => {
    try {
      setDownloading('svg')
      await downloadSvg(board, themeId, backgroundColor)
      onToast('success', 'Notes exported to SVG successfully')
      onClose()
    } catch (err) {
      onToast('error', `SVG export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  const handleExportImage = async (format: 'png' | 'jpeg'): Promise<void> => {
    if (!canvasRef.current) {
      onToast('error', 'Canvas reference not ready')
      return
    }
    try {
      setDownloading(format)
      await downloadImage(canvasRef.current, board, themeId, format, backgroundColor)
      onToast('success', `Notes exported to ${format.toUpperCase()} successfully`)
      onClose()
    } catch (err) {
      onToast('error', `Image export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  const handleExportPdf = async (): Promise<void> => {
    if (!canvasRef.current) {
      onToast('error', 'Canvas reference not ready')
      return
    }
    try {
      setDownloading('pdf')
      await downloadPdf(canvasRef.current, board, themeId)
      onToast('success', 'PDF export initiated')
      onClose()
    } catch (err) {
      onToast('error', `PDF export failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-wrap">
            <Download size={20} className="text-accent" />
            <h2>Export & Download Notes</h2>
          </div>
          <button className="icon-btn-ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p className="modal-subtitle">
          Export your complete whiteboard diagram, typed notes, and LaTeX math formulas.
        </p>

        <div className="export-options-grid">
          {/* PDF Option */}
          <div className="export-card" onClick={handleExportPdf}>
            <div className="export-card-icon pdf">
              <FileText size={26} />
            </div>
            <div className="export-card-content">
              <h3>PDF Document</h3>
              <p>Publication-ready document containing all notes, diagrams, and equations.</p>
              <span className="export-badge">Best for Sharing & Printing</span>
            </div>
            <button className="export-btn" disabled={downloading === 'pdf'}>
              {downloading === 'pdf' ? 'Exporting...' : 'Download PDF'}
            </button>
          </div>

          {/* PNG / JPEG Image Option */}
          <div className="export-card" onClick={() => handleExportImage('png')}>
            <div className="export-card-icon img">
              <ImageIcon size={26} />
            </div>
            <div className="export-card-content">
              <h3>High-Res Image (PNG)</h3>
              <p>Crisp image snapshot of your canvas layout, diagrams, and cards.</p>
              <span className="export-badge">Best for Presentations</span>
            </div>
            <button className="export-btn" disabled={downloading === 'png'}>
              {downloading === 'png' ? 'Exporting...' : 'Download PNG'}
            </button>
          </div>

          {/* SVG Vector Option */}
          <div className="export-card" onClick={handleExportSvg}>
            <div className="export-card-icon svg">
              <Code2 size={26} />
            </div>
            <div className="export-card-content">
              <h3>Scalable Vector (SVG)</h3>
              <p>Infinitely scalable vector format compatible with Figma, Illustrator, or web.</p>
              <span className="export-badge">Best for Designers & Editing</span>
            </div>
            <button className="export-btn" disabled={downloading === 'svg'}>
              {downloading === 'svg' ? 'Exporting...' : 'Download SVG'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
