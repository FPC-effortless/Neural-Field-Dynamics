import type { ReactNode, CSSProperties } from "react";

interface PanelProps {
  title?: string;
  accent?: string;
  tight?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

export function Panel({ title, accent, tight, children, style, className }: PanelProps) {
  return (
    <div
      className={`metric-card ${className ?? ""}`}
      style={{
        background: "#030f1a",
        border: `1px solid ${accent ?? "#0a2828"}`,
        borderRadius: 3,
        padding: tight ? 6 : 9,
        ...style,
      }}
    >
      {title && (
        <div
          style={{
            fontSize: 8,
            color: accent ?? "#0f4a3a",
            letterSpacing: 3,
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

interface MRProps {
  label: string;
  value: string | number;
  color?: string;
  sub?: string;
  w?: number;
}

export function MR({ label, value, color, sub, w = 86 }: MRProps) {
  return (
    <div className="flex items-baseline gap-1.5 mb-0.5">
      <span
        style={{
          fontSize: 7,
          color: "#1a3a30",
          width: w,
          flexShrink: 0,
          letterSpacing: 1,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: color ?? "#2a5a40",
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 6, color: "#1a3a30", marginLeft: 2 }}>{sub}</span>
      )}
    </div>
  );
}

export function Pill({
  children,
  color = "#0f4a3a",
  bg = "rgba(0,0,0,0.4)",
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 7px",
        background: bg,
        border: `1px solid ${color}`,
        color,
        fontSize: 8,
        letterSpacing: 1.5,
        borderRadius: 2,
      }}
    >
      {children}
    </span>
  );
}
