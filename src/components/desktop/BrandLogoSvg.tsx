interface BrandLogoSvgProps {
  className?: string;
  color?: string;
}

export default function BrandLogoSvg({ className = "w-10 h-8", color = "#B5D350" }: BrandLogoSvgProps) {
  return (
    <svg viewBox="0 0 82 40" className={className} preserveAspectRatio="xMidYMid meet">
      {/* Play triangle (left icon) */}
      <polygon points="2,12 14,20 2,28" fill={color} />
      {/* Geometric K - upper polygon (stem + upper arm) */}
      <polygon points="26,0 62,0 36,20 26,40" fill={color} />
      {/* Geometric K - lower triangle (lower leg) */}
      <polygon points="42,24 62,40 42,40" fill={color} />
    </svg>
  );
}
