import { depths, layoutMap, NODE_W } from "@web-console-next/lib/qa-map-layout";

const f = (id: string, areaId: string | null = null) => ({ id, name: id, areaId });
const e = (from: string, to: string, confirmed = true) => ({ id: `${from}>${to}`, from, to, confirmed });

describe("qa map layout", () => {
  it("puts a feature one column right of the deepest feature it relies on", () => {
    const features = [f("signin"), f("roles"), f("create"), f("archive"), f("board"), f("digest")];
    const edges = [e("signin", "roles"), e("roles", "create"), e("create", "archive"), e("archive", "board"), e("create", "board"), e("archive", "digest")];
    const d = depths(features, edges);
    expect(Object.fromEntries(d)).toEqual({ signin: 0, roles: 1, create: 2, archive: 3, board: 4, digest: 4 });
  });

  it("survives a cycle without running away", () => {
    const d = depths([f("a"), f("b")], [e("a", "b"), e("b", "a")]);
    for (const v of d.values()) expect(v).toBeLessThan(2);
  });

  it("ignores edges to features that are not on the map", () => {
    expect(Object.fromEntries(depths([f("a")], [e("a", "gone"), e("gone", "a")]))).toEqual({ a: 0 });
  });

  it("orders rows by area, then name, and draws each edge from right edge to left edge", () => {
    const layout = layoutMap([f("z", "area_b"), f("y", "area_a"), f("x", "area_a"), f("t")], [e("x", "t")], ["area_a", "area_b"]);
    const col0 = layout.nodes.filter((n) => n.column === 0).sort((a, b) => a.row - b.row).map((n) => n.id);
    expect(col0).toEqual(["x", "y", "z"]);
    const x = layout.nodes.find((n) => n.id === "x")!;
    const t = layout.nodes.find((n) => n.id === "t")!;
    expect(t.column).toBe(1);
    expect(layout.edges[0]!.path.startsWith(`M ${x.x + NODE_W} `)).toBe(true);
    expect(layout.edges[0]!.path.endsWith(`${t.x} ${t.y + 32}`)).toBe(true);
    expect(layout.width).toBeGreaterThan(t.x + NODE_W);
  });

  it("is empty for an empty map", () => {
    expect(layoutMap([], [])).toEqual({ nodes: [], edges: [], width: 0, height: 0 });
  });
});
