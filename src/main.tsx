import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Editor error', error, info.componentStack) }
  render() {
    if (this.state.error) return <div className="error-boundary"><h1>Нужна короткая перезагрузка</h1><p>Последний сохранённый проект останется в этом браузере.</p><button onClick={() => location.reload()}>Вернуться в редактор</button></div>
    return this.props.children
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>)
