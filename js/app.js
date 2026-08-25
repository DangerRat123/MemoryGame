// Minimal test engine for a single location.
// Loads data/locations/location1.json, shows the image for the current
// node, renders the right text box(es), and moves to the next node on click.
// No shader, no printer, no item/location select screens yet — just enough
// to click through the branching path and confirm it feels right.

const DATA_PATH = "data/locations/location1.json";

const el = {
  image: document.getElementById("scene-image"),

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
  currentId = story.start;
  render();
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

  el.image.src = node.image;
  el.image.alt = `Scene ${currentId}`;

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
