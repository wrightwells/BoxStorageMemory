export function BoxIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      fill="#ffdc83"
      stroke="#b98019"
      strokeWidth="2.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 17 32 4l27 13v30L32 60 5 47z" />
      <path d="m5 17 27 13 27-13 M32 30v30" />
      <path d="m20 10 27 13v12l-9 4V27L11 14" fill="#f4bf55" />
    </svg>
  );
}
