
export function BandLogo({ size = 24, className = "" }: { size?: number, className?: string }) {
  return (
    <svg 
      width={size} 
      height={size} 
      viewBox="0 0 120 120" 
      fill="none" 
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="bandAdminGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#34d399" /> {/* Tailwind emerald-400 */}
          <stop offset="100%" stopColor="#16a34a" /> {/* Tailwind green-600 */}
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Background Rounded Square */}
      <rect width="120" height="120" rx="28" fill="url(#bandAdminGradient)" />
      
      {/* Chat Bubble (Symbolizing Band/Community) */}
      <path 
        d="M60 26 C41.2 26 26 41.2 26 60 C26 71 31.2 80.8 39 86.8 L39 100 L50.5 93.3 C53.5 93.8 56.7 94 60 94 C78.8 94 94 78.8 94 60 C94 41.2 78.8 26 60 26 Z" 
        fill="#ffffff" 
        fillOpacity="0.2" 
      />

      <g filter="url(#glow)">
        {/* Antenna */}
        <line x1="60" y1="44" x2="60" y2="34" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="30" r="4" fill="#ffffff" />
        
        {/* Ears */}
        <line x1="38" y1="60" x2="32" y2="60" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
        <line x1="82" y1="60" x2="88" y2="60" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
        
        {/* Bot Face Base */}
        <rect x="38" y="44" width="44" height="32" rx="10" fill="#ffffff" />
        
        {/* Bot Eyes */}
        <circle cx="48" cy="56" r="4" fill="#16a34a" />
        <circle cx="72" cy="56" r="4" fill="#16a34a" />
        
        {/* Bot Mouth */}
        <path d="M52 66 C 55 69, 65 69, 68 66" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}
