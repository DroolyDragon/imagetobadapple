const canvas = document.getElementById("scene");
const ctx = canvas.getContext("2d");

const video = document.getElementById("badAppleVideo");
const audio = document.getElementById("badAppleAudio");
const fileInput = document.getElementById("imageInput");

// Offscreen canvases
const imageCanvas = document.createElement("canvas");
const imageCtx = imageCanvas.getContext("2d");

const videoCanvas = document.createElement("canvas");
const videoCtx = videoCanvas.getContext("2d");

let width = window.innerWidth;
let height = window.innerHeight;

canvas.width = width;
canvas.height = height;

// Particle/grid configuration
let gridStep = 4; // pixels between samples
let gridCols = 0;
let gridRows = 0;

let particles = [];
let hasImage = false;
let videoReady = false;
let lastVideoSample = 0;
const videoSampleInterval = 1000 / 24; // ~24 fps

window.addEventListener("resize", () => {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = width;
  canvas.height = height;
});

// Particle class
class Particle {
  constructor(x, y, color, gridX, gridY) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.tx = x;
    this.ty = y;
    this.alpha = 1;
    this.targetAlpha = 1;
    this.color = color;
    this.gridX = gridX;
    this.gridY = gridY;
  }

  update(dt) {
    const ease = 0.18;
    this.x += (this.tx - this.x) * ease;
    this.y += (this.ty - this.y) * ease;

    this.alpha += (this.targetAlpha - this.alpha) * 0.2;
  }

  draw(ctx) {
    if (this.alpha <= 0.02) return;
    ctx.globalAlpha = this.alpha;
    ctx.fillStyle = this.color;
    ctx.fillRect(this.x, this.y, gridStep, gridStep);
  }
}

// Load user image and initialize particle field
fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    setupFromImage(img);
    startVideo();
  };
  img.src = URL.createObjectURL(file);
});

function setupFromImage(img) {
  // Fit image into screen while preserving aspect ratio
  const scale = Math.min(width / img.width, height / img.height);
  const drawW = img.width * scale;
  const drawH = img.height * scale;
  const offsetX = (width - drawW) / 2;
  const offsetY = (height - drawH) / 2;

  imageCanvas.width = width;
  imageCanvas.height = height;
  imageCtx.clearRect(0, 0, width, height);
  imageCtx.drawImage(img, offsetX, offsetY, drawW, drawH);

  // Determine grid resolution based on screen size
  const baseStep = Math.max(3, Math.floor(Math.min(width, height) / 150));
  gridStep = baseStep;

  gridCols = Math.floor(width / gridStep);
  gridRows = Math.floor(height / gridStep);

  particles = [];
  const imgData = imageCtx.getImageData(0, 0, width, height).data;

  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      const x = gx * gridStep;
      const y = gy * gridStep;
      const idx = (y * width + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const a = imgData[idx + 3];

      const color = `rgb(${r},${g},${b})`;
      // Start particles slightly jittered from their grid position
      const jitter = gridStep * 4;
      const startX = x + (Math.random() - 0.5) * jitter;
      const startY = y + (Math.random() - 0.5) * jitter;

      const p = new Particle(startX, startY, color, x, y);
      // Use image alpha so transparent areas start mostly hidden
      const alpha = a / 255;
      p.alpha = alpha;
      p.targetAlpha = alpha;
      particles.push(p);
    }
  }

  setupVideoCanvas();
  hasImage = true;
}

function setupVideoCanvas() {
  if (!video.videoWidth || !video.videoHeight) {
    // Will be called again when metadata loads
    return;
  }

  // Match the particle grid to a scaled version of the video
  videoCanvas.width = gridCols;
  videoCanvas.height = gridRows;
}

function startVideo() {
  if (!videoReady) return;

  // Sync audio with video start
  const videoPromise = video.play();
  if (videoPromise && videoPromise.catch) {
    videoPromise.catch(() => {});
  }

  const audioPromise = audio.play();
  if (audioPromise && audioPromise.catch) {
    audioPromise.catch(() => {});
  }
}

// Video ready handling
video.addEventListener("loadedmetadata", () => {
  videoReady = true;
  setupVideoCanvas();
});

video.addEventListener("canplay", () => {
  videoReady = true;
  if (hasImage) startVideo();
});

// Main animation loop
let lastTime = performance.now();

function loop(now) {
  const dt = now - lastTime;
  lastTime = now;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  if (hasImage) {
    if (videoReady) {
      if (now - lastVideoSample >= videoSampleInterval) {
        sampleVideoToTargets();
        lastVideoSample = now;
      }
    }

    for (const p of particles) {
      p.update(dt);
      p.draw(ctx);
    }
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Map video brightness to particle targets
function sampleVideoToTargets() {
  if (!videoReady || !gridCols || !gridRows || !particles.length) return;

  // Draw current video frame to small canvas matching grid
  videoCtx.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
  const vData = videoCtx.getImageData(
    0,
    0,
    videoCanvas.width,
    videoCanvas.height
  ).data;

  const threshold = 180; // brightness threshold between black/white

  // We assume particles are ordered scanline-wise by creation
  let pIndex = 0;
  for (let gy = 0; gy < gridRows; gy++) {
    for (let gx = 0; gx < gridCols; gx++) {
      if (pIndex >= particles.length) return;
      const p = particles[pIndex];

      const idx = (gy * gridCols + gx) * 4;
      const r = vData[idx];
      const g = vData[idx + 1];
      const b = vData[idx + 2];

      const brightness = (r + g + b) / 3;

      // Dark = part of silhouette: move into grid position
      if (brightness < threshold) {
        p.tx = p.gridX;
        p.ty = p.gridY;
        p.targetAlpha = 1;
      } else {
        // Light = move off-screen downward, fade
        p.tx = p.gridX;
        p.ty = p.gridY + height * 0.8;
        p.targetAlpha = 0;
      }

      pIndex++;
    }
  }
}