(() => {
  "use strict";

  const CONFIG = {
    tileSize: 14,
    flipDurationMs: 920,
    waveDurationMs: 4200,
    refreshIntervalMs: 30000,
    liftPx: 3.2,
    depthPx: 2.4,
    maxDpr: 1.25,
    background: "#d7dadf"
  };

  const PALETTES = [
    // A: dark tree on light field
    { tree: 92, bg: 220 },
    // B: light tree on dark field
    { tree: 206, bg: 108 }
  ];

  const HEX_ONLY = /^[0-9a-f]{64}$/;

  let canvas = document.getElementById("cubeBoard") || document.getElementById("txBoard");
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.id = "cubeBoard";
    document.body.prepend(canvas);
  }

  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    zIndex: "0",
    display: "block"
  });

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  let dpr = 1;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let tiles = [];
  let treeMask = [];
  let trunkMask = [];
  let schemeIndex = 0;

  // Contains only real Ethereum tx hashes when live fetch succeeds.
  let hashStream = "";
  let streamCursor = 0;

  let maskImage = null;
  let maskImageReady = false;
  let proceduralTreeMeta = null;
  let rafId = 0;

  function normalizeHash(hash = "") {
    const lower = String(hash).toLowerCase();
    if (!lower.startsWith("0x")) return null;
    const body = lower.slice(2);
    if (!HEX_ONLY.test(body)) return null;
    return lower;
  }

  function buildHashStream(hashes) {
    if (!Array.isArray(hashes) || hashes.length === 0) return "";
    const unique = [...new Set(hashes.map(normalizeHash).filter(Boolean))];
    if (!unique.length) return "";
    return unique.join("   ");
  }

  function hexToTag(n) {
    return "0x" + n.toString(16);
  }

  async function fetchBlockByTag(tag, apiKey) {
    const base = "https://api.etherscan.io/v2/api";
    const url =
      `${base}?chainid=1&module=proxy&action=eth_getBlockByNumber&tag=${encodeURIComponent(tag)}&boolean=true` +
      (apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : "");

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    if (data?.status === "0" && data?.message) {
      throw new Error(data.result || data.message);
    }

    const txs = data?.result?.transactions;
    if (!Array.isArray(txs)) return [];

    return txs
      .map((tx) => (typeof tx === "string" ? tx : tx?.hash))
      .filter(Boolean)
      .map(normalizeHash)
      .filter(Boolean);
  }

  async function fetchLatestBlockNumber(apiKey) {
    const base = "https://api.etherscan.io/v2/api";
    const url =
      `${base}?chainid=1&module=proxy&action=eth_blockNumber` +
      (apiKey ? `&apikey=${encodeURIComponent(apiKey)}` : "");

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const hex = data?.result;
    if (!hex || typeof hex !== "string" || !hex.startsWith("0x")) {
      throw new Error("Missing latest block number");
    }
    return hex;
  }

  async function fetchLatestTransactionHashes() {
    const apiKey = (window.ETHERSCAN_API_KEY || "").trim();

    const latest = await fetchBlockByTag("latest", apiKey);
    let combined = [...latest];

    try {
      const latestNumberHex = await fetchLatestBlockNumber(apiKey);
      const latestNumber = Number.parseInt(latestNumberHex, 16);
      for (let i = 1; i <= 2; i++) {
        const n = latestNumber - i;
        if (n <= 0) break;
        combined = combined.concat(await fetchBlockByTag(hexToTag(n), apiKey));
      }
    } catch {
      // Keep latest block hashes if history fetch fails.
    }

    const clean = [...new Set(combined.filter(Boolean))];
    if (!clean.length) throw new Error("No transaction hashes returned");
    return clean;
  }

  function createTile() {
    return {
      current: " ",
      next: " ",
      flipStart: -1,
      isFlipping: false,
      schemeCurrent: 0,
      schemeNext: 0,
      toneSeed: Math.random(),
      inTree: false,
      isTreeEdge: false,
      isTrunk: false
    };
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, CONFIG.maxDpr);
    width = window.innerWidth;
    height = window.innerHeight;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    cols = Math.ceil(width / CONFIG.tileSize);
    rows = Math.ceil(height / CONFIG.tileSize);
    const count = cols * rows;

    const nextTiles = new Array(count);
    for (let i = 0; i < count; i++) {
      nextTiles[i] = tiles[i] || createTile();
    }
    tiles = nextTiles;

    rebuildTreeMask();
  }

  function drawProceduralTreeMask(mctx, w, h) {
    const cx = w * 0.5;
    // Lower tree so the stump sits closer to the footer band.
    const baseY = h * 0.84;
    const canopyW = w * 0.66;
    const canopyH = h * 0.52;

    mctx.clearRect(0, 0, w, h);
    mctx.strokeStyle = "rgba(0,0,0,1)";
    mctx.lineCap = "round";
    mctx.lineJoin = "round";

    let seed = 246813579;
    function rand() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }

    // Solid trunk with stronger flare at the base.
    const trunkTopY = baseY - canopyH * 0.34;
    const trunkBottomY = baseY;
    const trunkTopW = canopyW * 0.034;
    const trunkBottomW = canopyW * 0.13;
    proceduralTreeMeta = { cx, trunkTopY, trunkBottomY, trunkTopW, trunkBottomW };

    mctx.fillStyle = "rgba(0,0,0,1)";
    mctx.beginPath();
    mctx.moveTo(cx - trunkBottomW * 0.58, trunkBottomY);
    mctx.bezierCurveTo(
      cx - trunkBottomW * 0.5,
      baseY - canopyH * 0.06,
      cx - trunkTopW * 0.95,
      trunkTopY + canopyH * 0.12,
      cx - trunkTopW * 0.52,
      trunkTopY
    );
    mctx.quadraticCurveTo(
      cx - trunkTopW * 0.06,
      trunkTopY - canopyH * 0.02,
      cx,
      trunkTopY - canopyH * 0.015
    );
    mctx.quadraticCurveTo(
      cx + trunkTopW * 0.06,
      trunkTopY - canopyH * 0.02,
      cx + trunkTopW * 0.52,
      trunkTopY
    );
    mctx.bezierCurveTo(
      cx + trunkTopW * 0.95,
      trunkTopY + canopyH * 0.12,
      cx + trunkBottomW * 0.5,
      baseY - canopyH * 0.06,
      cx + trunkBottomW * 0.58,
      trunkBottomY
    );
    mctx.closePath();
    mctx.fill();

    function branch(x, y, len, angle, width, depth) {
      if (depth <= 0 || len < 0.95 || width < 0.12) return;

      const bend = (rand() - 0.5) * 0.96;
      const heading = angle + bend * 0.5;
      const x2 = x + Math.cos(heading) * len;
      const y2 = y + Math.sin(heading) * len;
      const normal = heading + Math.PI / 2;
      const c1Amp = len * (0.28 + rand() * 0.2) * (rand() < 0.5 ? -1 : 1);
      const c2Amp = len * (0.24 + rand() * 0.22) * (rand() < 0.5 ? -1 : 1);
      const c1x = x + Math.cos(heading) * len * 0.33 + Math.cos(normal) * c1Amp;
      const c1y = y + Math.sin(heading) * len * 0.33 + Math.sin(normal) * c1Amp;
      const c2x = x + Math.cos(heading) * len * 0.72 + Math.cos(normal) * c2Amp;
      const c2y = y + Math.sin(heading) * len * 0.72 + Math.sin(normal) * c2Amp;

      mctx.lineWidth = Math.max(0.45, width);
      mctx.beginPath();
      mctx.moveTo(x, y);
      mctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
      mctx.stroke();

      const trunkZoneTop = baseY - canopyH * 1.22;
      const trunkZoneBottom = baseY + canopyH * 0.04;
      if (y2 < trunkZoneTop || y2 > trunkZoneBottom || x2 < cx - canopyW * 0.62 || x2 > cx + canopyW * 0.62) {
        return;
      }

      const nextLen = len * (0.76 + rand() * 0.09);
      const nextWidth = width * (0.56 + rand() * 0.08);
      const spread = 0.14 + rand() * 0.2;

      branch(x2, y2, nextLen, heading - spread, nextWidth, depth - 1);
      branch(x2, y2, nextLen * (0.98 + rand() * 0.06), heading + spread, nextWidth, depth - 1);
    }

    // Primary limbs with wider horizontal spread.
    const roots = [
      { x: cx - trunkTopW * 0.9, y: trunkTopY + 1.4, a: -2.62, l: canopyW * 0.29, w: canopyW * 0.012, d: 9 },
      { x: cx - trunkTopW * 0.56, y: trunkTopY + 0.9, a: -2.2, l: canopyW * 0.33, w: canopyW * 0.013, d: 9 },
      { x: cx - trunkTopW * 0.22, y: trunkTopY + 0.35, a: -1.9, l: canopyW * 0.35, w: canopyW * 0.013, d: 9 },
      { x: cx, y: trunkTopY - 0.2, a: -1.57, l: canopyW * 0.38, w: canopyW * 0.014, d: 10 },
      { x: cx + trunkTopW * 0.22, y: trunkTopY + 0.35, a: -1.24, l: canopyW * 0.35, w: canopyW * 0.013, d: 9 },
      { x: cx + trunkTopW * 0.56, y: trunkTopY + 0.9, a: -0.94, l: canopyW * 0.33, w: canopyW * 0.013, d: 9 },
      { x: cx + trunkTopW * 0.9, y: trunkTopY + 1.4, a: -0.52, l: canopyW * 0.29, w: canopyW * 0.012, d: 9 }
    ];

    for (const r of roots) {
      branch(r.x, r.y, r.l, r.a, r.w, r.d);
    }

    // Lower snaky limbs.
    branch(cx - trunkTopW * 0.66, trunkTopY + canopyH * 0.12, canopyW * 0.24, -2.9, canopyW * 0.01, 7);
    branch(cx + trunkTopW * 0.66, trunkTopY + canopyH * 0.12, canopyW * 0.24, -0.26, canopyW * 0.01, 7);
  }

  function rebuildTreeMask() {
    const count = cols * rows;
    treeMask = new Array(count).fill(false);
    trunkMask = new Array(count).fill(false);
    if (count === 0) return;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = cols;
    maskCanvas.height = rows;
    const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!mctx) return;

    if (maskImageReady && maskImage) {
      proceduralTreeMeta = null;
      const iw = maskImage.naturalWidth || maskImage.width;
      const ih = maskImage.naturalHeight || maskImage.height;

      if (iw > 0 && ih > 0) {
        const scale = Math.min((cols * 0.5) / iw, (rows * 0.62) / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        const dx = (cols - dw) / 2;
        const dy = (rows - dh) / 2;

        mctx.clearRect(0, 0, cols, rows);
        mctx.drawImage(maskImage, dx, dy, dw, dh);
      } else {
        drawProceduralTreeMask(mctx, cols, rows);
      }
    } else {
      drawProceduralTreeMask(mctx, cols, rows);
    }

    const data = mctx.getImageData(0, 0, cols, rows).data;
    for (let i = 0; i < count; i++) {
      const a = data[i * 4 + 3];
      const r = data[i * 4 + 0];
      const g = data[i * 4 + 1];
      const b = data[i * 4 + 2];
      const nearWhite = r > 245 && g > 245 && b > 245;
      treeMask[i] = a > 20 && !nearWhite;
      tiles[i].inTree = treeMask[i];
    }

    // Mark trunk/stump area for a single, uniform block color.
    if (proceduralTreeMeta) {
      const { cx, trunkTopY, trunkBottomY, trunkTopW, trunkBottomW } = proceduralTreeMeta;
      for (let y = 0; y < rows; y++) {
        if (y < trunkTopY - 2 || y > trunkBottomY + 1) continue;
        const t = (y - trunkTopY) / Math.max(1, trunkBottomY - trunkTopY);
        const clamped = Math.max(0, Math.min(1, t));
        let halfW = trunkTopW * 0.6 + (trunkBottomW * 0.62 - trunkTopW * 0.6) * Math.pow(clamped, 1.45) + 0.7;
        if (clamped > 0.72) {
          halfW += (clamped - 0.72) * 6.5;
        }
        for (let x = 0; x < cols; x++) {
          if (Math.abs(x - cx) <= halfW) {
            const i = y * cols + x;
            trunkMask[i] = true;
            treeMask[i] = true;
          }
        }
      }
    }

    // Derive a crisp edge map so branches remain separated and readable.
    const edgeMask = new Array(count).fill(false);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!treeMask[i]) continue;
        let edge = false;
        for (let oy = -1; oy <= 1 && !edge; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = x + ox;
            const ny = y + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              edge = true;
              break;
            }
            if (!treeMask[ny * cols + nx]) {
              edge = true;
              break;
            }
          }
        }
        edgeMask[i] = edge;
      }
    }

    for (let i = 0; i < count; i++) {
      tiles[i].inTree = treeMask[i];
      tiles[i].isTreeEdge = edgeMask[i];
      tiles[i].isTrunk = trunkMask[i];
    }
  }

  function tryLoadTreeMaskImage() {
    const img = new Image();
    img.onload = () => {
      maskImage = img;
      maskImageReady = true;
      rebuildTreeMask();
      if (hashStream) scheduleBoardFlip();
    };
    img.onerror = () => {
      maskImage = null;
      maskImageReady = false;
      rebuildTreeMask();
      if (hashStream) scheduleBoardFlip();
    };
    img.src = "assets/tree-mask.svg";
  }

  function nextCharForIndex(i) {
    if (!hashStream) return " ";
    const ch = hashStream[(streamCursor + i) % hashStream.length];
    return ch === " " ? " " : ch;
  }

  function scheduleBoardFlip() {
    if (!hashStream) return;

    schemeIndex = (schemeIndex + 1) % PALETTES.length;

    const now = performance.now() + 100;
    const maxWaveIndex = Math.max(1, rows + cols - 2);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const t = tiles[i];
        if (!t) continue;

        const wave = ((r + c) / maxWaveIndex) * CONFIG.waveDurationMs;
        const jitter = (Math.random() - 0.5) * 160;

        t.next = nextCharForIndex(i);
        t.schemeNext = schemeIndex;
        t.flipStart = now + wave + jitter;
        t.isFlipping = true;
      }
    }

    streamCursor = (streamCursor + cols * 3) % hashStream.length;
    startAnimation();
  }

  function drawTile(x, y, tile, now) {
    let progress = 0;
    let active = false;

    if (tile.isFlipping && now >= tile.flipStart) {
      progress = Math.min(1, (now - tile.flipStart) / CONFIG.flipDurationMs);
      active = progress < 1;
      if (!active) {
        tile.isFlipping = false;
        tile.current = tile.next;
        tile.schemeCurrent = tile.schemeNext;
      }
    }

    const p = active ? progress : 0;
    const angle = p * Math.PI;
    const squashY = active ? Math.max(0.06, Math.abs(Math.cos(angle))) : 1;
    const lift = active ? Math.sin(angle) * CONFIG.liftPx : 0;
    const depth = active ? Math.sin(angle) * CONFIG.depthPx : 0;
    const showingNext = active && p >= 0.5;
    const glyph = showingNext ? tile.next : tile.current;

    const paletteIndex = active && p >= 0.5 ? tile.schemeNext : tile.schemeCurrent;
    const palette = PALETTES[paletteIndex];
    const targetBase = tile.inTree ? palette.tree : palette.bg;
    const wavePulse = active ? Math.sin(p * Math.PI) * 7 : 0;
    const edgeShift = tile.isTreeEdge && !tile.isTrunk ? (palette.tree < palette.bg ? -6 : 6) : 0;
    let base;
    if (tile.isTrunk) {
      // Solid stump/trunk color with no per-tile noise.
      base = palette.tree;
    } else {
      base = targetBase + edgeShift + wavePulse + (tile.toneSeed - 0.5) * 4;
    }
    base = Math.max(42, Math.min(240, Math.round(base)));

    const fy = y - lift;

    ctx.fillStyle = `rgb(${base}, ${base}, ${base})`;
    ctx.fillRect(x, fy, CONFIG.tileSize, CONFIG.tileSize);

    ctx.fillStyle = "rgba(255,255,255,0.24)";
    ctx.fillRect(x, fy, CONFIG.tileSize, 1);

    ctx.fillStyle = "rgba(0,0,0,0.11)";
    ctx.fillRect(x + CONFIG.tileSize - 1, fy, 1, CONFIG.tileSize);

    if (active) {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(x, fy, CONFIG.tileSize, Math.max(1, depth));

      ctx.fillStyle = "rgba(0,0,0,0.10)";
      ctx.fillRect(x, fy + CONFIG.tileSize - Math.max(1, depth), CONFIG.tileSize, Math.max(1, depth));
    }

    if (glyph !== " ") {
      const textInk = base > 150 ? "rgba(22,22,22,0.9)" : "rgba(248,248,248,0.88)";
      ctx.save();
      ctx.translate(x + CONFIG.tileSize / 2, fy + CONFIG.tileSize / 2);
      ctx.scale(1, squashY);
      ctx.fillStyle = textInk;
      ctx.font = `${Math.floor(CONFIG.tileSize * 0.7)}px "VT323", "Courier New", monospace`;
      ctx.fillText(glyph, 0, 0.4);
      ctx.restore();
    }

    return tile.isFlipping;
  }

  function startAnimation() {
    if (rafId) return;
    rafId = requestAnimationFrame(render);
  }

  function render(now) {
    ctx.fillStyle = CONFIG.background;
    ctx.fillRect(0, 0, width, height);

    let i = 0;
    let hasMotion = false;
    for (let r = 0; r < rows; r++) {
      const y = r * CONFIG.tileSize;
      for (let c = 0; c < cols; c++, i++) {
        if (drawTile(c * CONFIG.tileSize, y, tiles[i], now)) hasMotion = true;
      }
    }

    if (hasMotion) {
      rafId = requestAnimationFrame(render);
    } else {
      rafId = 0;
    }
  }

  async function refreshHashesAndFlip() {
    try {
      const hashes = await fetchLatestTransactionHashes();
      const liveStream = buildHashStream(hashes);
      if (liveStream) {
        hashStream = liveStream;
        console.info("[tx-board] LIVE hashes:", hashes.length, hashes[0]);
        scheduleBoardFlip();
      }
    } catch (err) {
      console.warn("[tx-board] no live update, keeping previous stream:", err?.message || err);
      if (hashStream) scheduleBoardFlip();
    }
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (hashStream) scheduleBoardFlip();
      startAnimation();
    }, 120);
  });

  tryLoadTreeMaskImage();
  resize();
  startAnimation();
  refreshHashesAndFlip();
  setInterval(refreshHashesAndFlip, CONFIG.refreshIntervalMs);
})();
