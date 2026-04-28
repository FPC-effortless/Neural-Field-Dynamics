import { useEffect, useRef, useState } from "react";
import {
  createSim,
  simTick,
  setTask,
  defaultParams,
  type SimState,
  type SimContext,
  type Params,
  type TaskKey,
} from "@workspace/amisgc-core";
import { SCLR, SGLOW, lerp3, clamp } from "../lib/colors";

export type ViewMode = "STATE" | "CONSCIOUS" | "ATTENTION" | "ENERGY" | "MI" | "HEALTH";
export const VIEW_MODES: ViewMode[] = [
  "STATE",
  "CONSCIOUS",
  "ATTENTION",
  "ENERGY",
  "MI",
  "HEALTH",
];
export const VIEW_LABEL: Record<ViewMode, string> = {
  STATE: "STATE",
  CONSCIOUS: "C_i ATTRACTOR",
  ATTENTION: "A_i ATTENTION",
  ENERGY: "FREE ENERGY",
  MI: "I(X;Y)",
  HEALTH: "HEALTH",
};

interface NeuronGridProps {
  viewMode: ViewMode;
  running: boolean;
  taskKey?: TaskKey;
  customParams?: Partial<Params>;
  onTick?: (state: SimState, ctx: SimContext) => void;
  speed?: number; // sim ticks per frame
}

function draw(
  ctx: CanvasRenderingContext2D,
  CW: number,
  CH: number,
  sim: SimState,
  vm: ViewMode,
  P: Params,
) {
  const G = P.G;
  const N = P.N;
  const B = P.B;
  const pad = Math.max(8, Math.min(CW, CH) * 0.04);
  const cell = (Math.min(CW, CH) - pad * 2) / G;
  const r = Math.max(2, Math.floor(cell * 0.27));
  const offsetX = (CW - (cell * G + pad * 2)) / 2;
  const px = (gx: number, gy: number): [number, number] => [
    offsetX + pad + gx * cell + cell / 2,
    pad + gy * cell + cell / 2,
  ];
  const ns = sim.ns;
  ctx.fillStyle = "#020c16";
  ctx.fillRect(0, 0, CW, CH);
  ctx.strokeStyle = "rgba(10,50,45,0.12)";
  ctx.lineWidth = 0.4;
  for (let i = 0; i <= G; i++) {
    ctx.beginPath();
    ctx.moveTo(offsetX + pad + i * cell, pad);
    ctx.lineTo(offsetX + pad + i * cell, pad + cell * G);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offsetX + pad, pad + i * cell);
    ctx.lineTo(offsetX + pad + cell * G, pad + i * cell);
    ctx.stroke();
  }
  let maxL = 0.01;
  if (vm === "ENERGY") for (let i = 0; i < N; i++) if (ns[i].L_rolling > maxL) maxL = ns[i].L_rolling;
  const BT = ["rgba(0,255,180", "rgba(255,180,0", "rgba(180,80,255", "rgba(80,200,255"];
  const heavyEdges = N <= 200;
  for (let i = 0; i < N; i++) {
    const n = ns[i];
    if (n.h < 0.08) continue;
    const firing = n.state === "alarming";
    if (!heavyEdges && !firing) continue;
    const [x1, y1] = px(n.gx, n.gy);
    for (let ci = 0; ci < n.conns.length; ci++) {
      const c = n.conns[ci];
      const [x2, y2] = px(ns[c.to].gx, ns[c.to].gy);
      const eff = firing ? Math.min(0.65, c.w * 0.6) : Math.min(0.1, c.w * 0.08);
      const hl = n.h > 0.5 && ns[c.to].h > 0.5;
      ctx.strokeStyle =
        B > 1 && firing
          ? `${BT[(c.branch ?? 0) % BT.length]},${eff})`
          : firing
          ? `rgba(0,255,180,${eff})`
          : hl
          ? `rgba(10,90,80,${eff})`
          : `rgba(80,30,100,${eff * 0.4})`;
      ctx.lineWidth = firing ? Math.min(1.8, c.w * 1.3) : 0.4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
  }
  for (let i = 0; i < N; i++) {
    const n = ns[i];
    const [x, y] = px(n.gx, n.gy);
    ctx.shadowBlur = 0;
    let bc = "#0b3d3a";
    let gc: string = "transparent";
    let gb = 0;
    if (vm === "STATE") {
      const g = SGLOW[n.state];
      if (g) {
        gc = g;
        gb = n.state === "alarming" ? 20 : 8;
      }
      bc = SCLR[n.state] || "#0b3d3a";
    } else if (vm === "CONSCIOUS") {
      const cv = n.C;
      const norm = clamp((cv + 1) / 2);
      const [rr, gg, bb] = lerp3(norm, [100, 10, 160], [15, 15, 35], [0, 220, 180]);
      bc = `rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;
      const inTopK = P.USE_BOTTLENECK ? Math.abs(n.C) > 0.01 : true;
      if (inTopK) {
        gc = n.C > 0.02 ? `rgba(0,220,180,0.5)` : `rgba(100,10,160,0.4)`;
        gb = Math.abs(n.C) * 14;
      }
    } else if (vm === "ATTENTION") {
      const av = Math.min(1, n.A * N * 2.5);
      const [rr, gg, bb] = lerp3(av, [5, 5, 40], [180, 100, 0], [255, 220, 30]);
      bc = `rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;
      if (av > 0.3) {
        gc = `rgba(255,200,0,${av * 0.5})`;
        gb = av * 14;
      }
    } else if (vm === "ENERGY") {
      const heat = Math.min(1, n.L_rolling / maxL);
      const [rr, gg, bb] = lerp3(heat, [0, 30, 120], [200, 120, 0], [255, 30, 0]);
      bc = `rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;
      gc = `rgba(${Math.floor(rr)},${Math.floor(gg)},0,${heat * 0.65})`;
      gb = heat * 14;
    } else if (vm === "MI") {
      const v = Math.min(1, n.mi * 6);
      bc = `rgb(${Math.floor(v * 210)},${Math.floor(v * 160)},${Math.floor(v * 20)})`;
      gc = v > 0.2 ? `rgba(220,170,0,${v * 0.6})` : "transparent";
      gb = v * 13;
    } else {
      const [rr, gg, bb] = lerp3(1 - n.h, [0, 200, 160], [220, 110, 0], [100, 20, 140]);
      bc = `rgb(${Math.floor(rr)},${Math.floor(gg)},${Math.floor(bb)})`;
      gc =
        n.h > 0.7
          ? `rgba(0,200,160,0.5)`
          : n.h > 0.35
          ? `rgba(220,110,0,0.4)`
          : `rgba(100,20,140,0.5)`;
      gb = (1 - n.h) * 15;
    }
    ctx.shadowColor = gc;
    ctx.shadowBlur = gb;
    const rE = r * (0.45 + 0.55 * n.h);
    ctx.fillStyle = bc;
    ctx.beginPath();
    ctx.arc(x, y, rE, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    if (rE >= 2.5) {
      const f = Math.max(0, n.atp) / P.ATP_MAX;
      let ar: number, ag: number, ab: number;
      if (f > 0.55) {
        ar = 0;
        ag = Math.floor(80 + f * 160);
        ab = Math.floor(ag * 0.4);
      } else if (f > 0.28) {
        const u = (f - 0.28) / 0.27;
        ar = Math.floor(230 - u * 130);
        ag = Math.floor(70 + u * 90);
        ab = 0;
      } else {
        ar = Math.floor(140 + f * 220);
        ag = Math.floor(f * 55);
        ab = 0;
      }
      ctx.strokeStyle = `rgba(${ar},${ag},${ab},0.75)`;
      ctx.lineWidth = f < 0.25 ? 2.2 : 1.3;
      ctx.beginPath();
      ctx.arc(x, y, rE + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f);
      ctx.stroke();
      const hc = `rgba(${Math.floor((1 - n.h) * 160)},${Math.floor(n.h * 170)},${Math.floor(n.h * 90)},0.5)`;
      ctx.strokeStyle = hc;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, rE + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * n.h);
      ctx.stroke();
      if (n.v > 0.5) {
        const vr = Math.min(1, (n.v - 0.4) * 1.5);
        ctx.strokeStyle = `rgba(255,200,50,${vr * 0.4})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(x, y, rE + (B > 1 ? 15 : 11), -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * vr);
        ctx.stroke();
      }
      if (n.ic_total > 20 && n.ic_wins / n.ic_total > 0.4) {
        ctx.fillStyle = `rgba(0,255,200,0.5)`;
        ctx.beginPath();
        ctx.arc(x + rE * 0.7, y - rE * 0.7, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (B > 1 && n.d_eff > 0.1) {
        const dR = Math.min(1, n.d_eff / B);
        ctx.strokeStyle = `rgba(180,80,255,${dR * 0.55})`;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, y, rE + 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * dR);
        ctx.stroke();
      }
      if (n.isInput) {
        ctx.strokeStyle = "rgba(0,255,180,0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, rE + 19, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.shadowBlur = 0;
}

export function NeuronGrid({
  viewMode,
  running,
  taskKey = "COPY",
  customParams,
  onTick,
  speed = 4,
}: NeuronGridProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimState | null>(null);
  const ctxSimRef = useRef<SimContext | null>(null);
  const taskKeyRef = useRef<TaskKey>(taskKey);
  const animRef = useRef<number | null>(null);
  const runningRef = useRef(running);
  const viewRef = useRef(viewMode);
  const speedRef = useRef(speed);
  const onTickRef = useRef(onTick);
  const [size, setSize] = useState({ w: 320, h: 320 });

  useEffect(() => {
    runningRef.current = running;
  }, [running]);
  useEffect(() => {
    viewRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    onTickRef.current = onTick;
  }, [onTick]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(180, el.clientWidth);
      const side = Math.max(180, Math.min(560, w));
      setSize({ w: side, h: side });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const customKey = JSON.stringify(customParams ?? {});
  useEffect(() => {
    const params = { ...defaultParams(81), ...(customParams ?? {}) };
    const { sim, ctx } = createSim(params);
    setTask(sim, taskKey);
    simRef.current = sim;
    ctxSimRef.current = ctx;
    taskKeyRef.current = taskKey;
    return () => {
      simRef.current = null;
      ctxSimRef.current = null;
    };
  }, [taskKey, customKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx2d = canvas.getContext("2d");
    if (ctx2d) ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);

    let lastTaskAdvance = 0;
    const tick = () => {
      const sim = simRef.current;
      const ctxSim = ctxSimRef.current;
      if (sim && ctxSim && ctx2d) {
        if (runningRef.current) {
          for (let i = 0; i < speedRef.current; i++) simTick(sim, ctxSim);
          // advance task periodically
          if (sim.t - lastTaskAdvance > ctxSim.P.TASK_TICKS) {
            lastTaskAdvance = sim.t;
          }
          onTickRef.current?.(sim, ctxSim);
        }
        draw(ctx2d, size.w, size.h, sim, viewRef.current, ctxSim.P);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
    };
  }, [size]);

  return (
    <div ref={containerRef} className="w-full flex items-center justify-center">
      <canvas
        ref={canvasRef}
        style={{
          width: size.w,
          height: size.h,
          background: "#020c16",
          borderRadius: 3,
          border: "1px solid #0a2828",
        }}
      />
    </div>
  );
}
