(() => {
  const COLS = 10;
  const ROWS = 20;
  const CELL = 30;

  const COLORS = {
    I: '#5cf2ff',
    J: '#5c7cff',
    L: '#ffab5c',
    O: '#ffe75c',
    S: '#5cff8a',
    T: '#c05cff',
    Z: '#ff5c6e',
  };

  const SHAPES = {
    I: [[0,1],[1,1],[2,1],[3,1]],
    J: [[0,0],[0,1],[1,1],[2,1]],
    L: [[2,0],[0,1],[1,1],[2,1]],
    O: [[1,0],[2,0],[1,1],[2,1]],
    S: [[1,0],[2,0],[0,1],[1,1]],
    T: [[1,0],[0,1],[1,1],[2,1]],
    Z: [[0,0],[1,0],[1,1],[2,1]],
  };

  const boardCanvas = document.getElementById('board');
  const ctx = boardCanvas.getContext('2d');
  const nextCanvas = document.getElementById('next');
  const nextCtx = nextCanvas.getContext('2d');
  const holdCanvas = document.getElementById('hold');
  const holdCtx = holdCanvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const linesEl = document.getElementById('lines');
  const levelEl = document.getElementById('level');
  const overlay = document.getElementById('overlay');
  const overlayTitle = document.getElementById('overlay-title');
  const overlayText = document.getElementById('overlay-text');
  const overlayBtn = document.getElementById('overlay-btn');

  let grid, current, queue, holdPiece, canHold;
  let score, lines, level;
  let dropInterval, dropTimer, running, gameOver;
  let animFrame;

  function emptyGrid() {
    return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  }

  function randomBag() {
    const keys = Object.keys(SHAPES);
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }
    return keys;
  }

  function makePiece(type) {
    return {
      type,
      cells: SHAPES[type].map(([x, y]) => ({ x, y })),
      x: 3,
      y: -1,
    };
  }

  function refillQueue() {
    if (queue.length < 7) queue.push(...randomBag());
  }

  function spawnPiece() {
    refillQueue();
    const type = queue.shift();
    current = makePiece(type);
    current.y = -getTopOffset(current);
    canHold = true;
    if (collides(current, 0, 0)) {
      endGame();
    }
  }

  function getTopOffset(piece) {
    return Math.min(...piece.cells.map(c => c.y));
  }

  function collides(piece, dx, dy, cells = piece.cells) {
    return cells.some(c => {
      const x = piece.x + c.x + dx;
      const y = piece.y + c.y + dy;
      if (x < 0 || x >= COLS || y >= ROWS) return true;
      if (y < 0) return false;
      return grid[y][x] !== null;
    });
  }

  function rotateCells(cells) {
    if (current.type === 'O') return cells.map(c => ({ ...c }));
    const cx = 1.5, cy = 1.5;
    return cells.map(({ x, y }) => ({
      x: Math.round(cy - y + (cx - 1.5)),
      y: Math.round(x - cx + cy - 0.5),
    }));
  }

  function tryRotate() {
    const rotated = rotateCells(current.cells);
    const kicks = [0, -1, 1, -2, 2];
    for (const k of kicks) {
      if (!collides(current, k, 0, rotated)) {
        current.cells = rotated;
        current.x += k;
        return;
      }
    }
  }

  function lockPiece() {
    current.cells.forEach(c => {
      const x = current.x + c.x;
      const y = current.y + c.y;
      if (y >= 0) grid[y][x] = COLORS[current.type];
    });
    clearLines();
    spawnPiece();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every(cell => cell !== null)) {
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(null));
        cleared++;
        y++;
      }
    }
    if (cleared > 0) {
      const points = [0, 100, 300, 500, 800][cleared] * level;
      score += points;
      lines += cleared;
      level = 1 + Math.floor(lines / 10);
      dropInterval = Math.max(100, 1000 - (level - 1) * 80);
      updateStats();
    }
  }

  function updateStats() {
    scoreEl.textContent = score;
    linesEl.textContent = lines;
    levelEl.textContent = level;
  }

  function move(dx) {
    if (!collides(current, dx, 0)) current.x += dx;
  }

  function gravityDrop() {
    if (!collides(current, 0, 1)) {
      current.y += 1;
      return true;
    }
    lockPiece();
    return false;
  }

  function softDrop() {
    if (!collides(current, 0, 1)) {
      current.y += 1;
      score += 1;
      updateStats();
      return true;
    }
    lockPiece();
    return false;
  }

  function hardDrop() {
    let dist = 0;
    while (!collides(current, 0, dist + 1)) dist++;
    current.y += dist;
    score += dist * 2;
    updateStats();
    lockPiece();
  }

  function holdSwap() {
    if (!canHold) return;
    canHold = false;
    if (holdPiece) {
      const temp = holdPiece;
      holdPiece = current.type;
      current = makePiece(temp);
      current.y = -getTopOffset(current);
    } else {
      holdPiece = current.type;
      spawnPiece();
    }
  }

  function ghostY() {
    let dist = 0;
    while (!collides(current, 0, dist + 1)) dist++;
    return current.y + dist;
  }

  function drawCell(context, x, y, color, size = CELL, alpha = 1) {
    context.save();
    context.globalAlpha = alpha;
    const grad = context.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, color);
    grad.addColorStop(1, shade(color, -25));
    context.fillStyle = grad;
    context.fillRect(x + 1, y + 1, size - 2, size - 2);
    context.strokeStyle = 'rgba(255,255,255,0.25)';
    context.lineWidth = 1;
    context.strokeRect(x + 1.5, y + 1.5, size - 3, size - 3);
    context.restore();
  }

  function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  }

  function draw() {
    ctx.clearRect(0, 0, boardCanvas.width, boardCanvas.height);

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(COLS * CELL, y * CELL);
      ctx.stroke();
    }

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x]) drawCell(ctx, x * CELL, y * CELL, grid[y][x]);
      }
    }

    if (current) {
      const gy = ghostY();
      current.cells.forEach(c => {
        const x = (current.x + c.x) * CELL;
        const y = (gy + c.y) * CELL;
        if (gy + c.y >= 0) drawCell(ctx, x, y, COLORS[current.type], CELL, 0.18);
      });
      current.cells.forEach(c => {
        const x = (current.x + c.x) * CELL;
        const y = (current.y + c.y) * CELL;
        if (current.y + c.y >= 0) drawCell(ctx, x, y, COLORS[current.type]);
      });
    }

    drawPreview(nextCtx, nextCanvas, queue.slice(0, 3));
    drawPreview(holdCtx, holdCanvas, holdPiece ? [holdPiece] : []);
  }

  function drawPreview(context, canvas, types) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const size = 18;
    types.forEach((type, i) => {
      const cells = SHAPES[type];
      const minX = Math.min(...cells.map(c => c[0]));
      const maxX = Math.max(...cells.map(c => c[0]));
      const minY = Math.min(...cells.map(c => c[1]));
      const maxY = Math.max(...cells.map(c => c[1]));
      const w = (maxX - minX + 1) * size;
      const h = (maxY - minY + 1) * size;
      const offsetX = (canvas.width - w) / 2;
      const offsetY = i * (canvas.width) + (canvas.width - h) / 2 - minY * size;
      cells.forEach(([cx, cy]) => {
        drawCell(
          context,
          offsetX + (cx - minX) * size,
          offsetY + (cy - minY) * size,
          COLORS[type],
          size
        );
      });
    });
  }

  function loop(timestamp) {
    if (!running) return;
    if (!dropTimer) dropTimer = timestamp;
    const delta = timestamp - dropTimer;
    if (delta > dropInterval) {
      gravityDrop();
      dropTimer = timestamp;
    }
    draw();
    animFrame = requestAnimationFrame(loop);
  }

  function startGame() {
    grid = emptyGrid();
    queue = [];
    holdPiece = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    dropInterval = 1000;
    dropTimer = null;
    gameOver = false;
    updateStats();
    spawnPiece();
    overlay.classList.add('hidden');
    running = true;
    cancelAnimationFrame(animFrame);
    animFrame = requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    gameOver = true;
    overlayTitle.textContent = 'Игра окончена';
    overlayText.textContent = `Счёт: ${score} · Линии: ${lines}`;
    overlayBtn.textContent = 'Играть снова';
    overlay.classList.remove('hidden');
  }

  function togglePause() {
    if (gameOver) return;
    running = !running;
    if (running) {
      dropTimer = null;
      overlay.classList.add('hidden');
      animFrame = requestAnimationFrame(loop);
    } else {
      overlayTitle.textContent = 'Пауза';
      overlayText.textContent = 'Нажмите, чтобы продолжить';
      overlayBtn.textContent = 'Продолжить';
      overlay.classList.remove('hidden');
    }
  }

  overlayBtn.addEventListener('click', () => {
    if (gameOver || !current) startGame();
    else togglePause();
  });

  document.addEventListener('keydown', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) {
      e.preventDefault();
    }
    if (!running) {
      if (e.key === 'Enter') startGame();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft': move(-1); break;
      case 'ArrowRight': move(1); break;
      case 'ArrowUp': tryRotate(); break;
      case 'ArrowDown': softDrop(); break;
      case ' ': hardDrop(); break;
      case 'c': case 'C': holdSwap(); break;
      case 'p': case 'P': togglePause(); break;
    }
  });

  document.querySelectorAll('.mobile-controls button').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!running) return;
      switch (btn.dataset.action) {
        case 'left': move(-1); break;
        case 'right': move(1); break;
        case 'rotate': tryRotate(); break;
        case 'down': softDrop(); break;
        case 'drop': hardDrop(); break;
        case 'hold': holdSwap(); break;
      }
    });
  });

  grid = emptyGrid();
  queue = [];
  draw();
})();
