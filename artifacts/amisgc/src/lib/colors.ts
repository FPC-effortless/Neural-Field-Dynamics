// Color palette ported from NSF v11.0 visual design
export const SCLR: Record<string, string> = {
  healthy: "#0b3d3a",
  stressed: "#3d2800",
  atrophied: "#1a0a20",
  alarming: "#dfffff",
  refractory: "#28104a",
  drifted: "#7a3d00",
};
export const SGLOW: Record<string, string> = {
  alarming: "rgba(0,255,200,0.95)",
  refractory: "rgba(140,50,255,0.6)",
  stressed: "rgba(180,80,0,0.4)",
  atrophied: "rgba(80,20,100,0.5)",
  drifted: "rgba(255,144,0,0.6)",
};
export const STATE_LABEL_COLOR: Record<string, string> = {
  healthy: "#0d7060",
  stressed: "#cc6600",
  atrophied: "#884488",
  alarming: "#00ffc4",
  refractory: "#8833ff",
  drifted: "#ff9900",
};
export const PCOL: Record<string, string> = {
  DISORDERED: "#334455",
  PREDICTIVE: "#ff9900",
  ATTENTIVE: "#aa88ff",
  CONSCIOUS: "#00ffc4",
  OBSESSIVE: "#ff4488",
  EMBODIED: "#44ffcc",
};
export const TKCOL: Record<string, string> = {
  COPY: "#00ffc4",
  REVERSE: "#ff9900",
  ROTATE: "#aa88ff",
  ALTERNATE: "#4499ff",
  NOVEL: "#ff4488",
  ROTATE2: "#7c5fff",
  RANDOM: "#999999",
};
export const PHCOL: Record<string, string> = {
  P8: "#aa88ff",
  PE: "#ffb040",
  PX: "#ff4488",
  P7: "#4499ff",
  P9: "#22cc88",
  P10: "#ff66cc",
  P11: "#66ccff",
  P12: "#ffcc44",
  C1: "#0d7060",
  C2: "#33aa99",
  C4: "#aa88ff",
  ARC: "#ffcc44",
};

export function lerp3(t: number, c0: number[], c1: number[], c2: number[]): number[] {
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const av = t < 0.5 ? c0 : c1;
  const bv = t < 0.5 ? c1 : c2;
  return [
    (av[0] as number) + u * ((bv[0] as number) - (av[0] as number)),
    (av[1] as number) + u * ((bv[1] as number) - (av[1] as number)),
    (av[2] as number) + u * ((bv[2] as number) - (av[2] as number)),
  ];
}
export function clamp(v: number, lo = 0, hi = 1): number {
  return v < lo ? lo : v > hi ? hi : v;
}
