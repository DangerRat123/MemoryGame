// Test engine for a single location.
// Loads data/locations/location1.json, preloads every image, draws the
// current node's image through the dither shader (js/dither.js), and
// renders the right text box(es). No printer or item/location select
// screens yet — just enough to click through the branching path and see
// the real visual treatment.

const DATA_PATH = "data/locations/location1.json";

const el = {
  loading: document.getElementById("loading"),
  loadingProgress: document.getElementById("loading-progress"),
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

async function init() {
  const res = await fetch(DATA_PATH);
  if (!res.ok) {
    document.body.innerHTML = `<p style="color:#ede6d6;font-family:monospace;padding:2rem;">
      Could not load ${DATA_PATH} (status ${res.status}). Check the path and that the file is valid JSON.
    </p>`;
    return;
  }
  story = await res.json();

  await preloadImages();

  Dither.init(el.canvas);
  Dither.start();

  currentId = story.start;
  el.loading.classList.add("hidden");
  el.scene.classList.remove("hidden");
  render();
}

// Keeps every loaded Image element around, keyed by src, so we're never
// re-fetching or re-decoding — render() just hands the already-loaded
// image straight to the shader as a texture.
const imageCache = {};

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
  el.loadingProgress.textContent = `0 / ${list.length}`;

  const promises = list.map(
    (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => {
          imageCache[src] = img;
          loaded++;
          el.loadingProgress.textContent = `${loaded} / ${list.length}`;
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
