// Engine: shows the location-select carousel first, then, once a location
// is picked, loads that location's JSON, preloads every image, draws the
// current node's image through the dither shader (js/dither.js), and
// renders the right text box(es). No printer screen yet.

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

const imageCache = {};

async function init() {
  try {
    const res = await fetch(LOCATIONS_INDEX_PATH);
    if (!res.ok) {
      throw new Error(`Could not load ${LOCATIONS_INDEX_PATH} — status ${res.status}.`);
    }
    const index = await res.json();

    el.loading.classList.add("hidden");
    el.locationSelect.classList.remove("hidden");
    setupCarousel(index.locations);
  } catch (err) {
    showFatalError(err);
  }
}

let carouselLocations = [];
let carouselIndex = 0;
let carouselCards = []; // { element, canvas, renderer, loaded }
let carouselRadius = 0;
let carouselAngleStep = 0;

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

  // Arrange every card as one face of a regular polygon (a hexagon, with
  // 6 locations) — this is a fixed placement set once. Only the track
  // itself rotates afterward; individual cards never move on their own,
  // which is what makes side faces show their true angle instead of
  // always tilting to face the viewer.
  const len = carouselLocations.length;
  carouselAngleStep = 360 / len;
  const cardWidth = carouselCards[0].element.getBoundingClientRect().width;
  carouselRadius = (cardWidth / 2) / Math.tan(Math.PI / len);

  carouselCards.forEach((card, i) => {
    card.element.style.transform =
      `rotateY(${i * carouselAngleStep}deg) translateZ(${carouselRadius}px)`;
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
  el.carouselTrack.style.transform =
    `translateZ(${-carouselRadius}px) rotateY(${-carouselIndex * carouselAngleStep}deg)`;

  carouselCards.forEach((card, i) => {
    let rel = (i - carouselIndex) * carouselAngleStep;
    rel = ((rel + 180) % 360 + 360) % 360 - 180;
    const abs = Math.abs(rel);

    const opacity = abs < 1 ? 1 : Math.max(0.25, 1 - abs / 140);
    card.element.style.opacity = String(opacity);
    card.element.classList.toggle("is-center", abs < 1);
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

    try {
      const endingRes = await fetch(COMMON_ENDING_PATH);
      if (endingRes.ok) {
        const endingData = await endingRes.json();
        Object.assign(story.nodes, endingData.nodes);
      } else {
        console.warn(`Shared ending not found yet (${COMMON_ENDING_PATH}, status ${endingRes.status}) — continuing without it.`);
      }
    } catch (err) {
      console.warn("Could not load shared ending, continuing without it:", err);
    }

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
  const paths = new Set();
  Object.values(story.nodes).forEach((node) => {
    if (node.image) paths.add(node.image);
    if (node.gif) paths.add(node.gif);
  });

  const list = Array.from(paths);

  const promises = list.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          imageCache[src] = img;
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
    hideAllBoxes();
    el.endText.textContent = `This path continues at "${currentId}", which hasn't been added yet.`;
    el.boxEnd.classList.remove("hidden");
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
