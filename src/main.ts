import {
	App,
	ItemView,
	MarkdownView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	WorkspaceLeaf,
	finishRenderMath,
	renderMath,
} from "obsidian";
import { DetexifyClassifier, Stroke, SymbolMeta } from "./classifier";
import { ClassifierData, loadClassifierData } from "./data";
import { isInsideMath } from "./mathContext";

const VIEW_TYPE = "latex-symbol-picker-view";
const DEFAULT_STATUS = "Draw a symbol or search above.";

interface LatexSymbolPickerSettings {
	resultLimit: number;
}

const DEFAULT_SETTINGS: LatexSymbolPickerSettings = {
	resultLimit: 12,
};

interface DisplayResult {
	command: string;
	packageName: string;
}

function toResult(meta: SymbolMeta): DisplayResult {
	return { command: meta.command, packageName: meta.package };
}

export default class LatexSymbolPickerPlugin extends Plugin {
	settings: LatexSymbolPickerSettings = DEFAULT_SETTINGS;
	classifier: DetexifyClassifier | null = null;
	data: ClassifierData | null = null;
	lastActiveMarkdownView: MarkdownView | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new LatexSymbolPickerView(leaf, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf?.view instanceof MarkdownView) {
					this.lastActiveMarkdownView = leaf.view;
				}
			})
		);

		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active) this.lastActiveMarkdownView = active;

		this.addRibbonIcon("sigma", "Open LaTeX symbol picker", () => this.activateView());
		this.addCommand({
			id: "open-panel",
			name: "Open panel",
			callback: () => this.activateView(),
		});

		this.addSettingTab(new LatexSymbolPickerSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<LatexSymbolPickerSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			if (leaf) await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		if (leaf) await workspace.revealLeaf(leaf);
	}

	ensureClassifier(): void {
		if (this.classifier) return;
		const data = loadClassifierData();
		this.data = data;
		this.classifier = new DetexifyClassifier(data.snapshot);
	}

	classify(strokes: Stroke[]): DisplayResult[] {
		if (!this.classifier || !this.data) return [];
		return this.classifier
			.classify(strokes, this.settings.resultLimit)
			.map((hit) => this.data?.symbolsById.get(hit.id))
			.filter((meta): meta is SymbolMeta => meta !== undefined)
			.map(toResult);
	}

	search(query: string, limit = 80): DisplayResult[] {
		const needle = query.toLowerCase();
		const symbols = this.data?.symbols ?? [];
		const synonyms = this.data?.synonymsByCommand;
		const seen = new Set<string>();
		const results: DisplayResult[] = [];

		const collect = (matches: (meta: SymbolMeta) => boolean) => {
			for (const meta of symbols) {
				if (results.length >= limit) break;
				if (seen.has(meta.command)) continue;
				if (!matches(meta)) continue;
				seen.add(meta.command);
				results.push(toResult(meta));
			}
		};

		collect((meta) => `${meta.command} ${meta.package}`.toLowerCase().includes(needle));
		collect((meta) =>
			(synonyms?.get(meta.command) ?? []).some((keyword) => keyword.includes(needle))
		);

		return results;
	}

	insertSymbol(command: string) {
		const view =
			this.lastActiveMarkdownView ??
			this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view) {
			new Notice("Open a note before inserting a symbol.");
			return;
		}

		const editor = view.editor;
		if (!editor.hasFocus()) editor.focus();

		const offset = editor.posToOffset(editor.getCursor());
		const inside = isInsideMath(editor.getValue(), offset);

		let text = command;
		let caret = command.length;
		const braceIndex = command.indexOf("{}");
		if (braceIndex >= 0) caret = braceIndex + 1;
		if (!inside) {
			text = `$${command}$`;
			caret += 1;
		}

		editor.replaceSelection(text);
		const start = editor.posToOffset(editor.getCursor()) - text.length;
		editor.setCursor(editor.offsetToPos(start + caret));
		editor.focus();
	}
}

class LatexSymbolPickerView extends ItemView {
	private readonly plugin: LatexSymbolPickerPlugin;

	private canvas!: HTMLCanvasElement;
	private ctx!: CanvasRenderingContext2D;
	private dpr = 1;

	private strokes: Array<Array<{ x: number; y: number }>> = [];
	private drawing = false;
	private activePointer: number | null = null;

	private statusEl!: HTMLElement;
	private resultsEl!: HTMLElement;
	private searchEl!: HTMLInputElement;

	private resizeObserver: ResizeObserver | null = null;
	private renderToken = 0;

	constructor(leaf: WorkspaceLeaf, plugin: LatexSymbolPickerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return "LaTeX symbol picker";
	}

	getIcon(): string {
		return "sigma";
	}

	async onOpen() {
		const root = this.contentEl;
		root.empty();
		root.addClass("lsp-panel");

		const searchRow = root.createDiv({ cls: "lsp-search-row" });
		this.searchEl = searchRow.createEl("input", {
			type: "text",
			cls: "lsp-search-input",
			attr: { placeholder: "Search command, e.g. \\alpha, int, mathbb…" },
		});
		this.registerDomEvent(this.searchEl, "input", () => this.onSearch());
		const clearBtn = searchRow.createEl("button", { cls: "lsp-clear-btn", text: "Clear" });
		this.registerDomEvent(clearBtn, "click", () => this.clearAll());

		const canvasWrap = root.createDiv({ cls: "lsp-canvas-wrap" });
		this.canvas = canvasWrap.createEl("canvas", { cls: "lsp-canvas" });
		const ctx = this.canvas.getContext("2d");
		if (!ctx) throw new Error("LaTeX Symbol Picker: could not get 2D canvas context");
		this.ctx = ctx;

		this.setupCanvasEvents();

		this.statusEl = root.createDiv({ cls: "lsp-status" });
		this.resultsEl = root.createDiv({ cls: "lsp-results" });

		this.registerDomEvent(this.resultsEl, "mousedown", (event) => {
			const target = event.target as HTMLElement | null;
			const button = target?.closest<HTMLElement>(".lsp-result");
			if (!button) return;
			event.preventDefault();
			event.stopPropagation();
			const command = button.dataset.command;
			if (command) this.plugin.insertSymbol(command);
		});

		this.resizeObserver = new ResizeObserver(() => this.resizeCanvas());
		this.resizeObserver.observe(canvasWrap);
		this.resizeCanvas();

		this.setStatus("Loading…");
		window.setTimeout(() => {
			try {
				this.plugin.ensureClassifier();
				this.setStatus(DEFAULT_STATUS);
			} catch (error) {
				console.error(error);
				this.setStatus("Failed to load symbol data. Try reinstalling the plugin.");
			}
		}, 0);
	}

	async onClose() {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private setStatus(message: string) {
		this.statusEl.setText(message);
	}

	private resizeCanvas() {
		const wrap = this.canvas.parentElement;
		if (!wrap) return;
		const width = wrap.clientWidth;
		const height = this.canvas.clientHeight || 190;
		this.dpr = window.devicePixelRatio || 1;
		this.canvas.width = Math.max(1, Math.floor(width * this.dpr));
		this.canvas.height = Math.max(1, Math.floor(height * this.dpr));
		this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		this.redraw();
	}

	private setupCanvasEvents() {
		const pointFromEvent = (event: PointerEvent) => {
			const rect = this.canvas.getBoundingClientRect();
			return { x: event.clientX - rect.left, y: event.clientY - rect.top };
		};

		this.registerDomEvent(this.canvas, "pointerdown", (event: PointerEvent) => {
			if (this.activePointer !== null) return;
			event.preventDefault();
			this.activePointer = event.pointerId;
			this.canvas.setPointerCapture(event.pointerId);
			this.drawing = true;
			this.strokes.push([pointFromEvent(event)]);
			this.redraw();
		});

		this.registerDomEvent(this.canvas, "pointermove", (event: PointerEvent) => {
			if (!this.drawing || event.pointerId !== this.activePointer) return;
			event.preventDefault();
			const stroke = this.strokes[this.strokes.length - 1];
			stroke.push(pointFromEvent(event));
			this.redraw();
		});

		const finishStroke = (event: PointerEvent) => {
			if (event.pointerId !== this.activePointer) return;
			this.drawing = false;
			this.activePointer = null;
			this.classify();
		};
		this.registerDomEvent(this.canvas, "pointerup", finishStroke);
		this.registerDomEvent(this.canvas, "pointercancel", finishStroke);
	}

	private redraw() {
		const ctx = this.ctx;
		const cssWidth = this.canvas.width / this.dpr;
		const cssHeight = this.canvas.height / this.dpr;
		ctx.clearRect(0, 0, cssWidth, cssHeight);

		const style = getComputedStyle(this.canvas);
		this.drawGrid(cssWidth, cssHeight, style);

		ctx.strokeStyle = style.getPropertyValue("--lsp-ink") || "#cdd6f4";
		ctx.lineWidth = 3;
		ctx.lineJoin = "round";
		ctx.lineCap = "round";

		for (const stroke of this.strokes) {
			if (stroke.length === 0) continue;
			ctx.beginPath();
			ctx.moveTo(stroke[0].x, stroke[0].y);
			if (stroke.length === 1) {
				ctx.lineTo(stroke[0].x + 0.01, stroke[0].y);
			} else {
				for (const point of stroke.slice(1)) ctx.lineTo(point.x, point.y);
			}
			ctx.stroke();
		}
	}

	/** Draw a subtle dot grid at the intersections, like a Logseq whiteboard. */
	private drawGrid(width: number, height: number, style: CSSStyleDeclaration) {
		const ctx = this.ctx;
		const spacing = 22;
		const radius = 1;

		const match = style.color.match(/\d+(\.\d+)?/g);
		const rgb = match ? `${match[0]}, ${match[1]}, ${match[2]}` : "128, 128, 128";

		ctx.save();
		ctx.fillStyle = `rgba(${rgb}, 0.22)`;
		for (let x = spacing; x < width; x += spacing) {
			for (let y = spacing; y < height; y += spacing) {
				ctx.beginPath();
				ctx.arc(x, y, radius, 0, 2 * Math.PI);
				ctx.fill();
			}
		}
		ctx.restore();
	}

	/** Reset the canvas, the search box, the results and the status line. */
	private clearAll() {
		this.strokes = [];
		this.searchEl.value = "";
		this.redraw();
		this.resultsEl.empty();
		this.setStatus(DEFAULT_STATUS);
	}

	private classify() {
		if (this.searchEl.value.trim()) return; // search takes precedence
		if (!this.plugin.classifier) {
			this.setStatus("Still loading…");
			return;
		}
		if (this.strokes.length === 0) return;

		this.setStatus("Matching…");
		const results = this.plugin.classify(this.strokes);
		void this.renderResults(results, (count) =>
			this.setStatus(count > 0 ? "Click a result to insert it." : "No match, try drawing again.")
		);
	}

	private onSearch() {
		const query = this.searchEl.value.trim();
		if (!query) {
			this.resultsEl.empty();
			this.classify();
			return;
		}
		if (!this.plugin.classifier) {
			this.setStatus("Still loading…");
			return;
		}
		const results = this.plugin.search(query);
		void this.renderResults(results, (count) =>
			this.setStatus(
				count > 0
					? `${count} symbol${count === 1 ? "" : "s"}. Click to insert.`
					: "No matching symbol."
			)
		);
	}

	private async renderResults(
		results: DisplayResult[],
		onDone: (count: number) => void
	): Promise<void> {
		const token = ++this.renderToken;
		this.resultsEl.empty();
		onDone(results.length);
		if (results.length === 0) return;

		const grid = this.resultsEl.createDiv({ cls: "lsp-grid" });
		for (const result of results) this.buildTile(grid, result);

		await finishRenderMath();
		if (token !== this.renderToken) return;
	}

	private buildTile(grid: HTMLElement, result: DisplayResult): void {
		const button = grid.createEl("button", { cls: "lsp-result" });
		button.dataset.command = result.command;
		button.setAttr("aria-label", `${result.command} (${result.packageName})`);

		const preview = button.createDiv({ cls: "lsp-result-preview" });
		button.createDiv({ cls: "lsp-result-code", text: result.command });

		try {
			preview.appendChild(renderMath(result.command, false));
		} catch (error) {
			console.warn("Failed to render", result.command, error);
		}
	}
}

class LatexSymbolPickerSettingTab extends PluginSettingTab {
	private readonly plugin: LatexSymbolPickerPlugin;

	constructor(app: App, plugin: LatexSymbolPickerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Number of draw results")
			.setDesc("How many matches to show after drawing a symbol.")
			.addSlider((slider) =>
				slider
					.setLimits(4, 24, 1)
					.setValue(this.plugin.settings.resultLimit)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.resultLimit = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
