/**
 * Pure layout for the Insights dependency map (Orun QA, QA1). Dependency-free so
 * it is unit-testable. Columns are dependency depth: a feature sits one column to
 * the right of the deepest feature it relies on, so arrows read left to right,
 * "built first" to "built on top".
 */

export interface LayoutFeature {
  id: string;
  name: string;
  areaId: string | null;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  confirmed: boolean;
}

export interface PlacedNode {
  id: string;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface PlacedEdge {
  id: string;
  from: string;
  to: string;
  confirmed: boolean;
  /** SVG path, from the source's right edge to the target's left edge. */
  path: string;
}

export interface MapLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

export const NODE_W = 184;
export const NODE_H = 64;
const COL_GAP = 96;
const ROW_GAP = 32;
const PAD = 24;

/** Longest-path depth over all edges; a cycle stops growing after N passes. */
export function depths(features: LayoutFeature[], edges: LayoutEdge[]): Map<string, number> {
  const ids = new Set(features.map((f) => f.id));
  const live = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const depth = new Map<string, number>(features.map((f) => [f.id, 0]));
  for (let pass = 0; pass < features.length; pass++) {
    let changed = false;
    for (const e of live) {
      const want = (depth.get(e.from) ?? 0) + 1;
      if (want > (depth.get(e.to) ?? 0) && want < features.length) {
        depth.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

export function layoutMap(features: LayoutFeature[], edges: LayoutEdge[], areaOrder: string[] = []): MapLayout {
  const depth = depths(features, edges);
  const areaRank = (a: string | null) => (a === null ? Number.MAX_SAFE_INTEGER : Math.max(0, areaOrder.indexOf(a)));
  const columns = new Map<number, LayoutFeature[]>();
  for (const f of features) {
    const c = depth.get(f.id) ?? 0;
    columns.set(c, [...(columns.get(c) ?? []), f]);
  }

  const nodes: PlacedNode[] = [];
  let maxRows = 0;
  for (const [column, list] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => areaRank(a.areaId) - areaRank(b.areaId) || a.name.localeCompare(b.name));
    list.forEach((f, row) => {
      nodes.push({ id: f.id, column, row, x: PAD + column * (NODE_W + COL_GAP), y: PAD + row * (NODE_H + ROW_GAP) });
    });
    maxRows = Math.max(maxRows, list.length);
  }

  const at = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedEdge[] = [];
  for (const e of edges) {
    const a = at.get(e.from);
    const b = at.get(e.to);
    if (!a || !b || a.id === b.id) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    // Forward edges bow gently; a backward edge (a cycle) loops out to the right and back.
    const bend = x2 > x1 ? Math.max(32, (x2 - x1) / 2) : NODE_W + COL_GAP / 2;
    placed.push({ id: e.id, from: e.from, to: e.to, confirmed: e.confirmed, path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` });
  }

  const cols = columns.size === 0 ? 0 : Math.max(...columns.keys()) + 1;
  return {
    nodes,
    edges: placed,
    width: cols === 0 ? 0 : PAD * 2 + cols * NODE_W + (cols - 1) * COL_GAP,
    height: maxRows === 0 ? 0 : PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP,
  };
}
