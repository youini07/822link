/**
 * [PlatformIcons.tsx]
 * 업로드 대상 플랫폼 아이콘 (네이버 밴드 'b' 로고 스타일)
 */

export function BandIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="120" height="120" rx="30" fill="#03C75A" />
      <path
        d="M38 22 h20 v34 c6 -8 15 -12 25 -12 c20 0 33 15 33 38 c0 23 -14 38 -35 38 c-10 0 -18 -4 -23 -11 v9 H38 Z M58 82 c0 12 7 20 17 20 c11 0 18 -9 18 -22 c0 -13 -7 -22 -18 -22 c-10 0 -17 8 -17 20 Z"
        fill="#0a0a0a"
        transform="translate(-8, 0) scale(0.95)"
      />
    </svg>
  );
}

/** 후르츠패밀리 로고 스타일 아이콘 (블랙 배경 + 화이트 fruiTS) */
export function FruitsIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="120" height="120" rx="24" fill="#0a0a0a" />
      <text
        x="60"
        y="72"
        textAnchor="middle"
        fill="#ffffff"
        fontSize="34"
        fontWeight="900"
        fontStyle="italic"
        fontFamily="'Arial Rounded MT Bold', 'Helvetica Rounded', Arial, sans-serif"
        letterSpacing="-2"
        transform="rotate(-4 60 60)"
      >
        fruits
      </text>
    </svg>
  );
}

export function DaangnIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <img 
      src="./daangn.png" 
      alt="당근마켓" 
      width={size} 
      height={size} 
      className={`rounded-full object-cover border border-slate-200/20 ${className}`}
    />
  );
}
