import type { BannerState } from "../model/banner.js";

/** What the playground publishes for the headline banner (lives outside the playground). */
export interface BannerView {
  state: BannerState;
  /** Current GA generation (the snapshot may be from an earlier one). */
  generation: number;
  training: boolean;
  /** Applied minimum-magnitude slider value (training catalog). */
  catalogMinMag: number;
  loading: boolean;
  error: string;
}

type Listener = (view: BannerView) => void;

const EMPTY: BannerView = {
  state: { snapshot: null, stale: false, staleReason: "" },
  generation: 0,
  training: false,
  catalogMinMag: 5.5,
  loading: true,
  error: ""
};

let current: BannerView = EMPTY;
const listeners = new Set<Listener>();

/** Tiny module-level store so the sticky banner can sit at the top of <body>. */
export const bannerStore = {
  get(): BannerView {
    return current;
  },
  publish(view: BannerView): void {
    current = view;
    for (const fn of listeners) fn(view);
  },
  /** Calls `fn` immediately with the current view, then on every publish. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    fn(current);
    return () => listeners.delete(fn);
  }
};
