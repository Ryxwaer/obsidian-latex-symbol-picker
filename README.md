# LaTeX Symbol Picker

An Obsidian side panel to find LaTeX symbols by **drawing** them (or searching),
then insert them at the cursor. It auto-wraps the command in `$...$` when the
cursor is not already inside a math context.

It works **fully offline**: the classifier and its training data ship with the
plugin. Only symbols that Obsidian's MathJax can render are included.

## Usage

- Open the panel from the ribbon (pencil icon) or the command
  "Open Detexify panel".
- Draw a symbol on the canvas, or type part of a command in the search box.
- Click a result to insert it at the cursor in the active note.

## Development

```bash
npm install
npm run build        # type-check + bundle to main.js
npm run dev          # watch build
```

## Regenerating the bundled data

`data/symbols.json` and `data/snapshot.json` are generated from the upstream
Detexify data, filtered to the commands Obsidian's MathJax can render, and the
stroke coordinates are rounded to keep the payload small.

```bash
npm run build:data   # requires network + the mathjax-full dev dependency
```

## Credits & license

This plugin is MIT licensed. It is built on the MIT-licensed
[Detexify](https://github.com/kirel/detexify) project by Daniel Kirsch: the
classifier in `src/classifier.ts` is a TypeScript port, and the bundled data is
derived from the Detexify data set. See [`LICENSE`](LICENSE) for full notices.
