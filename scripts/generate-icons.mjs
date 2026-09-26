/**
 * Renders every branded image the packagers need from resources/logo.svg:
 *
 *   resources/icon.png       app / tray / NSIS icon (rounded plate)
 *   resources/appx/*.png     Microsoft Store tile assets
 *
 * The Store rejects packages whose tiles are electron-builder's bundled sample
 * images (cert failure 10.1.1.11 "On Device Tiles"), which is what ships when
 * resources/appx is missing. Run `pnpm icons` after touching the logo.
 *
 * Usage: pnpm icons   (electron is used purely as a headless rasterizer)
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = join(ROOT, "resources");
const APPX_DIR = join(RESOURCES, "appx");

const PLATE = "#FFFFFF";
const SCALES = [100, 125, 150, 200, 400];

/** Windows list/taskbar sizes Square44x44Logo is expected to supply. */
const TARGET_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256];

/**
 * `box` is the share of the tile the logo may occupy. Small assets get a
 * larger share so the mark stays readable; wide tiles keep the mark at tile
 * height/2 so it reads as a logo rather than a stretched banner.
 */
const TILES = [
  { name: "StoreLogo", width: 50, height: 50, box: 0.8 },
  { name: "Square44x44Logo", width: 44, height: 44, box: 0.8 },
  { name: "SmallTile", width: 71, height: 71, box: 0.72 },
  { name: "Square150x150Logo", width: 150, height: 150, box: 0.66 },
  { name: "LargeTile", width: 310, height: 310, box: 0.6 },
  { name: "Wide310x150Logo", width: 310, height: 150, box: 0.5 },
];

function page(svgDataUrl) {
  return `<!doctype html><meta charset="utf-8"><body style="margin:0">
<script>
const logo = new Image();
const ready = new Promise((resolve, reject) => {
  logo.onload = () => resolve();
  logo.onerror = () => reject(new Error("logo failed to decode"));
});
logo.src = ${JSON.stringify(svgDataUrl)};

/** Draws the mark centred inside \`box\` of the canvas, preserving aspect. */
function render({ width, height, box, radius }) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = ${JSON.stringify(PLATE)};
  if (radius > 0) {
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, radius);
    ctx.fill();
  } else {
    ctx.fillRect(0, 0, width, height);
  }

  const scale = Math.min((width * box) / logo.width, (height * box) / logo.height);
  const w = logo.width * scale;
  const h = logo.height * scale;
  ctx.drawImage(logo, (width - w) / 2, (height - h) / 2, w, h);

  return canvas.toDataURL("image/png");
}
</script></body>`;
}

async function draw(win, spec) {
  const dataUrl = await win.webContents.executeJavaScript(
    `ready.then(() => render(${JSON.stringify(spec)}))`,
    true,
  );
  return Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64");
}

const scaled = (value, scale) => Math.round((value * scale) / 100);

async function main() {
  const svg = await readFile(join(RESOURCES, "logo.svg"), "utf8");
  const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html;base64,${Buffer.from(page(svgDataUrl)).toString("base64")}`);

  // The app icon is a standalone plate, so it keeps rounded corners; Windows
  // masks tiles itself and square-crops anything we round.
  await writeFile(
    join(RESOURCES, "icon.png"),
    await draw(win, { width: 1024, height: 1024, box: 0.62, radius: 224 }),
  );

  await rm(APPX_DIR, { recursive: true, force: true });
  await mkdir(APPX_DIR, { recursive: true });

  let count = 0;
  for (const tile of TILES) {
    for (const scale of SCALES) {
      const spec = {
        width: scaled(tile.width, scale),
        height: scaled(tile.height, scale),
        box: tile.box,
        radius: 0,
      };
      await writeFile(join(APPX_DIR, `${tile.name}.scale-${scale}.png`), await draw(win, spec));
      count += 1;
    }
  }

  for (const size of TARGET_SIZES) {
    const spec = { width: size, height: size, box: size <= 32 ? 0.9 : 0.8, radius: 0 };
    await writeFile(
      join(APPX_DIR, `Square44x44Logo.targetsize-${size}.png`),
      await draw(win, spec),
    );
    count += 1;
  }

  console.log(`resources/icon.png + ${count} appx assets written`);
  win.destroy();
  app.quit();
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
