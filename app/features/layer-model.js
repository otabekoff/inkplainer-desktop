// One definition of how a layer is saved and restored, shared by project save/load,
// undo snapshots and scenes. (Each used to keep its own field list; they disagreed, so
// text layers lost their editable text and crop originals were dropped on reload.)
//
// Loaded before the app's own scripts. Other modules add per-layer settings with
// registerLayerFields(...) so those are saved everywhere too.

const LAYER_FIELDS = [
  "id", "name", "kind",
  "x", "y", "w", "h", "baseW", "baseH", "resizePct", "opacity", "visible", "groupId",
  "animStyle", "hand", "animOrder", "zigzag", "speed", "handSpeed", "chunks", "specChunks", "hasPngAlpha",
  "outlineDetect", "outlineAlgorithm", "outlineStrokeStyle", "colorStyle", "outlineColor", "outlineThickness",
  "textAnimDir", "textDrawStyle",
  // Text layers: what is needed to re-open them in the text editor.
  "_textContent", "_textFont", "_textSize", "_textBold", "_textItalic", "_textAlign", "_textColor",
  "_textLineHeight", "_textSpacing",
  // Non-destructive crop: the rectangle of the original image.
  "_origX", "_origY", "_origW", "_origH",
];

const LAYER_DEFAULTS = {
  resizePct: 100, opacity: 1, visible: true, groupId: null,
  animStyle: "scanner", hand: "custom1", animOrder: null,
  speed: 40, handSpeed: 6, chunks: 30, specChunks: 35, hasPngAlpha: false,
};

function registerLayerFields(...names) {
  for (const n of names) if (!LAYER_FIELDS.includes(n)) LAYER_FIELDS.push(n);
}

// Encoding an image to PNG is slow and layer images never change in place (crop and text
// edits replace them), so remember each image's data URL.
const _imageURLCache = new WeakMap();
function imageToDataURL(img) {
  if (!img) return null;
  let url = _imageURLCache.get(img);
  if (url) return url;
  if (typeof img.src === "string" && img.src.startsWith("data:")) {
    url = img.src;
  } else {
    const c = document.createElement("canvas");
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    url = c.toDataURL("image/png");
  }
  _imageURLCache.set(img, url);
  return url;
}

function serializeLayer(layer) {
  const data = {};
  for (const f of LAYER_FIELDS) if (layer[f] !== undefined) data[f] = layer[f];
  data.imageDataURL = imageToDataURL(layer.img);
  if (layer._origImg) data.origImageDataURL = imageToDataURL(layer._origImg);
  return data;
}

function _loadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.onload = () => {
      _imageURLCache.set(img, url);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Resolves to the layer, or null when its image cannot be decoded.
async function deserializeLayer(data) {
  const [img, origImg] = await Promise.all([_loadImage(data.imageDataURL), _loadImage(data.origImageDataURL)]);
  if (!img) return null;
  const layer = { ...LAYER_DEFAULTS };
  for (const f of LAYER_FIELDS) if (data[f] !== undefined) layer[f] = data[f];
  // Older saves: crop originals under origX…, text settings under textProps.
  for (const k of ["X", "Y", "W", "H"]) if (layer[`_orig${k}`] === undefined && data[`orig${k}`] !== undefined) layer[`_orig${k}`] = data[`orig${k}`];
  if (data.textProps && typeof data.textProps === "object") {
    for (const [k, v] of Object.entries(data.textProps)) if (layer[k] === undefined) layer[k] = v;
  }
  if (layer.baseW === undefined) layer.baseW = layer.w;
  if (layer.baseH === undefined) layer.baseH = layer.h;
  layer.img = img;
  if (origImg) layer._origImg = origImg;
  return layer;
}

// Restores a list of layers in their saved stack order.
async function deserializeLayers(list) {
  const layers = await Promise.all((list || []).map(deserializeLayer));
  return layers.filter(Boolean);
}
