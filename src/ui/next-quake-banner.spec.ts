import { afterEach, describe, expect, it } from "vitest";
import { MS_PER_HOUR, type QuakeEvent } from "../data/types.js";
import { FEATURE_DIM } from "../features/extract.js";
import { BannerTracker } from "../model/banner.js";
import { GENOME_LENGTH, HEAD_COUNT, WEIGHTS_PER_HEAD, type Genome } from "../model/genome.js";
import { bannerStore, type BannerView } from "./banner-store.js";
import "./next-quake-banner.js";

function genome(mag: number): Genome {
  const genes = new Float64Array(GENOME_LENGTH);
  [Math.log1p(24), 0, 0, mag].forEach((b, h) => (genes[h * WEIGHTS_PER_HEAD + FEATURE_DIM] = b));
  genes[HEAD_COUNT * WEIGHTS_PER_HEAD + 1] = 5;
  return { genes };
}

const events: QuakeEvent[] = Array.from({ length: 30 }, (_, i) => ({
  id: String(i),
  time: Date.UTC(2026, 8, 1) + i * 12 * MS_PER_HOUR,
  lat: -20,
  lon: 170,
  mag: 5.6,
  place: "Testville, Tonga"
}));

function view(tr: BannerTracker, extra: Partial<BannerView> = {}): BannerView {
  return { state: tr.state, generation: 4, training: true, catalogMinMag: 5.5, loading: false, error: "", ...extra };
}

async function mount() {
  const el = document.createElement("qv-next-quake-banner") as HTMLElement & { updateComplete: Promise<boolean> };
  document.body.appendChild(el);
  await el.updateComplete;
  const text = async () => {
    await el.updateComplete;
    return el.shadowRoot!.textContent!.replace(/\s+/g, " ");
  };
  return { el, text };
}

describe("qv-next-quake-banner", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows a loading message (not blank) before the first prediction", async () => {
    const { text } = await mount();
    bannerStore.publish(view(new BannerTracker(), { loading: true }));
    expect(await text()).toMatch(/Loading catalog/);
    expect(await text()).toMatch(/Not a real earthquake forecast/);
  });

  it("shows time, magnitude and place, then stays visible (dimmed) while updating", async () => {
    const tr = new BannerTracker();
    tr.offer({ genome: genome(6.4), fitness: 0.42, generation: 3, events, referenceTime: Date.UTC(2026, 8, 28), catalogMinMag: 5.5 });
    const { el, text } = await mount();
    bannerStore.publish(view(tr));
    let t = await text();
    expect(t).toMatch(/Next biggest predicted quake · next 30 events/);
    expect(t).toMatch(/M6\.40/);
    expect(t).toMatch(/#1 of 30 in the chain/);
    expect(t).not.toMatch(/M6\.0\+/);
    expect(t).toMatch(/UTC/);
    expect(t).toMatch(/near Testville, Tonga/);
    expect(t).toMatch(/fitness 0\.420/);
    expect(t).toMatch(/best since gen 3 \(now 4\)/);

    tr.markStale("updating…");
    bannerStore.publish(view(tr, { training: false }));
    t = await text();
    expect(t).toMatch(/M6\.40/);
    expect(t).toMatch(/updating…/);
    expect(el.shadowRoot!.querySelector(".inner.stale")).not.toBeNull();
  });

  it("shows a small event too (no threshold)", async () => {
    const tr = new BannerTracker();
    tr.offer({ genome: genome(4.7), fitness: 0.2, generation: 0, events, referenceTime: Date.UTC(2026, 8, 28), catalogMinMag: 5.5 });
    const { text } = await mount();
    bannerStore.publish(view(tr, { training: false, generation: 0 }));
    const t = await text();
    expect(t).toMatch(/M4\.70/);
    expect(t).not.toMatch(/No M6/);
  });

  it("shows a clear fallback only when the chain fails at its first step", async () => {
    const tr = new BannerTracker();
    tr.offer({ genome: genome(9.6), fitness: 0.2, generation: 0, events, referenceTime: Date.UTC(2026, 8, 28), catalogMinMag: 5.5 });
    const { text } = await mount();
    bannerStore.publish(view(tr, { training: false, generation: 0 }));
    expect(await text()).toMatch(/left the data range at its first step/);
  });
});
