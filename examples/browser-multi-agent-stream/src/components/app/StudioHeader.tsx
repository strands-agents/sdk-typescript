interface StudioHeaderProps {
  isHistoryView: boolean
  isRunDetailView: boolean
  isRunning: boolean
  workspaceView: 'compose' | 'output' | 'history'
  topBreadcrumb: string
  subtitle: string
  themeAppearance: 'dark' | 'light'
  onToggleTheme: () => void
  onOpenStudio: () => void
  onOpenHistory: () => void
  onBackToHistory: () => void
  onOpenLiveOutputOrCompose: () => void
  onSelectCompose: () => void
  onSelectOutput: () => void
}

export default function StudioHeader({
  isHistoryView,
  isRunDetailView,
  isRunning,
  workspaceView,
  topBreadcrumb,
  subtitle,
  themeAppearance,
  onToggleTheme,
  onOpenStudio,
  onOpenHistory,
  onBackToHistory,
  onOpenLiveOutputOrCompose,
  onSelectCompose,
  onSelectOutput,
}: StudioHeaderProps): JSX.Element {
  return (
    <header className="header">
      <div className="primary-nav">
        <div className="global-nav" role="navigation" aria-label="Primary Navigation">
          <button
            type="button"
            className={`global-nav-btn ${!isHistoryView ? 'active' : ''}`}
            onClick={onOpenStudio}
          >
            <span className="global-nav-icon" aria-hidden>
              <svg viewBox="0 0 16 16" focusable="false">
                <rect x="1.25" y="2" width="13.5" height="11.5" rx="2.2" />
                <path d="M5 5.2h6M5 8h4.2M5 10.8h2.8" />
              </svg>
            </span>
            <span>Studio</span>
          </button>
          <button
            type="button"
            className={`global-nav-btn ${isHistoryView ? 'active' : ''}`}
            onClick={onOpenHistory}
          >
            <span className="global-nav-icon" aria-hidden>
              <svg viewBox="0 0 16 16" focusable="false">
                <circle cx="8" cy="8" r="6.2" />
                <path d="M8 4.7v3.6l2.6 1.6" />
              </svg>
            </span>
            <span>History</span>
          </button>
        </div>
        <button type="button" className="theme-toggle" onClick={onToggleTheme}>
          {themeAppearance === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>
      </div>

      <div className="header-row">
        <div>
          {(!isHistoryView || isRunDetailView) && (
            <div className="workspace-breadcrumb">{topBreadcrumb}</div>
          )}
          <h1>Strands Agents Playground</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
      </div>

      {isHistoryView && isRunDetailView ? (
        <div className="review-context" role="region" aria-label="Review Context">
          <div className="review-context-meta">
            <span className="review-context-kicker">Review Workspace</span>
            <div className="review-context-breadcrumb">{topBreadcrumb}</div>
            <h2 className="review-context-title">Run Detail</h2>
            <p className="review-context-copy">
              Inspect persisted output, metrics, costs, and logs for this run.
            </p>
          </div>
          <div className="review-context-actions">
            <button type="button" className="secondary-btn" onClick={onBackToHistory}>
              Back to History
            </button>
            <button
              type="button"
              className="workspace-btn"
              onClick={onOpenLiveOutputOrCompose}
            >
              {isRunning ? 'Open Live Output' : 'Start New Run'}
            </button>
          </div>
        </div>
      ) : !isHistoryView ? (
        <div className="app-topnav" role="navigation" aria-label="Studio View">
          <button
            type="button"
            className={`app-topnav-btn ${workspaceView === 'compose' ? 'active' : ''}`}
            onClick={onSelectCompose}
          >
            Compose
          </button>
          <button
            type="button"
            className={`app-topnav-btn ${workspaceView === 'output' ? 'active' : ''}`}
            onClick={onSelectOutput}
          >
            Output
            {isRunning ? ' • Running' : ''}
          </button>
        </div>
      ) : null}
    </header>
  )
}
