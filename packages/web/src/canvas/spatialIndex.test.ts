import { describe, expect, it } from "vitest";
import { buildSpatialIndex, queryVisible, BUCKET_SIZE } from "./spatialIndex";

describe("buildSpatialIndex / queryVisible", () => {
  it("finds an object whose bucket falls inside the viewport", () => {
    const index = buildSpatialIndex([{ id: "a", x: 100, y: 100, width: 50, height: 50 }]);
    const visible = queryVisible(index, { minX: 0, minY: 0, maxX: 500, maxY: 500 }, 0);
    expect(visible.has("a")).toBe(true);
  });

  it("excludes an object far outside the viewport and its margin", () => {
    const index = buildSpatialIndex([{ id: "far", x: 100_000, y: 100_000, width: 50, height: 50 }]);
    const visible = queryVisible(index, { minX: 0, minY: 0, maxX: 500, maxY: 500 }, 0);
    expect(visible.has("far")).toBe(false);
  });

  it("includes an object just outside the viewport but within the margin", () => {
    const index = buildSpatialIndex([
      { id: "just-outside", x: 500 + BUCKET_SIZE / 2, y: 0, width: 10, height: 10 },
    ]);
    const visible = queryVisible(index, { minX: 0, minY: 0, maxX: 500, maxY: 500 }, BUCKET_SIZE);
    expect(visible.has("just-outside")).toBe(true);
  });

  it("falls back to the default compact footprint when width/height are omitted", () => {
    const index = buildSpatialIndex([{ id: "no-size", x: 0, y: 0 }]);
    const visible = queryVisible(index, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, 0);
    expect(visible.has("no-size")).toBe(true);
  });

  it("places an object spanning multiple buckets into all of them", () => {
    const index = buildSpatialIndex([
      { id: "wide", x: 0, y: 0, width: BUCKET_SIZE * 2, height: 10 },
    ]);
    // Querying a viewport that only overlaps the second bucket should still find it.
    const visible = queryVisible(
      index,
      { minX: BUCKET_SIZE * 1.5, minY: 0, maxX: BUCKET_SIZE * 1.5, maxY: 10 },
      0,
    );
    expect(visible.has("wide")).toBe(true);
  });

  it("returns an empty set when the index is empty", () => {
    const index = buildSpatialIndex([]);
    const visible = queryVisible(index, { minX: 0, minY: 0, maxX: 1000, maxY: 1000 });
    expect(visible.size).toBe(0);
  });
});
