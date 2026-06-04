/**
 * Decide whether a cursor offset sits inside a LaTeX math context, supporting
 * both inline `$...$` and display `$$...$$` delimiters. Escaped dollar signs
 * (`\$`) are ignored. An unclosed trailing region (e.g. the user just typed a
 * lone `$`) is treated as math so insertions land inside it.
 */
export function isInsideMath(text: string, offset: number): boolean {
	type State = "text" | "inline" | "display";
	let state: State = "text";
	let contentStart = 0;
	let i = 0;

	const within = (start: number, end: number) => offset >= start && offset <= end;

	while (i < text.length) {
		const char = text[i];

		if (char === "\\") {
			// Skip the escaped character.
			i += 2;
			continue;
		}

		if (char !== "$") {
			i += 1;
			continue;
		}

		const isDouble = text[i + 1] === "$";

		if (state === "text") {
			if (isDouble) {
				state = "display";
				contentStart = i + 2;
				i += 2;
			} else {
				state = "inline";
				contentStart = i + 1;
				i += 1;
			}
			continue;
		}

		if (state === "display") {
			if (isDouble) {
				if (within(contentStart, i)) return true;
				state = "text";
				i += 2;
			} else {
				i += 1;
			}
			continue;
		}

		// state === "inline"
		if (within(contentStart, i)) return true;
		state = "text";
		i += 1;
	}

	// Unclosed region at the end of the document.
	if (state !== "text" && offset >= contentStart) return true;
	return false;
}
