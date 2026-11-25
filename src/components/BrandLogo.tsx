export function BrandLogo({
  size = 34,
  variant = 'dark'
}: {
  size?: number;
  variant?: 'dark' | 'light';
}) {
  const strokeMain = variant === 'light' ? '#FFFFFF' : '#0F172A';
  const fillAccent = '#2563EB';
  const fillMuted = variant === 'light' ? 'rgba(255,255,255,0.18)' : '#E2E8F0';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2" y="2" width="32" height="32" rx="7" stroke={strokeMain} strokeWidth="2" />
      <rect x="7" y="8" width="9" height="5" rx="1.5" fill={fillAccent} />
      <rect x="20" y="8" width="9" height="5" rx="1.5" fill={fillMuted} />
      <rect x="7" y="16" width="9" height="5" rx="1.5" fill={fillMuted} />
      <rect x="20" y="16" width="9" height="5" rx="1.5" fill={fillAccent} />
      <rect x="7" y="24" width="9" height="5" rx="1.5" fill={fillAccent} />
      <rect x="20" y="24" width="9" height="5" rx="1.5" fill={fillMuted} />
    </svg>
  );
}
