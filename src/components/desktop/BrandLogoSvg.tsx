interface BrandLogoSvgProps {
  className?: string;
  color?: string;
}

export default function BrandLogoSvg({ className = "h-16" }: BrandLogoSvgProps) {
  return (
    <img 
      src="/images/logo.png" 
      alt="OOOK Logo" 
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
