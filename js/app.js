// Engine: shows the location-select grid first, then — once a location is
// picked — loads that location's JSON, preloads every image, draws the
// current node's image through the dither shader (js/dither.js), and
// renders the right text box(es). No printer or item-select screen yet.

const LOCATIONS_INDEX_PATH = "data/locations-index.json";
const COMMON_ENDING_PATH = "data/common/ending.json";

const el = {
  loading: document.getElementById("loading"),

  locationSelect: document.getElementById("screen-location-select"),
  carouselTrack: document.getElementById("carousel-track"),
  carouselPrev: document.getElementById("carousel-prev"),
  carouselNext: document.getElementById("carousel-next"),
  carouselDescription: document.getElementById("carousel-description"),
  choosePathBtn: document.getElementById("choose-path-btn"),

  scene: document.getElementById("scene"),
  canvas: document.getElementById("scene-canvas"),

  boxLinear: document.getElementById("box-linear"),
  linearText: document.getElementById("linear-text"),
  linearBtn: document.getElementById("linear-continue"),

  boxLeft: document.getElementById("box-left"),
  leftText: document.getElementById("left-text"),
  leftBtn: document.getElementById("left-continue"),

  boxRight: document.getElementById("box-right"),
  rightText: document.getElementById("right-text"),
  rightBtn: document.getElementById("right-continue"),

  boxEnd: document.getElementById("box-end"),
  endText: document.getElementById("end-text"),
};

let story = null;
let currentId = null;
let ditherStarted = false;

// Keeps every loaded Image element around, keyed by src, so we're never
// re-fetching or re-decoding — render() just hands the already-loaded
// image straight to the shader as a texture.
const imageCache = {};

async function init() {
  try {
    const res = await fetch(LOCATIONS_INDEX_PATH);
    if (!res.ok) {
      throw new Error(`Could not load ${LOCATIONS_INDEX_PATH} — status ${res.status}.`);
    }
    const index = await res.json();

    el.loading.classList.add("hidden");
    setupCarousel(index.locations);
    el.locationSelect.classList.remove("hidden");
  } catch (err) {
    showFatalError(err);
  }
}

let carouselLocations = [];
let carouselIndex = 0;
let carouselCards = []; // { element, canvas, renderer, loaded }

function setupCarousel(locations) {
  carouselLocations = locations;
  carouselIndex = 0;
  carouselCards = [];
  el.carouselTrack.innerHTML = "";

  locations.forEach((loc) => {
    const card = document.createElement("div");
    card.className = "location-card";

    const canvas = document.createElement("canvas");
    canvas.className = "location-canvas";
    card.appendChild(canvas);

    const record = { element: card, canvas, renderer: null, loaded: false };

    const img = new Image();
    img.onload = () => {
      const renderer = DitherFactory.create();
      renderer.init(canvas);
      renderer.setImage(img);
      renderer.start();
      record.renderer = renderer;
      record.loaded = true;
    };
    img.onerror = () => {
      canvas.remove();
      const fallback = document.createElement("div");
      fallback.className = "fallback-label";
      fallback.textContent = loc.name;
      card.appendChild(fallback);
    };
    img.src = loc.thumbnail;

    card.onclick = () => {
      const idx = carouselLocations.indexOf(loc);
      if (idx !== carouselIndex) {
        carouselIndex = idx;
        updateCarousel();
      }
    };

    el.carouselTrack.appendChild(card);
    carouselCards.push(record);
  });

  el.carouselPrev.onclick = () => step(-1);
  el.carouselNext.onclick = () => step(1);
  el.choosePathBtn.onclick = () => startLocation(carouselLocations[carouselIndex]);

  updateCarousel();
}

function step(direction) {
  const len = carouselLocations.length;
  carouselIndex = (carouselIndex + direction + len) % len;
  updateCarousel();
}

function updateCarousel() {
  const len = carouselLocations.length;
  const spacing = 420;    // horizontal distance between adjacent cards, in px
  const rotation = 28;    // degrees each card angles away from center, suggesting a curve
  const depth = -180;     // how far back non-center cards sit, in px

  carouselCards.forEach((card, i) => {
    // Shortest signed distance from the centered card, wrapping around
    // (so it behaves like an actual rolodex loop, not a flat strip).
    let diff = i - carouselIndex;
    if (diff > len / 2) diff -= len;
    if (diff < -len / 2) diff += len;

    const abs = Math.abs(diff);
    const el2 = card.element;

    if (abs > 2) {
      el2.style.opacity = "0";
      el2.style.pointerEvents = "none";
      el2.style.transform = `translateX(${diff * spacing}px) translateZ(${depth}px) rotateY(${diff * rotation}deg) scale(0.6)`;
      return;
    }

    const scale = diff === 0 ? 1 : 1 - abs * 0.18;
    const opacity = diff === 0 ? 1 : 0.55 - abs * 0.15;
    const z = diff === 0 ? 0 : depth;

    el2.style.transform = `translateX(${diff * spacing}px) translateZ(${z}px) rotateY(${diff * rotation}deg) scale(${scale})`;
    el2.style.opacity = String(opacity);
    el2.style.zIndex = String(100 - abs);
    el2.style.pointerEvents = "auto";
    el2.classList.toggle("is-center", diff === 0);
  });

  const current = carouselLocations[carouselIndex];
  el.carouselDescription.textContent = current.description || "";
}

async function startLocation(loc) {
  try {
    el.locationSelect.classList.add("hidden");
    el.choosePathBtn.disabled = true;
    el.loading.classList.remove("hidden");

    const res = await fetch(loc.dataFile);
    if (!res.ok) {
      throw new Error(`Could not load ${loc.dataFile} — status ${res.status}. Has this location's data file been added yet?`);
    }
    story = await res.json();

    // Every location's path eventually hands off to this same shared
    // ending sequence — merge its nodes in under the "ending-*" ids so
    // any location's final node can just point at "ending-1".
    const endingRes = await fetch(COMMON_ENDING_PATH);
    if (!endingRes.ok) {
      throw new Error(`Could not load ${COMMON_ENDING_PATH} — status ${endingRes.status}.`);
    }
    const endingData = await endingRes.json();
    Object.assign(story.nodes, endingData.nodes);

    await preloadImages();

    currentId = story.start;
    el.loading.classList.add("hidden");
    el.scene.classList.remove("hidden");

    if (!ditherStarted) {
      Dither.init(el.canvas);
      Dither.start();
      ditherStarted = true;
    }

    render();
  } catch (err) {
    showFatalError(err);
  }
}

function showFatalError(err) {
  console.error("Startup failed:", err);
  el.loading.classList.remove("hidden");
  el.loading.innerHTML = `
    <p class="loading-title" style="color:#c96a4a;">Something went wrong</p>
    <p class="loading-progress" style="max-width:70vw;text-align:center;">${err.message}</p>
    <p class="loading-progress">(Check the browser console for the full error.)</p>
  `;
}

function preloadImages() {
  // Collect every unique image path referenced anywhere in the story
  // (node images + any gif overlays once those are added) so the browser
  // has them cached before the player can click anything.
  const paths = new Set();
  Object.values(story.nodes).forEach((node) => {
    if (node.image) paths.add(node.image);
    if (node.gif) paths.add(node.gif);
  });

  const list = Array.from(paths);
  let loaded = 0;

  const promises = list.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          imageCache[src] = img;
          loaded++;
          resolve();
        };
        img.src = src;
      })
  );

  return Promise.all(promises);
}

function hideAllBoxes() {
  el.boxLinear.classList.add("hidden");
  el.boxLeft.classList.add("hidden");
  el.boxRight.classList.add("hidden");
  el.boxEnd.classList.add("hidden");
}

function goTo(nextId) {
  currentId = nextId;
  render();
}

function render() {
  const node = story.nodes[currentId];
  if (!node) {
    console.error("Unknown node id:", currentId);
    return;
  }

  const cachedImage = imageCache[node.image];
  if (cachedImage) {
    Dither.setImage(cachedImage);
  } else {
    console.warn("Image not in cache, was it in the preload list?", node.image);
  }

  hideAllBoxes();

  if (node.type === "linear") {
    el.linearText.textContent = node.text;
    el.linearBtn.textContent = node.continueLabel || "Continue";
    el.boxLinear.classList.remove("hidden");
    el.linearBtn.onclick = () => goTo(node.next);

  } else if (node.type === "choice") {
    const [left, right] = node.choices;

    el.leftText.textContent = left.text;
    el.leftBtn.textContent = left.label || "Continue this way";
    el.boxLeft.classList.remove("hidden");
    el.leftBtn.onclick = () => goTo(left.next);

    el.rightText.textContent = right.text;
    el.rightBtn.textContent = right.label || "Continue this way";
    el.boxRight.classList.remove("hidden");
    el.rightBtn.onclick = () => goTo(right.next);

  } else if (node.type === "end") {
    el.endText.textContent = node.text;
    el.boxEnd.classList.remove("hidden");
  }
}

init();
