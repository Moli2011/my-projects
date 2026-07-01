import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest";

const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm";
const MAX_WIDTH = 640;
const PHI = 1.618;

// Stable MediaPipe FaceMesh landmark indices used for measurement.
// A/B naming avoids anatomical left/right confusion; on-screen side is resolved by x position.
const IDX = {
  foreheadTop: 10,
  nasion: 168,
  noseTip: 1,
  noseBase: 2,
  chin: 152,
  eyeAOuter: 33,
  eyeAInner: 133,
  eyeBInner: 362,
  eyeBOuter: 263,
  mouthA: 61,
  mouthB: 291,
  faceEdgeA: 234,
  faceEdgeB: 454,
};

const dropzone = document.getElementById("dropzone");
const dropzoneContent = document.getElementById("dropzoneContent");
const fileInput = document.getElementById("fileInput");
const browseBtn = document.getElementById("browseBtn");
const cameraBtn = document.getElementById("cameraBtn");
const cameraWrap = document.getElementById("cameraWrap");
const video = document.getElementById("video");
const captureBtn = document.getElementById("captureBtn");
const cancelCameraBtn = document.getElementById("cancelCameraBtn");
const canvasWrap = document.getElementById("canvasWrap");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const resetBtn = document.getElementById("resetBtn");
const statusEl = document.getElementById("status");
const togglesCard = document.getElementById("togglesCard");
const statsCard = document.getElementById("statsCard");
const statsList = document.getElementById("statsList");
const toggleMesh = document.getElementById("toggleMesh");
const toggleAxis = document.getElementById("toggleAxis");
const toggleThirds = document.getElementById("toggleThirds");
const toggleFifths = document.getElementById("toggleFifths");

let landmarkerPromise = null;
let currentLandmarks = null;
let currentImage = null;
let cameraStream = null;

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "IMAGE",
        numFaces: 1,
      });
    })();
  }
  return landmarkerPromise;
}

function setStatus(text) {
  statusEl.textContent = text || "";
}

function showDropzone() {
  dropzone.classList.remove("hidden");
  canvasWrap.classList.add("hidden");
  cameraWrap.classList.add("hidden");
  togglesCard.style.display = "none";
  statsCard.style.display = "none";
  currentLandmarks = null;
  currentImage = null;
  setStatus("");
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toPx(landmark, w, h) {
  return { x: landmark.x * w, y: landmark.y * h };
}

async function loadImageFromFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });
  return img;
}

async function processSource(source, naturalW, naturalH) {
  dropzone.classList.add("hidden");
  cameraWrap.classList.add("hidden");
  canvasWrap.classList.remove("hidden");
  setStatus("Загружаю модель распознавания лиц…");

  let landmarker;
  try {
    landmarker = await getLandmarker();
  } catch (err) {
    setStatus("Не удалось загрузить модель. Проверьте подключение к интернету.");
    return;
  }

  const scale = Math.min(1, MAX_WIDTH / naturalW);
  canvas.width = Math.round(naturalW * scale);
  canvas.height = Math.round(naturalH * scale);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

  setStatus("Ищу лицо на фото…");

  let result;
  try {
    result = landmarker.detect(source);
  } catch (err) {
    setStatus("Не удалось обработать изображение.");
    return;
  }

  if (!result.faceLandmarks || result.faceLandmarks.length === 0) {
    setStatus("Лицо не найдено. Попробуйте фото анфас с хорошим освещением.");
    return;
  }

  currentLandmarks = result.faceLandmarks[0];
  currentImage = source;
  setStatus("");
  togglesCard.style.display = "block";
  statsCard.style.display = "block";
  render();
}

function buildGeometry() {
  const w = canvas.width;
  const h = canvas.height;
  const P = {};
  for (const key in IDX) {
    P[key] = toPx(currentLandmarks[IDX[key]], w, h);
  }

  const axisX = (P.foreheadTop.x + P.nasion.x + P.noseTip.x + P.noseBase.x + P.chin.x) / 5;

  const faceLeftX = Math.min(P.faceEdgeA.x, P.faceEdgeB.x);
  const faceRightX = Math.max(P.faceEdgeA.x, P.faceEdgeB.x);
  const faceWidth = faceRightX - faceLeftX;
  const faceTop = P.foreheadTop.y;
  const faceBottom = P.chin.y;
  const faceHeight = faceBottom - faceTop;

  const thirds = [
    { label: "Лоб → переносица", from: P.foreheadTop.y, to: P.nasion.y },
    { label: "Переносица → основание носа", from: P.nasion.y, to: P.noseBase.y },
    { label: "Основание носа → подбородок", from: P.noseBase.y, to: P.chin.y },
  ];

  const eyeAWidth = dist(P.eyeAOuter, P.eyeAInner);
  const eyeBWidth = dist(P.eyeBInner, P.eyeBOuter);
  const eyeWidthAvg = (eyeAWidth + eyeBWidth) / 2;

  const pairs = [
    { label: "Внешние уголки глаз", a: P.eyeAOuter, b: P.eyeBOuter },
    { label: "Внутренние уголки глаз", a: P.eyeAInner, b: P.eyeBInner },
    { label: "Уголки рта", a: P.mouthA, b: P.mouthB },
    { label: "Края лица", a: P.faceEdgeA, b: P.faceEdgeB },
  ];

  return { P, axisX, faceLeftX, faceRightX, faceWidth, faceTop, faceBottom, faceHeight, thirds, eyeWidthAvg, pairs };
}

function drawOverlays(geo) {
  const w = canvas.width;

  if (toggleMesh.checked) {
    ctx.fillStyle = "rgba(255, 214, 51, 0.55)";
    for (const lm of currentLandmarks) {
      ctx.beginPath();
      ctx.arc(lm.x * w, lm.y * canvas.height, 1.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (toggleAxis.checked) {
    ctx.strokeStyle = "#ffd633";
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(geo.axisX, geo.faceTop - 20);
    ctx.lineTo(geo.axisX, geo.faceBottom + 10);
    ctx.stroke();
  }

  if (toggleThirds.checked) {
    ctx.strokeStyle = "rgba(255, 214, 51, 0.8)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.2;
    const ys = [geo.faceTop, geo.P.nasion.y, geo.P.noseBase.y, geo.faceBottom];
    for (const y of ys) {
      ctx.beginPath();
      ctx.moveTo(geo.faceLeftX - 10, y);
      ctx.lineTo(geo.faceRightX + 10, y);
      ctx.stroke();
    }
  }

  if (toggleFifths.checked) {
    ctx.strokeStyle = "rgba(255, 179, 0, 0.8)";
    ctx.setLineDash([2, 4]);
    ctx.lineWidth = 1;
    let x = geo.faceLeftX;
    while (x <= geo.faceRightX + 1) {
      ctx.beginPath();
      ctx.moveTo(x, geo.faceTop - 10);
      ctx.lineTo(x, geo.faceBottom + 10);
      ctx.stroke();
      x += geo.eyeWidthAvg;
    }
  }

  ctx.setLineDash([]);
}

function statRow(label, value) {
  const row = document.createElement("div");
  row.className = "stat-row";
  const l = document.createElement("span");
  l.className = "label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "value";
  v.textContent = value;
  row.append(l, v);
  return row;
}

function groupTitle(text) {
  const el = document.createElement("div");
  el.className = "stat-group-title";
  el.textContent = text;
  return el;
}

function renderStats(geo) {
  statsList.innerHTML = "";

  statsList.append(groupTitle("Общие размеры"));
  statsList.append(statRow("Ширина лица", `${geo.faceWidth.toFixed(0)} px`));
  statsList.append(statRow("Высота лица", `${geo.faceHeight.toFixed(0)} px`));
  const hwRatio = geo.faceHeight / geo.faceWidth;
  statsList.append(statRow("Высота / ширина", `${hwRatio.toFixed(2)} (φ ≈ ${PHI})`));

  statsList.append(groupTitle("Правило третей (по вертикали)"));
  for (const t of geo.thirds) {
    const pct = (((t.to - t.from) / geo.faceHeight) * 100).toFixed(1);
    statsList.append(statRow(t.label, `${pct}% (канон ≈ 33.3%)`));
  }

  statsList.append(groupTitle("Правило пятых (по горизонтали)"));
  const fifthsRatio = geo.faceWidth / geo.eyeWidthAvg;
  statsList.append(statRow("Ширина лица / ширина глаза", `${fifthsRatio.toFixed(2)} (канон ≈ 5.0)`));

  statsList.append(groupTitle("Симметрия относительно оси"));
  for (const p of geo.pairs) {
    const distA = Math.abs(p.a.x - geo.axisX);
    const distB = Math.abs(p.b.x - geo.axisX);
    const asym = Math.abs(distA - distB);
    const pctOfFace = ((asym / geo.faceWidth) * 100).toFixed(1);
    statsList.append(statRow(p.label, `Δ ${asym.toFixed(1)} px (${pctOfFace}% ширины лица)`));
  }
}

function render() {
  if (!currentLandmarks) return;
  ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
  const geo = buildGeometry();
  drawOverlays(geo);
  renderStats(geo);
}

[toggleMesh, toggleAxis, toggleThirds, toggleFifths].forEach((el) =>
  el.addEventListener("change", render)
);

browseBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  fileInput.click();
});

dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  const img = await loadImageFromFile(file);
  processSource(img, img.naturalWidth, img.naturalHeight);
  fileInput.value = "";
});

["dragover", "dragenter"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  })
);

["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  })
);

dropzone.addEventListener("drop", async (e) => {
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith("image/")) return;
  const img = await loadImageFromFile(file);
  processSource(img, img.naturalWidth, img.naturalHeight);
});

cameraBtn.addEventListener("click", async (e) => {
  e.stopPropagation();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
  } catch (err) {
    setStatus("Не удалось получить доступ к камере.");
    return;
  }
  video.srcObject = cameraStream;
  dropzone.classList.add("hidden");
  cameraWrap.classList.remove("hidden");
});

cancelCameraBtn.addEventListener("click", () => {
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraWrap.classList.add("hidden");
  dropzone.classList.remove("hidden");
});

captureBtn.addEventListener("click", () => {
  const temp = document.createElement("canvas");
  temp.width = video.videoWidth;
  temp.height = video.videoHeight;
  const tctx = temp.getContext("2d");
  tctx.translate(temp.width, 0);
  tctx.scale(-1, 1);
  tctx.drawImage(video, 0, 0, temp.width, temp.height);
  if (cameraStream) cameraStream.getTracks().forEach((t) => t.stop());
  cameraWrap.classList.add("hidden");
  processSource(temp, temp.width, temp.height);
});

resetBtn.addEventListener("click", showDropzone);
