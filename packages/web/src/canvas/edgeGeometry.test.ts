import { describe, expect, it } from "vitest";
import { rectAnchor } from "./edgeGeometry";

describe("rectAnchor", () => {
  it("anchors at the right-middle edge when the target is directly to the right", () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(rectAnchor(rect, 1000, 25)).toEqual({ x: 100, y: 25 });
  });

  it("anchors at the bottom-middle edge when the target is directly below", () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(rectAnchor(rect, 50, 1000)).toEqual({ x: 50, y: 50 });
  });

  it("anchors at a corner when the target is on the exact diagonal of a square", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectAnchor(rect, 1000, 1000)).toEqual({ x: 100, y: 100 });
  });

  it("returns the rect's own center when the target is the same point", () => {
    const rect = { x: 0, y: 0, width: 100, height: 50 };
    expect(rectAnchor(rect, 50, 25)).toEqual({ x: 50, y: 25 });
  });

  it("works correctly for a rect not anchored at the origin", () => {
    const rect = { x: 200, y: 300, width: 40, height: 20 };
    // Directly to the left of the rect's center (220, 310).
    expect(rectAnchor(rect, 0, 310)).toEqual({ x: 200, y: 310 });
  });
});
