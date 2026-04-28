import { memo } from "react";

interface SparkProps {
  data: number[];
  color: string;
  h?: number;
  w?: number;
  fill?: boolean;
}

export const Sparkline = memo(function Sparkline({
  data,
  color,
  h = 20,
  w = 168,
  fill = true,
}: SparkProps) {
  if (!data || data.length < 2) return <div style={{ height: h, width: w }} />;
  const finite = data.map((v) => (Number.isFinite(v) ? v : 0));
  const max = Math.max(...finite, 0.001);
  const min = Math.min(...finite, 0);
  const range = max - min || 1;
  const pts = finite
    .map((v, i) => `${(i / (finite.length - 1)) * w},${h - ((v - min) / range) * (h - 2) - 1}`)
    .join(" ");
  const uid = `sp_${color.replace(/[^a-z0-9]/gi, "")}_${h}_${w}`;
  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {fill && <polygon points={`0,${h} ${pts} ${w},${h}`} fill={`url(#${uid})`} />}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" opacity="0.9" />
    </svg>
  );
});
