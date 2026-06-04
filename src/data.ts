import { App, normalizePath } from "obsidian";
import type { Snapshot, SymbolMeta } from "./classifier";

export interface ClassifierData {
	snapshot: Snapshot;
	symbols: SymbolMeta[];
	symbolsById: Map<string, SymbolMeta>;
}

function backslashToUnderscore(id: string): string {
	return id.replace(/\\/g, "_");
}

function indexSymbols(symbols: SymbolMeta[]): Map<string, SymbolMeta> {
	const map = new Map<string, SymbolMeta>();
	for (const symbol of symbols) {
		if (typeof symbol.legacyId === "string") {
			map.set(symbol.legacyId, symbol);
			map.set(backslashToUnderscore(symbol.legacyId), symbol);
		}
		if (typeof symbol.id === "string") map.set(symbol.id, symbol);
	}
	return map;
}

/**
 * Loads the classifier data that ships with the plugin. The data is generated
 * by scripts/build-data.cjs and contains only symbols Obsidian's MathJax can
 * render, so everything works fully offline with no network access.
 */
export class DataStore {
	private readonly app: App;
	private readonly symbolsPath: string;
	private readonly snapshotPath: string;

	constructor(app: App, pluginDir: string) {
		this.app = app;
		this.symbolsPath = normalizePath(`${pluginDir}/data/symbols.json`);
		this.snapshotPath = normalizePath(`${pluginDir}/data/snapshot.json`);
	}

	async load(): Promise<ClassifierData> {
		const adapter = this.app.vault.adapter;
		const [symbolsRaw, snapshotRaw] = await Promise.all([
			adapter.read(this.symbolsPath),
			adapter.read(this.snapshotPath),
		]);
		const symbols = JSON.parse(symbolsRaw) as SymbolMeta[];
		const snapshot = JSON.parse(snapshotRaw) as Snapshot;
		return { symbols, snapshot, symbolsById: indexSymbols(symbols) };
	}
}
