"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, Share2 } from "lucide-react";
import { createProductStore } from "../../lib/product-store";
import { clipLabel } from "../../lib/clip";
import {
  layoutPersonalMap, mapCaption, mapForShare, type PersonalMap, SHARE_MAX_NODES,
} from "../../lib/personal-map";

/**
 * One shared copy of the map, the same pattern as `productStore` in
 * ProductScreens.tsx: a failed refresh must never blank a screen that already
 * has good data, and this screen is not the only one that will ever want it.
 */
export const personalMapStore = createProductStore<PersonalMap>({ url: "/api/personal-map" });

function useMapData() {
  const state = useSyncExternalStore(personalMapStore.subscribe, personalMapStore.getState, personalMapStore.getState);
  useEffect(() => { void personalMapStore.load(); }, []);
  return { data: state.data, error: state.data ? "" : state.error, reload: () => personalMapStore.load({ force: true }) };
}

/**
 * The graph itself, on screen. Decorative: the position and co-occurrence
 * lists underneath carry the same information in a form a screen reader can
 * read, the same split `weight-curve` in ProductScreens.tsx already uses.
 */
function MapGraph({ map }: { map: PersonalMap }) {
  const layout = layoutPersonalMap(map, { width: 320, height: 320 });
  if (layout.nodes.length === 0) return null;
  const maxEdgeCount = layout.edges.length ? Math.max(...layout.edges.map((edge) => edge.count)) : 1;
  return (
    <svg className="personal-map-graph" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
      {layout.edges.map((edge, index) => (
        <line
          key={`${edge.a}-${edge.b}-${index}`}
          x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
          style={{ stroke: "var(--blue-bright)", strokeOpacity: 0.22 + 0.55 * (edge.count / maxEdgeCount), strokeWidth: edge.weight }}
          strokeLinecap="round"
        />
      ))}
      {layout.nodes.map((node) => (
        <g key={node.label}>
          <circle cx={node.x} cy={node.y} r={node.radius} style={{ fill: "var(--surface)", stroke: "var(--blue-bright)", strokeWidth: 2 }} />
          <text x={node.x} y={node.y + node.radius + 15} textAnchor="middle" className="personal-map-node-label">{clipLabel(node.label, 18)}</text>
        </g>
      ))}
    </svg>
  );
}

const SHARE_WIDTH = 1080;
const SHARE_HEIGHT = 1920;
const SHARE_BACKGROUND = "#080b12";
const SHARE_INK = "#e8f1ff";
const SHARE_MUTED = "#7f91aa";
const SHARE_ACCENT = "#18d9ed";
const SHARE_SURFACE = "#111827";
const SHARE_FONT = "system-ui, -apple-system, \"Segoe UI\", sans-serif";

/**
 * The image itself: the athlete's own positions, their own counts, in their
 * own words, drawn by code. See goals.md, "No model-written prose in the
 * share export." Every string on this canvas is either a fixed label this
 * file wrote ("FIGHTIQ", "Your map") or a count read straight off the map;
 * nothing here is generated.
 */
function drawShareImage(canvas: HTMLCanvasElement, map: PersonalMap) {
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const shared = mapForShare(map, SHARE_MAX_NODES);
  const caption = mapCaption(map);

  ctx.fillStyle = SHARE_BACKGROUND;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = SHARE_MUTED;
  ctx.font = `700 28px ${SHARE_FONT}`;
  ctx.fillText("FIGHTIQ", 90, 130);
  ctx.fillStyle = SHARE_INK;
  ctx.font = `800 54px ${SHARE_FONT}`;
  ctx.fillText("Your map", 90, 210);

  const margin = 90;
  const graphSize = SHARE_WIDTH - margin * 2;
  const graphTop = 330;
  const layout = layoutPersonalMap(shared, { width: graphSize, height: graphSize });
  const maxEdgeCount = layout.edges.length ? Math.max(...layout.edges.map((edge) => edge.count)) : 1;

  ctx.save();
  ctx.translate(margin, graphTop);
  ctx.lineCap = "round";
  for (const edge of layout.edges) {
    ctx.strokeStyle = SHARE_ACCENT;
    ctx.globalAlpha = 0.22 + 0.55 * (edge.count / maxEdgeCount);
    ctx.lineWidth = edge.weight;
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    ctx.lineTo(edge.x2, edge.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const node of layout.nodes) {
    ctx.beginPath();
    ctx.fillStyle = SHARE_SURFACE;
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = SHARE_ACCENT;
    ctx.stroke();
  }
  ctx.fillStyle = SHARE_INK;
  ctx.font = `600 30px ${SHARE_FONT}`;
  ctx.textAlign = "center";
  for (const node of layout.nodes) {
    ctx.fillText(clipLabel(node.label, 20), node.x, node.y + node.radius + 42);
  }
  ctx.restore();

  const captionTop = graphTop + graphSize + 100;
  ctx.textAlign = "left";
  ctx.fillStyle = SHARE_INK;
  ctx.font = `700 42px ${SHARE_FONT}`;
  ctx.fillText(caption.sessions, margin, captionTop);
  if (caption.range) {
    ctx.fillStyle = SHARE_MUTED;
    ctx.font = `500 32px ${SHARE_FONT}`;
    ctx.fillText(caption.range, margin, captionTop + 54);
  }
}

type ShareNavigator = Navigator & {
  share?: (data: { files?: File[]; title?: string }) => Promise<void>;
  canShare?: (data?: { files?: File[] }) => boolean;
};

function emptyMapCopy(map: PersonalMap): string {
  if (map.sessionCount === 0) return "No sessions logged yet. Log training and any position you mention becomes a node here.";
  if (map.sessionCount === 1) return "1 session logged, no position named in it yet. Mention a position by name next time and it shows up here.";
  return `${map.sessionCount} sessions logged, no position named in any of them yet. Mention a position by name next time and it shows up here.`;
}

export function PersonalMapScreen({ onBack }: { onBack: () => void }) {
  const { data, error, reload } = useMapData();
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState("");
  const [shareNotice, setShareNotice] = useState("");

  async function shareMap() {
    if (!data || sharing) return;
    setSharing(true); setShareError(""); setShareNotice("");
    try {
      const canvas = document.createElement("canvas");
      drawShareImage(canvas, data);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("PERSONAL_MAP_BLOB_FAILED");
      const file = new File([blob], "fightiq-map.png", { type: "image/png" });
      const nav = navigator as ShareNavigator;
      if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
        await nav.share({ files: [file], title: "My FightIQ map" });
        setShareNotice("Shared.");
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "fightiq-map.png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setShareNotice("Image downloaded.");
    } catch (caught) {
      // Closing the share sheet without picking anything is not a failure.
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setShareError("The image couldn't be prepared. Try again.");
    } finally { setSharing(false); }
  }

  const hasMap = Boolean(data && data.nodes.length > 0);
  const caption = data ? mapCaption(data) : null;

  return <main className="page product-page native-page personal-map-page">
    <header className="page-header">
      <button className="icon-button" onClick={onBack} aria-label="Back to My Game"><ArrowLeft size={19} /></button>
      <div><p className="question-progress">BUILT FROM YOUR SESSIONS</p><h1 className="page-title">Your map</h1></div>
    </header>
    {!data && !error && <div className="inline-loading" role="status"><LoaderCircle size={22} className="spin" /><span>Reading your sessions…</span></div>}
    {error && <div className="compact-error" role="alert"><p>{error}</p><button onClick={() => void reload()}><RefreshCw size={15} /> Retry</button></div>}
    {data && !hasMap && <section className="personal-map-empty"><p>{emptyMapCopy(data)}</p></section>}
    {data && hasMap && <>
      <MapGraph map={data} />
      <section className="personal-map-positions">
        <span className="field-label">YOUR POSITIONS</span>
        <ul>{data.nodes.map((node) => <li key={node.label}><strong>{node.label}</strong><span>{node.count === 1 ? "1 session" : `${node.count} sessions`}</span></li>)}</ul>
      </section>
      {data.edges.length > 0 && <section className="personal-map-edges">
        <span className="field-label">WHAT KEEPS SHOWING UP TOGETHER</span>
        <ul>{data.edges.map((edge) => <li key={`${edge.a}-${edge.b}`}><strong>{edge.a} + {edge.b}</strong><span>{edge.count === 1 ? "In 1 session together" : `In ${edge.count} sessions together`}</span></li>)}</ul>
      </section>}
      {caption && <p className="personal-map-caption">{caption.sessions}{caption.range ? `, ${caption.range}` : ""}</p>}
      <button className="primary-button personal-map-share" onClick={() => void shareMap()} disabled={sharing}>
        {sharing ? "PREPARING…" : <><Share2 size={17} /> SHARE YOUR MAP</>}
      </button>
      {shareError && <p className="error-message" role="alert">{shareError}</p>}
      {shareNotice && <p className="saved-note" role="status">{shareNotice}</p>}
    </>}
  </main>;
}
