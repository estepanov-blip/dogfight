export function Crown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 44" aria-hidden>
      <path
        d="M4 14 L18 26 L32 4 L46 26 L60 14 L54 40 L10 40 Z"
        fill="#f5c021"
        stroke="#1a1206"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="4" r="3.5" fill="#f5c021" stroke="#1a1206" strokeWidth="2.5" />
      <circle cx="4" cy="14" r="3" fill="#f5c021" stroke="#1a1206" strokeWidth="2.5" />
      <circle cx="60" cy="14" r="3" fill="#f5c021" stroke="#1a1206" strokeWidth="2.5" />
    </svg>
  );
}
