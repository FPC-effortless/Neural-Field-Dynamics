// Task definitions: from CORE-1 baseline tasks to ARC-style transformations
export type TaskKey =
  | "COPY"
  | "REVERSE"
  | "ROTATE"
  | "ALTERNATE"
  | "NOVEL"
  | "ROTATE2"
  | "RANDOM";

export interface Task {
  seq: number[];
  desc: string;
}

export const TASKS: Record<TaskKey, Task> = {
  COPY: { seq: [1, 0, 1, 1, 0, 1, 0, 0], desc: "baseline sequence" },
  REVERSE: { seq: [0, 0, 1, 0, 1, 1, 0, 1], desc: "reversed bits" },
  ROTATE: { seq: [1, 0, 1, 0, 0, 1, 1, 0], desc: "cyclic shift +3" },
  ALTERNATE: { seq: [1, 1, 0, 0, 1, 1, 0, 0], desc: "interleaved rhythm" },
  NOVEL: { seq: [1, 0, 0, 1, 0, 1, 1, 0], desc: "unseen sequence (ATS test)" },
  ROTATE2: { seq: [0, 1, 1, 0, 1, 0, 0, 1], desc: "rotated +2" },
  RANDOM: { seq: [1, 1, 1, 0, 0, 1, 0, 1], desc: "uniform random" },
};

export const TASK_ORDER: TaskKey[] = [
  "COPY",
  "REVERSE",
  "ROTATE",
  "ALTERNATE",
  "NOVEL",
];

// ARC-style: small grid transformations encoded as bit sequences
// Each "task" is a function that, given an input pattern, produces an output.
export type Transform = (input: number[]) => number[];

export const TRANSFORMS: Record<string, Transform> = {
  identity: (a) => [...a],
  reverse: (a) => [...a].reverse(),
  invert: (a) => a.map((v) => 1 - v),
  shiftLeft: (a) => [...a.slice(1), a[0] ?? 0],
  shiftRight: (a) => [a[a.length - 1] ?? 0, ...a.slice(0, -1)],
  reverseInvert: (a) => [...a].reverse().map((v) => 1 - v),
  rotate2: (a) => [...a.slice(2), ...a.slice(0, 2)],
  swapPairs: (a) => {
    const out = [...a];
    for (let i = 0; i + 1 < out.length; i += 2) {
      const tmp = out[i] ?? 0;
      out[i] = out[i + 1] ?? 0;
      out[i + 1] = tmp;
    }
    return out;
  },
};

export function makeArcTask(transformName: string, length = 8): Task {
  const transform = TRANSFORMS[transformName];
  if (!transform) {
    return { seq: [1, 0, 1, 0, 1, 0, 1, 0], desc: `unknown:${transformName}` };
  }
  // Random input then transformed output, concatenated as alternating reference
  const input: number[] = [];
  for (let i = 0; i < length; i++) input.push(Math.random() < 0.5 ? 0 : 1);
  const output = transform(input);
  return { seq: [...input, ...output], desc: `arc:${transformName}` };
}
