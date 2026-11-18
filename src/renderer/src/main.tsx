import 'katex/dist/katex.min.css'
import './styles.css'

import React, { Component, type ReactNode, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DetachedChatApp } from './components/DetachedChatApp'

const isDetachedChat =
  window.location.search.includes('detached') ||
  window.location.hash.includes('detached')

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('Whiteboard ErrorBoundary caught an error:', error, errorInfo)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            background: '#FFFDF7',
            color: '#111111',
            fontFamily: 'system-ui, sans-serif',
            padding: 24,
            textAlign: 'center'
          }}
        >
          <h2 style={{ color: '#FF5E5B', marginBottom: 12, fontWeight: 800 }}>Whiteboard Recovery</h2>
          <p style={{ color: '#44403C', maxWidth: 500, marginBottom: 20 }}>
            {this.state.error?.message || 'A runtime error occurred in the whiteboard interface.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            style={{
              padding: '10px 20px',
              borderRadius: 10,
              background: '#FFE566',
              color: '#111111',
              fontWeight: 700,
              border: '2px solid #111111',
              boxShadow: '4px 4px 0 #111111',
              cursor: 'pointer'
            }}
          >
            Reload Whiteboard
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isDetachedChat ? <DetachedChatApp /> : <App />}
    </ErrorBoundary>
  </StrictMode>
)
