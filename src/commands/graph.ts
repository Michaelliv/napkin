import { exec } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { basename, join } from "node:path";
import { platform } from "node:process";
import { EXIT_NO_VAULT } from "../utils/exit-codes.js";
import { listFiles } from "../utils/files.js";
import type { OutputOptions } from "../utils/output.js";
import { error, info } from "../utils/output.js";

interface GraphNode {
  id: string;
  text: string;
  content: string;
  filePath: string;
}

interface GraphLink {
  source: string;
  target: string;
}

function collectGraphNodes(vaultPath: string, mdFiles: string[]): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const rel of mdFiles) {
    const slug = rel.replace(/\.md$/, "");
    const content = readFileSync(join(vaultPath, rel), "utf-8");
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : basename(rel, ".md");
    nodes.push({ id: slug, text: title, content, filePath: rel });
  }
  return nodes;
}

function indexSlugsByBasename(nodes: GraphNode[]): Map<string, string[]> {
  const nameToSlugs = new Map<string, string[]>();
  for (const node of nodes) {
    const name = basename(node.filePath, ".md");
    if (!nameToSlugs.has(name)) nameToSlugs.set(name, []);
    nameToSlugs.get(name)?.push(node.id);
  }
  return nameToSlugs;
}

/** Wikilink edges between nodes; same-folder match preferred, deduplicated. */
function buildGraphLinks(nodes: GraphNode[]): GraphLink[] {
  const nameToSlugs = indexSlugsByBasename(nodes);
  const links: GraphLink[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const wikilinks = [
      ...node.content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g),
    ].map((m) => m[1]);
    const nodeFolder = node.id.includes("/") ? node.id.split("/")[0] : "";
    for (const link of wikilinks) {
      const candidates = nameToSlugs.get(link);
      if (!candidates) continue;
      const target =
        candidates.find((s) => s.startsWith(`${nodeFolder}/`)) || candidates[0];
      if (target === node.id || seen.has(`${node.id}\u0000${target}`)) continue;
      seen.add(`${node.id}\u0000${target}`);
      links.push({ source: node.id, target: target });
    }
  }
  return links;
}

function buildGraphData(
  vaultPath: string,
  templatesFolder: string,
): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const mdFiles = listFiles(vaultPath, { ext: "md" }).filter(
    (rel) =>
      !rel.startsWith(`${templatesFolder}/`) && basename(rel) !== "index.md",
  );
  const nodes = collectGraphNodes(vaultPath, mdFiles);
  return { nodes, links: buildGraphLinks(nodes) };
}

function buildHTML(graphDataB64: string): string {
  return `
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e2e; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; width: 100vw; height: 100vh; }
  #graph-wrap { flex: 1; min-width: 0; position: relative; overflow: hidden; }
  canvas { display: block; }
  #tooltip {
    position: absolute; display: none; padding: 6px 10px;
    background: rgba(30,30,46,0.95); color: #cdd6f4; border: 1px solid #45475a;
    border-radius: 6px; font-size: 13px; pointer-events: none; z-index: 10;
  }
  #sidebar {
    flex: 0 0 0px; height: 100vh; background: #181825; border-left: 1px solid #313244;
    color: #cdd6f4; overflow: hidden; display: flex; flex-direction: column;
    transition: flex-basis 0.2s ease;
  }
  #sidebar.open { flex: 0 0 50%; padding: 16px; overflow-y: auto; }
  #sidebar .path { font-size: 11px; color: #6c7086; margin-bottom: 4px; font-family: monospace; }
  #sidebar .title { font-size: 16px; font-weight: 600; color: #89b4fa; margin-bottom: 12px; }
  #sidebar .content { font-size: 13px; line-height: 1.6; color: #cdd6f4; word-wrap: break-word; flex: 1; }
  #sidebar .content * { color: inherit; }
  #sidebar .content h1 { font-size: 18px; margin: 16px 0 8px; font-weight: 600; }
  #sidebar .content h2 { font-size: 15px; margin: 14px 0 6px; font-weight: 600; }
  #sidebar .content h3 { font-size: 14px; margin: 12px 0 4px; font-weight: 600; }
  #sidebar .content h4, #sidebar .content h5, #sidebar .content h6 { font-size: 13px; margin: 10px 0 4px; font-weight: 600; }
  #sidebar .content p { margin: 0 0 8px; color: #a6adc8; }
  #sidebar .content ul, #sidebar .content ol { margin: 0 0 8px; padding-left: 20px; color: #a6adc8; }
  #sidebar .content li { margin: 2px 0; }
  #sidebar .content code { background: #313244; padding: 1px 5px; border-radius: 3px; font-size: 12px; font-family: 'SF Mono', Menlo, monospace; color: #f38ba8; }
  #sidebar .content pre { background: #313244; padding: 10px 12px; border-radius: 6px; overflow-x: auto; margin: 0 0 8px; }
  #sidebar .content pre code { background: none; padding: 0; color: #a6adc8; }
  #sidebar .content blockquote { border-left: 3px solid #45475a; padding-left: 12px; margin: 0 0 8px; color: #7f849c; }
  #sidebar .content a { color: #89b4fa; text-decoration: none; }
  #sidebar .content strong { color: #cdd6f4; }
  #sidebar .content em { color: #bac2de; }
  #sidebar .content hr { border: none; border-top: 1px solid #313244; margin: 12px 0; }
  #sidebar .content table { border-collapse: collapse; margin: 0 0 8px; width: 100%; }
  #sidebar .content th, #sidebar .content td { border: 1px solid #45475a; padding: 4px 8px; font-size: 12px; color: #a6adc8; }
  #sidebar .content th { background: #313244; color: #cdd6f4; }
  #sidebar .content img { max-width: 100%; border-radius: 4px; }
  #sidebar .links { margin-top: 12px; border-top: 1px solid #313244; padding-top: 10px; }
  #sidebar .links-label { font-size: 11px; color: #6c7086; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px; }
  #sidebar .link-item { font-size: 12px; color: #89b4fa; cursor: pointer; padding: 2px 0; }
  #sidebar .link-item:hover { color: #f5c2e7; }
</style>
<div id="graph-wrap">
  <div id="tooltip"></div>
  <canvas id="graph"></canvas>
</div>
<div id="sidebar"></div>
<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
<script>
function dbg(msg) { if (window.glimpse) window.glimpse.send({ dbg: msg }); else console.log('[graph]', msg); }
let data;
try {
  data = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob("${graphDataB64}"), c => c.charCodeAt(0))));
  dbg('parsed ' + data.nodes.length + ' nodes, ' + data.links.length + ' links');
  dbg('nodes: ' + data.nodes.map(n => n.id).join(', '));
} catch(e) {
  dbg('PARSE ERROR: ' + e.message);
}
const canvas = document.getElementById('graph');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const sidebar = document.getElementById('sidebar');
const graphWrap = document.getElementById('graph-wrap');

const dpr = window.devicePixelRatio || 1;
let width = graphWrap.offsetWidth;
let height = window.innerHeight;
canvas.width = width * dpr;
canvas.height = height * dpr;
canvas.style.width = width + 'px';
canvas.style.height = height + 'px';
ctx.scale(dpr, dpr);

const colors = {
  nodeHover: '#f5c2e7',
  link: '#45475a', linkActive: '#6c7086',
  text: '#cdd6f4', bg: '#1e1e2e',
};
const folderColors = {
  'architecture': '#89b4fa',
  'decisions': '#a6e3a1',
  'changelog': '#f9e2af',
  'guides': '#fab387',
  '': '#cba6f7',
};
function nodeColor(id) {
  const folder = id.includes('/') ? id.split('/')[0] : '';
  return folderColors[folder] || '#89b4fa';
}

const linkCount = {};
data.nodes.forEach(n => linkCount[n.id] = 0);
data.links.forEach(l => {
  linkCount[l.source] = (linkCount[l.source] || 0) + 1;
  linkCount[l.target] = (linkCount[l.target] || 0) + 1;
});
function nodeRadius(id) { return 4 + Math.sqrt(linkCount[id] || 0) * 2; }

const simulation = d3.forceSimulation(data.nodes)
  .force('charge', d3.forceManyBody().strength(-120))
  .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
  .force('link', d3.forceLink(data.links).id(d => d.id).distance(60))
  .force('collide', d3.forceCollide(d => nodeRadius(d.id) + 2))
  .alphaDecay(0.02);

let transform = d3.zoomIdentity;
let hoveredNode = null;
let hoveredNeighbours = new Set();

function getNeighbours(nodeId) {
  const s = new Set();
  data.links.forEach(l => {
    const sid = typeof l.source === 'object' ? l.source.id : l.source;
    const tid = typeof l.target === 'object' ? l.target.id : l.target;
    if (sid === nodeId) s.add(tid);
    if (tid === nodeId) s.add(sid);
  });
  return s;
}

function findNode(screenX, screenY) {
  const [px, py] = transform.invert([screenX, screenY]);
  for (const n of data.nodes) {
    const dx = n.x - px, dy = n.y - py;
    if (dx * dx + dy * dy < (nodeRadius(n.id) + 5) ** 2) return n;
  }
  return null;
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(transform.x, transform.y);
  ctx.scale(transform.k, transform.k);

  for (const l of data.links) {
    const sid = typeof l.source === 'object' ? l.source.id : l.source;
    const tid = typeof l.target === 'object' ? l.target.id : l.target;
    const active = hoveredNode && (hoveredNeighbours.has(sid) && hoveredNeighbours.has(tid)) &&
                   (sid === hoveredNode.id || tid === hoveredNode.id);
    ctx.beginPath();
    ctx.moveTo(l.source.x, l.source.y);
    ctx.lineTo(l.target.x, l.target.y);
    ctx.strokeStyle = active ? colors.linkActive : colors.link;
    ctx.globalAlpha = hoveredNode ? (active ? 0.8 : 0.15) : 0.4;
    ctx.lineWidth = active ? 1.5 : 0.8;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const n of data.nodes) {
    const r = nodeRadius(n.id);
    const isHovered = hoveredNode && hoveredNode.id === n.id;
    const isNeighbour = hoveredNode && hoveredNeighbours.has(n.id);
    const dimmed = hoveredNode && !isHovered && !isNeighbour;
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = isHovered ? colors.nodeHover : nodeColor(n.id);
    ctx.globalAlpha = dimmed ? 0.15 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  const labelThreshold = 0.8;
  for (const n of data.nodes) {
    const isHovered = hoveredNode && hoveredNode.id === n.id;
    const isNeighbour = hoveredNode && hoveredNeighbours.has(n.id);
    const dimmed = hoveredNode && !isHovered && !isNeighbour;
    if (transform.k > labelThreshold || isHovered || isNeighbour) {
      ctx.font = (isHovered ? 'bold ' : '') + '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = colors.text;
      ctx.globalAlpha = dimmed ? 0.1 : (isHovered || isNeighbour ? 1 : Math.min((transform.k - labelThreshold) * 3, 0.7));
      const label = n.text.length > 25 ? n.text.slice(0, 23) + '...' : n.text;
      ctx.fillText(label, n.x, n.y - nodeRadius(n.id) - 4);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

simulation.on('tick', draw);

// Sidebar state
let selectedNode = null;

function resizeCanvas() {
  width = graphWrap.offsetWidth;
  height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  simulation.force('center', d3.forceCenter(width / 2, height / 2));
  draw();
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function showSidebar(node) {
  dbg('showSidebar: ' + node.id + ' content-len: ' + (node.content||'').length);
  selectedNode = node;
  sidebar.classList.remove('open');
  const neighbours = getNeighbours(node.id);
  sidebar.innerHTML = '<div class="path">' + esc(node.filePath || node.id) + '</div>'
    + '<div class="title">' + esc(node.text) + '</div>'
    + '<div class="content">' + marked.parse(node.content || '(empty)') + '</div>'
    + (neighbours.size > 0 ? '<div class="links"><div class="links-label">Links (' + neighbours.size + ')</div>'
      + [...neighbours].map(id => {
        const n = data.nodes.find(n => n.id === id);
        return '<div class="link-item" data-id="' + id + '">' + (n ? n.text : id) + '</div>';
      }).join('') + '</div>' : '');
  sidebar.querySelectorAll('.link-item').forEach(el => {
    el.addEventListener('click', () => {
      const target = data.nodes.find(n => n.id === el.dataset.id);
      if (target) showSidebar(target);
    });
  });
  requestAnimationFrame(() => {
    sidebar.classList.add('open');
    setTimeout(resizeCanvas, 250);
  });
}

function hideSidebar() {
  selectedNode = null;
  sidebar.className = '';
  sidebar.innerHTML = '';
  setTimeout(resizeCanvas, 250);
}

// Hover
canvas.addEventListener('mousemove', (e) => {
  const node = findNode(e.offsetX, e.offsetY);
  hoveredNode = node;
  hoveredNeighbours = node ? getNeighbours(node.id) : new Set();
  if (node) hoveredNeighbours.add(node.id);
  canvas.style.cursor = node ? 'pointer' : 'grab';
  if (node) {
    tooltip.style.display = 'block';
    tooltip.textContent = node.text;
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top = (e.clientY - 8) + 'px';
  } else {
    tooltip.style.display = 'none';
  }
  draw();
});

// Zoom + pan + click all via d3.zoom
// d3.zoom handles mousedown/mousemove/mouseup internally.
// We detect clicks by checking if the mouse moved between start and end.
let zoomStartX = 0, zoomStartY = 0;

const zoomBehavior = d3.zoom()
  .scaleExtent([0.2, 5])
  .on('start', (event) => {
    if (event.sourceEvent) {
      zoomStartX = event.sourceEvent.clientX || 0;
      zoomStartY = event.sourceEvent.clientY || 0;
      dbg('zoom-start at ' + zoomStartX + ',' + zoomStartY);
    }
  })
  .on('zoom', (event) => {
    transform = event.transform;
    draw();
  })
  .on('end', (event) => {
    if (event.sourceEvent) {
      const ex = event.sourceEvent.clientX || 0;
      const ey = event.sourceEvent.clientY || 0;
      const dx = ex - zoomStartX;
      const dy = ey - zoomStartY;
      const dist = dx * dx + dy * dy;
      dbg('zoom-end dist=' + dist + ' at ' + ex + ',' + ey);
      if (dist < 25) {
        const rect = canvas.getBoundingClientRect();
        const ox = ex - rect.left;
        const oy = ey - rect.top;
        dbg('click at canvas ' + ox + ',' + oy);
        const node = findNode(ox, oy);
        dbg('findNode=' + (node ? node.id : 'null'));
        if (node) {
          showSidebar(node);
        } else if (selectedNode) {
          hideSidebar();
        }
      }
    }
  });

d3.select(canvas).call(zoomBehavior)
  .on('dblclick.zoom', null);

window.addEventListener('resize', resizeCanvas);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && selectedNode) hideSidebar();
});
</script>
`;
}

async function openWithGlimpse(html: string): Promise<void> {
  const { open } = await import("glimpseui");
  const win = open(html, {
    width: 1200,
    height: 800,
    title: "napkin graph",
  });

  win.on("message", (data: Record<string, unknown>) => {
    if (data.dbg) {
      console.log("[graph]", data.dbg);
    }
  });

  await new Promise<void>((resolve) => {
    win.on("closed", () => resolve());
  });
}

async function openInBrowser(html: string): Promise<void> {
  // Wrap fragment in a full HTML document for the browser
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>napkin graph</title></head><body>${html}</body></html>`;

  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fullHtml);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") return;
      const url = `http://127.0.0.1:${addr.port}`;
      info(`Graph running at ${url} — press Ctrl+C to stop`);

      // Open browser
      const cmd =
        platform === "win32"
          ? `start ${url}`
          : platform === "linux"
            ? `xdg-open ${url}`
            : `open ${url}`;
      exec(cmd);

      // Keep running until interrupted
      process.on("SIGINT", () => {
        server.close();
        resolve();
      });
    });
  });
}

export async function graph(
  _args: Record<string, unknown>,
  options: OutputOptions & { vault?: string },
): Promise<void> {
  const { findVault } = await import("../utils/vault.js");
  const vaultInfo = findVault(options.vault || process.cwd());
  const vault = vaultInfo?.contentPath;

  if (!vault) {
    error("No vault found. Run napkin init or use --vault <path>");
    process.exit(EXIT_NO_VAULT);
  }

  const { loadConfig } = await import("../utils/config.js");
  const config = loadConfig(vaultInfo.configPath);
  const renderer = config.graph?.renderer ?? "auto";

  const { nodes, links } = buildGraphData(vault, config.templates.folder);
  const graphDataB64 = Buffer.from(JSON.stringify({ nodes, links })).toString(
    "base64",
  );
  const html = buildHTML(graphDataB64);

  const useGlimpse =
    renderer === "glimpse" || (renderer === "auto" && platform === "darwin");

  if (useGlimpse) {
    try {
      await openWithGlimpse(html);
    } catch {
      await openInBrowser(html);
    }
  } else {
    await openInBrowser(html);
  }
}
