(() => {
  const canvas = document.getElementById("cubeBoard");
  const ctx = canvas.getContext("2d", { alpha: true });

  const ETHERSCAN_API_KEY = (window.ETHERSCAN_API_KEY || "").trim();
  const HEX = "0123456789abcdef";

  const state = {
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    width: 0,
    height: 0,
    tile: 20, // ~0.5 cm-ish visual size on common screens
    cols: 0,
    rows: 0,
    stream: "",
    cycle: 0,
    tiles: [],
    lastTs: performance.now(),
  };

  function randomTxId() {
    let out = "0x";
    for (let i = 0; i < 64; i += 1) out += HEX[Math.floor(Math.random() * HEX.length)];
    return out;
  }

  function mockTransactions(count = 320) {
    return Array.from({ length: count }, () => randomTxId());
  }

  function toStream(transactions) {
    if (!transactions.length) return mockTransactions(180).map((t) => t.slice(2)).join("");
    return transactions.map((t) => t.slice(2).toLowerCase()).join("");
  }

  function streamCharAt(index) {
    if (!state.stream.length) return ".";
    return state.stream[index % state.stream.length];
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function buildGrid() {
    const total = state.cols * state.rows;
    state.tiles = Array.from({ length: total }, (_, i) => ({
      i,
      row: Math.floor(i / state.cols),
      col: i % state.cols,
      char: streamCharAt(i * 7),
      nextChar: streamCharAt(i * 7 + 1),
      p: 1,
      delay: 0,
      duration: 2.2 + Math.random() * 2.4, // long flip window
      flipping: false,
      swapped: false,
      shadeJitter: Math.random() * 8 - 4,
    }));
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;
    state.tile = state.width > 1700 ? 22 : state.width > 1300 ? 21 : state.width > 1000 ? 20 : 18;

    state.cols = Math.ceil(state.width / state.tile) + 1;
    state.rows = Math.ceil(state.height / state.tile) + 1;

    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    buildGrid();
  }

  function queueGlobalFlip() {
    state.cycle += 1;
    const shift = (state.cycle * 131) % Math.max(state.stream.length, 1);

    for (let i = 0; i < state.tiles.length; i += 1) {
      const t = state.tiles[i];
      t.nextChar = streamCharAt(t.i * 11 + shift);

      t.p = 0;
      // all flip together, but with subtle spread for the "bit by bit reveal"
      t.delay = t.row * 0.004 + t.col * 0.0012 + Math.random() * 0.4;
      t.duration = 2.1 + Math.random() * 2.8;
      t.flipping = true;
      t.swapped = false;
    }
  }

  function update(dt) {
    for (let i = 0; i < state.tiles.length; i += 1) {
      const t = state.tiles[i];
      if (!t.flipping) continue;

      if (t.delay > 0) {
        t.delay -= dt;
        continue;
      }

      t.p = Math.min(1, t.p + dt / t.duration);

      if (!t.swapped && t.p >= 0.54) {
        t.char = t.nextChar;
        t.swapped = true;
      }

      if (t.p >= 1) {
        t.flipping = false;
        t.swapped = false;
      }
    }
  }

  function drawTile(tile) {
    const s = state.tile;
    const x = tile.col * s;
    const y = tile.row * s;

    const base = clamp(177 + tile.shadeJitter, 138, 230);

    // flat board tile base
    const topGray = clamp(base + 12, 145, 242);
    const bottomGray = clamp(base - 8, 120, 232);

    let faceX = x;
    let faceY = y;
    let faceW = s;
    let faceH = s;
    let visibleChar = tile.char;

    if (tile.flipping) {
      const e = easeInOutCubic(tile.p);
      const angle = e * Math.PI; // 0..180deg
      const sx = Math.max(0.06, Math.abs(Math.cos(angle)));
      const lift = Math.sin(e * Math.PI) * (s * 0.36); // pop up during flip
      const depth = Math.sin(e * Math.PI) * (s * 0.22);

      faceW = s * sx;
      faceX = x + (s - faceW) * 0.5;
      faceY = y - lift;
      visibleChar = angle < Math.PI * 0.5 ? tile.char : tile.nextChar;

      // pseudo cube side while flipping (3D only during rotation)
      if (depth > 0.6) {
        const sideShade = clamp(base - 30, 95, 210);
        const sideW = Math.max(1, depth);
        const sideX = angle < Math.PI * 0.5 ? faceX + faceW : faceX - sideW;
        ctx.fillStyle = `rgb(${sideShade}, ${sideShade}, ${sideShade})`;
        ctx.fillRect(sideX, faceY + 1, sideW, s - 2);
      }
    }

    // face split
    const half = faceH * 0.5;
    ctx.fillStyle = `rgb(${topGray}, ${topGray}, ${topGray})`;
    ctx.fillRect(faceX, faceY, faceW, half);

    ctx.fillStyle = `rgb(${bottomGray}, ${bottomGray}, ${bottomGray})`;
    ctx.fillRect(faceX, faceY + half, faceW, half);

    // tile border + seam
    ctx.strokeStyle = "rgba(12, 20, 30, 0.16)";
    ctx.lineWidth = 1;
    ctx.strokeRect(faceX + 0.5, faceY + 0.5, Math.max(1, faceW - 1), faceH - 1);

    ctx.strokeStyle = "rgba(12, 20, 30, 0.2)";
    ctx.beginPath();
    ctx.moveTo(faceX + 1, faceY + half + 0.5);
    ctx.lineTo(faceX + faceW - 1, faceY + half + 0.5);
    ctx.stroke();

    // pixel-ish character
    ctx.fillStyle = "rgba(20, 30, 42, 0.95)";
    ctx.font = `${Math.max(11, Math.floor(s * 0.72))}px "VT323", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(visibleChar, faceX + faceW * 0.5, faceY + s * 0.58);
  }

  function render() {
    ctx.clearRect(0, 0, state.width, state.height);
    for (let i = 0; i < state.tiles.length; i += 1) drawTile(state.tiles[i]);
  }

  async function fetchLatestTransactions(limit = 280) {
    if (!ETHERSCAN_API_KEY) throw new Error("No API key");

    const base = "https://api.etherscan.io/v2/api";

    const latestResp = await fetch(
      `${base}?chainid=1&module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
    );
    if (!latestResp.ok) throw new Error("latest block fetch failed");

    const latestJson = await latestResp.json();
    const latest = Number.parseInt(latestJson?.result, 16);
    if (!Number.isFinite(latest)) throw new Error("invalid latest block");

    const txs = [];
    for (let b = latest; b >= latest - 14 && txs.length < limit; b -= 1) {
      const tag = `0x${b.toString(16)}`;
      const blockResp = await fetch(
        `${base}?chainid=1&module=proxy&action=eth_getBlockByNumber&tag=${tag}&boolean=false&apikey=${ETHERSCAN_API_KEY}`
      );
      if (!blockResp.ok) continue;
      const blockJson = await blockResp.json();
      const list = blockJson?.result?.transactions;
      if (!Array.isArray(list)) continue;

      for (let i = 0; i < list.length && txs.length < limit; i += 1) {
        const v = list[i];
        if (typeof v === "string" && v.startsWith("0x")) txs.push(v);
      }
    }

    if (!txs.length) throw new Error("no tx data");
    return txs;
  }

  async function refreshBoardData() {
    let txs = [];
    try {
      txs = await fetchLatestTransactions(320);
    } catch {
      txs = mockTransactions(320);
    }

    state.stream = toStream(txs);
    queueGlobalFlip();
  }

  function tick(now) {
    const dt = Math.min((now - state.lastTs) / 1000, 0.05);
    state.lastTs = now;

    update(dt);
    render();

    requestAnimationFrame(tick);
  }

  window.addEventListener("resize", resize);

  state.stream = toStream(mockTransactions(320));
  resize();
  queueGlobalFlip();

  refreshBoardData();
  setInterval(refreshBoardData, 30_000);

  requestAnimationFrame(tick);
})();
