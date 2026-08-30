import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { createTempVault } from "../utils/test-helpers.js";
import {
  canvasAddEdge,
  canvasAddNode,
  canvasCreate,
  canvases,
  canvasNodes,
  canvasRead,
  canvasRemoveNode,
} from "./canvas.js";

let v: ReturnType<typeof createTempVault>;

async function captureJson(
  fn: () => Promise<void>,
): Promise<Record<string, unknown>> {
  const orig = console.log;
  const logs: string[] = [];
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  await fn();
  console.log = orig;
  return JSON.parse(logs.join(""));
}

beforeEach(() => {
  v = createTempVault({
    "board.canvas": JSON.stringify({
      nodes: [
        {
          id: "aabb11223344",
          type: "text",
          x: 0,
          y: 0,
          width: 300,
          height: 150,
          text: "# Hello\nWorld",
        },
        {
          id: "ccdd55667788",
          type: "file",
          x: 400,
          y: 0,
          width: 300,
          height: 200,
          file: "Notes/note.md",
        },
        {
          id: "eeff99001122",
          type: "group",
          x: -50,
          y: -50,
          width: 800,
          height: 400,
          label: "My Group",
        },
      ],
      edges: [
        {
          id: "edge00112233",
          fromNode: "aabb11223344",
          fromSide: "right",
          toNode: "ccdd55667788",
          toSide: "left",
          label: "links to",
        },
      ],
    }),
    "Notes/note.md": "# Note\nSome content",
  });
});

afterEach(() => {
  v.cleanup();
});

describe("canvases", () => {
  test("lists canvas files", async () => {
    const data = await captureJson(() =>
      canvases({ json: true, vault: v.projectPath }),
    );
    expect(data.canvases).toContain("board.canvas");
  });

  test("returns total", async () => {
    const data = await captureJson(() =>
      canvases({ json: true, vault: v.projectPath, total: true }),
    );
    expect(data.total).toBe(1);
  });
});

describe("canvasRead", () => {
  test("reads canvas with nodes and edges", async () => {
    const data = await captureJson(() =>
      canvasRead({ json: true, vault: v.projectPath, file: "board" }),
    );
    expect((data.nodes as unknown[]).length).toBe(3);
    expect((data.edges as unknown[]).length).toBe(1);
  });
});

describe("canvasNodes", () => {
  test("lists all nodes", async () => {
    const data = await captureJson(() =>
      canvasNodes({ json: true, vault: v.projectPath, file: "board" }),
    );
    expect((data.nodes as unknown[]).length).toBe(3);
  });

  test("filters by type", async () => {
    const data = await captureJson(() =>
      canvasNodes({
        json: true,
        vault: v.projectPath,
        file: "board",
        type: "text",
      }),
    );
    expect((data.nodes as unknown[]).length).toBe(1);
  });
});

describe("canvasCreate", () => {
  test("creates empty canvas", async () => {
    const data = await captureJson(() =>
      canvasCreate({ json: true, vault: v.projectPath, file: "new-board" }),
    );
    expect(data.created).toBe(true);
    const content = JSON.parse(
      fs.readFileSync(path.join(v.contentPath, "new-board.canvas"), "utf-8"),
    );
    expect(content.nodes).toEqual([]);
    expect(content.edges).toEqual([]);
  });
});

describe("canvasAddNode", () => {
  test("adds a text node", async () => {
    const data = await captureJson(() =>
      canvasAddNode({
        json: true,
        vault: v.projectPath,
        file: "board",
        type: "text",
        text: "New node",
      }),
    );
    expect(data.added).toBe(true);
    expect(data.type).toBe("text");

    const content = JSON.parse(
      fs.readFileSync(path.join(v.contentPath, "board.canvas"), "utf-8"),
    );
    expect(content.nodes.length).toBe(4);
    const newNode = content.nodes[3];
    expect(newNode.text).toBe("New node");
  });

  test("adds a file node", async () => {
    const data = await captureJson(() =>
      canvasAddNode({
        json: true,
        vault: v.projectPath,
        file: "board",
        type: "file",
        noteFile: "Notes/note.md",
      }),
    );
    expect(data.type).toBe("file");
  });

  test("adds a link node", async () => {
    const data = await captureJson(() =>
      canvasAddNode({
        json: true,
        vault: v.projectPath,
        file: "board",
        type: "link",
        url: "https://example.com",
      }),
    );
    expect(data.type).toBe("link");
  });

  test("auto-positions new nodes", async () => {
    await canvasAddNode({
      json: true,
      vault: v.projectPath,
      file: "board",
      type: "text",
      text: "Auto",
    });
    const content = JSON.parse(
      fs.readFileSync(path.join(v.contentPath, "board.canvas"), "utf-8"),
    );
    const newNode = content.nodes[content.nodes.length - 1];
    // Should be placed after the rightmost existing node (group at x:-50 + width:800 = 750, +50 gap)
    expect(newNode.x).toBe(800);
  });
});

describe("canvasAddEdge", () => {
  test("adds an edge between nodes", async () => {
    const data = await captureJson(() =>
      canvasAddEdge({
        json: true,
        vault: v.projectPath,
        file: "board",
        from: "aabb",
        to: "eeff",
        label: "belongs to",
      }),
    );
    expect(data.added).toBe(true);

    const content = JSON.parse(
      fs.readFileSync(path.join(v.contentPath, "board.canvas"), "utf-8"),
    );
    expect(content.edges.length).toBe(2);
    const newEdge = content.edges[1];
    expect(newEdge.fromNode).toBe("aabb11223344");
    expect(newEdge.toNode).toBe("eeff99001122");
    expect(newEdge.label).toBe("belongs to");
  });

  test("matches node IDs by prefix", async () => {
    const data = await captureJson(() =>
      canvasAddEdge({
        json: true,
        vault: v.projectPath,
        file: "board",
        from: "ccdd",
        to: "eeff",
      }),
    );
    expect(data.from).toBe("ccdd55667788");
    expect(data.to).toBe("eeff99001122");
  });
});

describe("canvasRemoveNode", () => {
  test("removes node and connected edges", async () => {
    const data = await captureJson(() =>
      canvasRemoveNode({
        json: true,
        vault: v.projectPath,
        file: "board",
        id: "aabb",
      }),
    );
    expect(data.removed).toBe(true);

    const content = JSON.parse(
      fs.readFileSync(path.join(v.contentPath, "board.canvas"), "utf-8"),
    );
    expect(content.nodes.length).toBe(2);
    expect(content.edges.length).toBe(0); // Edge connected to removed node also gone
  });
});
