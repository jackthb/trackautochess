function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size}>
      <defs>
        <path id="bishop" d="M 256 52 C 240 52, 228 64, 228 80 C 228 90, 233 99, 241 104 L 220 160 C 190 170, 168 200, 168 236 C 168 260, 178 282, 196 296 L 180 340 C 170 348, 164 362, 164 376 L 164 392 L 148 392 C 140 392, 132 400, 132 408 L 132 440 C 132 448, 140 456, 148 456 L 364 456 C 372 456, 380 448, 380 440 L 380 408 C 380 400, 372 392, 364 392 L 348 392 L 348 376 C 348 362, 342 348, 332 340 L 316 296 C 334 282, 344 260, 344 236 C 344 200, 322 170, 292 160 L 271 104 C 279 99, 284 90, 284 80 C 284 64, 272 52, 256 52 Z"/>
        <clipPath id="clip-top"><polygon points="115,0 512,0 512,397"/></clipPath>
        <clipPath id="clip-mid"><polygon points="0,0 85,0 512,427 512,512 427,512 0,85"/></clipPath>
        <clipPath id="clip-bot"><polygon points="0,115 397,512 0,512"/></clipPath>
        <linearGradient id="red-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FF6046"/><stop offset="100%" stopColor="#E0402A"/>
        </linearGradient>
        <linearGradient id="red-grad-dark" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#CC3520"/><stop offset="100%" stopColor="#B02A18"/>
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="64" fill="#1B2838"/>
      <g clipPath="url(#clip-top)" transform="translate(5, -5)"><use href="#bishop" fill="url(#red-grad)"/></g>
      <g clipPath="url(#clip-mid)"><use href="#bishop" fill="url(#red-grad)"/></g>
      <g clipPath="url(#clip-bot)" transform="translate(-5, 5)"><use href="#bishop" fill="url(#red-grad-dark)"/></g>
    </svg>
  );
}

export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar-logo">
        <Logo size={18} />
        <span>Track</span> Auto Chess
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
