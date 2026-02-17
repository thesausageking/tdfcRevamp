(() => {
  const canvas = document.getElementById("txBoard");
  const ctx = canvas.getContext("2d", { alpha: true });

  const ETHERSCAN_API_KEY = (window.ETHERSCAN_API_KEY || "").trim();
  const HEX_CHARS = "0123456789abcdef";

  const state = {
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    width: 0,
    height: 0,
    tile: 18, // about ~0.5cm visual scale on many displays
    cols: 0,
    rows: 0,
    tiles: [],
    stream: "",
    streamShift: 0,
    lastTs: performance.now(),
  };

  function randomHexId() {
    let out = "0x";
    for (let i = 0; i < 64; i += 1) {
      out += HEX_CHARS[Math.floor(Math.random() * HEX_CHARS.length)];
    }
    return out;
  }

  function generateMockTransactions(count = 200) {
    const txs = [];
    for (let i = 0; i < count; i += 1) txs.push(randomHexId());
    return txs;
  }

  function toStream(transactions) {
    if (!transactions.length) return generateMockTransactions(120).join(" ");
    return transactions.map((tx) => tx.toLowerCase()).join(" ");
  }

  function charAtStream(index) {
    if (!state.stream || state.stream.length === 0) return ".";
    return state.stream[(index + state.streamShift) % state.stream.length];
  }

  function resize() {
    state.width = window.innerWidth;
    state.height = window.innerHeight;

    state.tile =
      state.width > 1700 ? 20 : state.width > 1300 ? 19 : state.width > 1000 ? 18 : 16;

    state.cols = Math.ceil(state.width / state.tile);
    state.rows = Math.ceil(state.height / state.tile);

    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    canvas.style.width = `${state.width}px`;
    canvas.style.height = `${state.height}px`;

    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    const total = state.cols * state.rows;
    const nextTiles = [];

    for (let i = 0; i < total; i += 1) {
      const prev = state.tiles[i];
      nextTiles.push(
        prev || {
          char: charAtStream(i),
          fromChar: ".",
          targetChar: ".",
          flip: 0,
          flipping: false,
          delay: 0,
          speed: 2.4 + Math.random() * 1.8,
          shadeBias: Math.random() * 10 - 5,
          tint: 0,
          changed: false,
        }
      );
    }

    state.tiles = nextTiles;
  }

  async function fetchLatestTransactions(limit = 180) {
    if (!ETHERSCAN_API_KEY) throw new Error("No Etherscan key");

    const base = "https://api.etherscan.io/v2/api";

    const latestResp = await fetch(
      `${base}?chainid=1&module=proxy&action=eth_blockNumber&apikey=${ETHERSCAN_API_KEY}`
    );
    if (!latestResp.ok) throw new Error("Failed latest block fetch");

    const latestJson = await latestResp.json();
    const latestHex = latestJson?.result;
    if (!latestHex) throw new Error("No latest block result");

    const latest = Number.parseInt(latestHex, 16);
    if (!Number.isFinite(latest)) throw new Error("Invalid latest block");

    const out = [];

    for (let b = latest; b >= latest - 10 && out.length < limit; b -= 1) {
      const tag = `0x${b.toString(16)}`;
      const blockResp = await fetch(
        `${base}?chainid=1&module=proxy&action=eth_getBlockByNumber&tag=${tag}&boolean=false&apikey=${ETHERSCAN_API_KEY}`
      );
      if (!blockResp.ok) continue;

      const blockJson = await blockResp.json();
      const txs = blockJson?.result?.transactions;
      if (Array.isArray(txs)) {
        for (let i = 0; i < txs.length && out.length < limit; i += 1) {
          if (typeof txs[i] === "string" && txs[i].startsWith("0x")) out.push(txs[i]);
        }
      }
    }

    if (!out.length) throw new Error("No tx data");
    return out;
  }

  function queueBoardUpdate() {
    state.streamShift = (state.streamShift + 17) % Math.max(state.stream.length, 1);

    for (let i = 0; i < state.tiles.length; i += 1) {
      const tile = state.tiles[i];
      const nextChar = charAtStream(i);

      if (tile.char === nextChar) continue;

      tile.fromChar = tile.char;
      tile.targetChar = nextChar;
      tile.flip = 0;
      tile.flipping = false;
      tile.changed = true;

      const row = Math.floor(i / state.cols);
      const col = i % state.cols;
      tile.delay = row * 0.006 + col * 0.0015 + Math.random() * 0.6;
      tile.tint = 1;
    }
  }

  function triggerTickerWave() {
    if (!state.tiles.length || !state.stream) return;

    const targetRow = Math.floor(Math.random() * state.rows);
    const baseShift = Math.floor(Math.random() * 50);

    for (let col = 0; col < state.cols; col += 1) {
      const idx = targetRow * state.cols + col;
      const tile = state.tiles[idx];
      if (!tile) continue;

      const nextChar = state.stream[(idx + state.streamShift + baseShift) % state.stream.length];
      if (!nextChar || nextChar === tile.char) continue;

      tile.fromChar = tile.char;
      tile.targetChar = nextChar;
      tile.flip = 0;
      tile.flipping = false;
      tile.changed = true;
      tile.delay = col * 0.01 + Math.random() * 0.08;
      tile.tint = 1;
    }
  }

  function update(dt) {
    for (let i = 0; i < state.tiles.length; i += 1) {
      const tile = state.tiles[i];

      tile.tint *= 0.92;

      if (!tile.changed) continue;

      if (tile.delay > 0) {
        tile.delay -= dt;
        continue;
      }

      if (!tile.flipping) {
        tile.flipping = true;
      }

      tile.flip += dt * tile.speed;

      if (tile.flip >= 0.5 && tile.char !== tile.targetChar) {
        tile.char = tile.targetChar;
      }

      if (tile.flip >= 1) {
        tile.flip = 0;
        tile.flipping = false;
        tile.changed = false;
      }
    }
  }

  function drawTile(x, y, tile) {
    const s = state.tile;
    const half = s * 0.5;

    const base = 226 + tile.shadeBias + tile.tint * 8;
    const topGray = Math.max(178, Math.min(246, base + 6));
    const botGray = Math.max(165, Math.min(238, base - 7));

    ctx.fillStyle = `rgb(${topGray}, ${topGray}, ${topGray})`;
    ctx.fillRect(x, y, s, half);

    ctx.fillStyle = `rgb(${botGray}, ${botGray}, ${botGray})`;
    ctx.fillRect(x, y + half, s, half);

    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, s - 1, s - 1);

    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.moveTo(x + 1, y + half + 0.5);
    ctx.lineTo(x + s - 1, y + half + 0.5);
    ctx.stroke();

    const shown = tile.flipping && tile.flip < 0.5 ? tile.fromChar : tile.targetChar || tile.char;
    const scaleY = tile.flipping ? Math.max(0.08, Math.abs(Math.cos(tile.flip * Math.PI))) : 1;

    ctx.save();
    ctx.translate(x + s * 0.5, y + s * 0.58);
    ctx.scale(1, scaleY);
    ctx.fillStyle = "#1f2833";
    ctx.font = `${Math.floor(s * 0.74)}px "VT323", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shown, 0, 0);
    ctx.restore();
  }

  function render() {
    ctx.clearRect(0, 0, state.width, state.height);

    for (let row = 0; row < state.rows; row += 1) {
      for (let col = 0; col < state.cols; col += 1) {
        const idx = row * state.cols + col;
        drawTile(col * state.tile, row * state.tile, state.tiles[idx]);
      }
    }
  }

  async function refreshTransactions() {
    let txs = [];
    try {
      txs = await fetchLatestTransactions(220);
    } catch {
      txs = generateMockTransactions(220);
    }

    state.stream = toStream(txs);
    queueBoardUpdate();
  }

  function loop(ts) {
    const dt = Math.min((ts - state.lastTs) / 1000, 0.05);
    state.lastTs = ts;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  window.addEventListener("resize", resize);

  resize();
  state.stream = toStream(generateMockTransactions(220));
  queueBoardUpdate();

  refreshTransactions();
  setInterval(refreshTransactions, 30_000);
  setInterval(triggerTickerWave, 3_500);

  requestAnimationFrame(loop);
})();
