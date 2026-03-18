export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar-logo">
        <span>DAC</span> Tracker
      </span>
      <div className="titlebar-controls">
        <button
          className="titlebar-btn"
          onClick={() => window.windowControls.minimize()}
          aria-label="Minimize"
        >
          <svg width="10" height="1" viewBox="0 0 10 1">
            <rect width="10" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          className="titlebar-btn"
          onClick={() => window.windowControls.maximize()}
          aria-label="Maximize"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={() => window.windowControls.close()}
          aria-label="Close"
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" />
            <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
