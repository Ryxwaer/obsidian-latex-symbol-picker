/*
 * Build the bundled, stripped classifier data.
 *
 * Downloads the upstream Detexify data (symbols.json + snapshot.json), keeps
 * only the symbols that Obsidian's MathJax can actually render (mirrors the
 * tex-mml-chtml package set, including the `noundefined` behaviour), rounds the
 * stroke coordinates to shrink the payload, and writes the result to ../data/.
 *
 * Usage: node scripts/build-data.cjs
 * Requires the `mathjax-full` dev dependency and network access.
 */
const fs = require("fs");
const path = require("path");

const { mathjax } = require("mathjax-full/js/mathjax.js");
const { TeX } = require("mathjax-full/js/input/tex.js");
const { CHTML } = require("mathjax-full/js/output/chtml.js");
const { liteAdaptor } = require("mathjax-full/js/adaptors/liteAdaptor.js");
const { RegisterHTMLHandler } = require("mathjax-full/js/handlers/html.js");
const { AllPackages } = require("mathjax-full/js/input/tex/AllPackages.js");
// Registering all configurations lets `autoload` resolve packages on demand,
// the same way Obsidian's tex-mml-chtml bundle does.
require("mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js");

const SYMBOLS_URL = "https://detexify.kirelabs.org/data/symbols.json";
const SNAPSHOT_URL = "https://detexify.kirelabs.org/data/snapshot.json";
const OUT_DIR = path.join(__dirname, "..", "data");
const COORD_DECIMALS = 2;

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

// Mirror Obsidian's default tex-mml-chtml TeX packages (autoload pulls the rest).
const packages = Array.from(new Set([...AllPackages, "noundefined"])).filter(
	(p) => p !== "noerrors"
);
const tex = new TeX({ packages });
const chtml = new CHTML({ fontURL: "x" });
const doc = mathjax.document("", { InputJax: tex, OutputJax: chtml });

function rendersCleanly(command) {
	let html;
	try {
		html = adaptor.outerHTML(doc.convert(command, { display: false }));
	} catch (error) {
		return false;
	}
	if (/merror|data-mjx-error/.test(html)) return false;
	// `noundefined` typesets unknown commands as red text (inline color style).
	if (/style="[^"]*color\s*:/.test(html)) return false;
	return true;
}

function round(value) {
	return Number(value.toFixed(COORD_DECIMALS));
}

async function fetchJson(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
	return response.json();
}

async function main() {
	console.log("Downloading upstream Detexify data…");
	const [symbols, snapshot] = await Promise.all([
		fetchJson(SYMBOLS_URL),
		fetchJson(SNAPSHOT_URL),
	]);

	console.log(`Probing ${symbols.length} symbols against MathJax…`);
	const renderable = new Map(); // command -> boolean
	for (const symbol of symbols) {
		if (!renderable.has(symbol.command)) {
			renderable.set(symbol.command, rendersCleanly(symbol.command));
		}
	}
	const renderableCommands = new Set(
		[...renderable.entries()].filter(([, ok]) => ok).map(([cmd]) => cmd)
	);

	const keptSymbols = symbols.filter((s) => renderableCommands.has(s.command));
	const keptIds = new Set(keptSymbols.map((s) => s.legacyId));

	// Compact layout (id -> samples -> strokes -> points -> [x, y]) keeps the
	// bundled main.js small; src/data.ts inflates it back at load time.
	const strippedSnapshot = {};
	let keptSamples = 0;
	for (const [id, samples] of Object.entries(snapshot)) {
		if (!keptIds.has(id)) continue;
		strippedSnapshot[id] = samples.map((sample) =>
			sample.strokes.map((stroke) =>
				stroke.map((point) => [round(point.x), round(point.y)])
			)
		);
		keptSamples += samples.length;
	}

	fs.mkdirSync(OUT_DIR, { recursive: true });
	const symbolsPath = path.join(OUT_DIR, "symbols.json");
	const snapshotPath = path.join(OUT_DIR, "snapshot.json");
	fs.writeFileSync(symbolsPath, JSON.stringify(keptSymbols));
	fs.writeFileSync(snapshotPath, JSON.stringify(strippedSnapshot));

	const mb = (p) => (fs.statSync(p).size / (1024 * 1024)).toFixed(2);
	console.log("\nDone.");
	console.log(`  symbols:  ${symbols.length} -> ${keptSymbols.length}`);
	console.log(`  ids:      ${Object.keys(snapshot).length} -> ${Object.keys(strippedSnapshot).length}`);
	console.log(`  samples:  ${keptSamples}`);
	console.log(`  symbols.json:  ${mb(symbolsPath)} MB`);
	console.log(`  snapshot.json: ${mb(snapshotPath)} MB`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
