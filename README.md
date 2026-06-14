# LaTeX Symbol Picker

An Obsidian side panel to find LaTeX symbols and quickly insert them at your cursor.

![Demo: drawing a symbol and inserting it into a note](assets/showcase.gif)

## Features

- **Draw symbols** with mouse, finger, or stylus to find them by shape (inspired by Detexify).
- **Search by name** using common synonyms, so you can find a symbol even without knowing LaTeX.
- **Click to insert** a symbol at the cursor, auto-wrapped in `$...$` when you are not already inside a math context.
- **History of picked symbols** is tracked and recent symbols are available at the bottom of panel for quick reuse.
- **Fully offline**: the classifier and its training data ship with the plugin. Only symbols that Obsidian's MathJax can render are included.

## Usage

- Open the panel from the ribbon (sigma icon) or the command
  "LaTeX Symbol Picker: Open panel".
- Draw a symbol on the canvas, or type part of a command or its name in the search box.
- Click a result to insert it at the cursor in the active note.
