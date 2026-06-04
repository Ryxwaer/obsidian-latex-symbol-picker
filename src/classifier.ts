// TypeScript port of the Detexify "legacy-dtw" classifier and stroke
// preprocessing (https://github.com/kirel/detexify, MIT licensed).

export interface Point {
	x: number;
	y: number;
}

export type Stroke = Point[];

export type Snapshot = Record<string, Array<{ strokes: Stroke[] }>>;

export interface SymbolMeta {
	id: string;
	legacyId: string;
	command: string;
	package: string;
}

export interface ClassifyHit {
	id: string;
	score: number;
}

const EPSILON = 1e-10;
// Angle threshold used to drop near-collinear points (15 degrees in radians).
const ANGLE_THRESHOLD = (2 * Math.PI * 15) / 360;
const UNIT_RECT: [Point, Point] = [
	{ x: 0, y: 0 },
	{ x: 1, y: 1 },
];

function point(x: number, y: number): Point {
	return { x, y };
}

function add(a: Point, b: Point): Point {
	return point(a.x + b.x, a.y + b.y);
}

function sub(a: Point, b: Point): Point {
	return point(a.x - b.x, a.y - b.y);
}

function scale(s: number, p: Point): Point {
	return point(s * p.x, s * p.y);
}

function dot(a: Point, b: Point): number {
	return a.x * b.x + a.y * b.y;
}

function norm(p: Point): number {
	return Math.sqrt(dot(p, p));
}

// Manhattan distance: the metric used inside the DTW comparison.
function manhattan(a: Point, b: Point): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function samePoint(a: Point, b: Point): boolean {
	return a.x === b.x && a.y === b.y;
}

function closePoint(a: Point, b: Point): boolean {
	return norm(sub(a, b)) < EPSILON;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, value));
}

function strokeLength(stroke: Stroke): number {
	let total = 0;
	for (let i = 1; i < stroke.length; i += 1) {
		total += norm(sub(stroke[i], stroke[i - 1]));
	}
	return total;
}

function boundingBox(stroke: Stroke): [Point, Point] {
	if (stroke.length === 0) {
		throw new Error("An empty stroke has no bounding box");
	}
	let minX = stroke[0].x;
	let minY = stroke[0].y;
	let maxX = minX;
	let maxY = minY;
	for (const p of stroke.slice(1)) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return [point(minX, minY), point(maxX, maxY)];
}

// Scale a stroke's bounding box into the target rectangle.
function scaleToRect(target: [Point, Point], stroke: Stroke): Stroke {
	if (stroke.length === 0) return [];
	const [lo, hi] = target;
	if (lo.x > hi.x || lo.y > hi.y) {
		throw new Error("Invalid target rectangle");
	}
	const [bMin, bMax] = boundingBox(stroke);
	const w = bMax.x - bMin.x;
	const h = bMax.y - bMin.y;
	const tw = hi.x - lo.x;
	const th = hi.y - lo.y;
	const sx = w === 0 ? 1 : (1 / w) * tw;
	const sy = h === 0 ? 1 : (1 / h) * th;
	const ox = w === 0 ? lo.x + 0.5 * tw : lo.x;
	const oy = h === 0 ? lo.y + 0.5 * th : lo.y;
	return stroke.map((p) => point((p.x - bMin.x) * sx + ox, (p.y - bMin.y) * sy + oy));
}

// Compute the aspect-preserving sub-rectangle of `target` for a given bbox.
function fitRect(bbox: [Point, Point], target: [Point, Point]): [Point, Point] {
	const [bMin, bMax] = bbox;
	const [tMin, tMax] = target;
	if (samePoint(bMin, bMax)) {
		const center = scale(0.5, add(tMin, tMax));
		return [center, center];
	}
	const bw = bMax.x - bMin.x;
	const bh = bMax.y - bMin.y;
	const tw = tMax.x - tMin.x;
	const th = tMax.y - tMin.y;
	const bAspect = bw / bh;
	const tAspect = tw / th;
	const wider = bAspect > tAspect;
	const factor = wider ? tw / bw : th / bh;
	const offset = wider
		? point(0, (th - factor * bh) / 2)
		: point((tw - factor * bw) / 2, 0);
	const mapPoint = (p: Point) => add(add(scale(factor, sub(p, bMin)), offset), tMin);
	return [mapPoint(bMin), mapPoint(bMax)];
}

function fitToUnitSquare(stroke: Stroke): Stroke {
	if (stroke.length === 0) return [];
	return scaleToRect(fitRect(boundingBox(stroke), UNIT_RECT), stroke);
}

// Remove consecutive duplicate points.
function dedupe(stroke: Stroke): Stroke {
	if (stroke.length < 2) return [...stroke];
	const out: Stroke = [stroke[0]];
	for (const p of stroke.slice(1)) {
		if (!closePoint(p, out[out.length - 1])) out.push(p);
	}
	return out;
}

// Smooth a stroke using a running mean of three points.
function smooth(stroke: Stroke): Stroke {
	if (stroke.length < 3) return [...stroke];
	const out: Stroke = [stroke[0]];
	for (let i = 0; i + 2 < stroke.length; i += 1) {
		out.push(scale(1 / 3, add(add(stroke[i], stroke[i + 1]), stroke[i + 2])));
	}
	out.push(...stroke.slice(-1));
	return out;
}

// Redistribute points so that consecutive spacing equals `distance`.
function redistributeByDistance(distance: number, stroke: Stroke): Stroke {
	if (distance <= 0) throw new Error("Cannot redistribute with non-positive distance");
	if (stroke.length < 2) return [...stroke];
	const out: Stroke = [stroke[0]];
	let budget = distance;
	let anchor = stroke[0];
	let rest = stroke.slice(1);
	let next = rest[0];
	while (rest.length > 0) {
		const diff = sub(next, anchor);
		const len = norm(diff);
		if (len < budget) {
			anchor = next;
			rest = rest.slice(1);
			if (rest.length > 0) next = rest[0];
			budget -= len;
		} else {
			const created = add(anchor, scale(budget / len, diff));
			out.push(created);
			anchor = created;
			budget = distance;
		}
	}
	const last = stroke[stroke.length - 1];
	if (last && out[out.length - 1] !== last && !samePoint(out[out.length - 1], last)) {
		out.push(last);
	}
	return out;
}

// Redistribute a stroke to a fixed number of points.
function redistributeToCount(count: number, stroke: Stroke): Stroke {
	if (stroke.length === 0) return [];
	if (stroke.length === 1) return [...stroke];
	return redistributeByDistance(strokeLength(stroke) / (count - 1), stroke);
}

// Angle at the middle point of a (prev, mid, next) triple.
function cornerAngle(prev: Point, mid: Point, next: Point): number {
	const a = sub(mid, prev);
	const b = sub(next, mid);
	const denom = norm(a) * norm(b);
	if (denom === 0) return 0;
	return Math.acos(clamp(dot(a, b) / denom, -1, 1));
}

// Drop points whose corner angle is below the threshold (keep significant turns).
function dropFlatPoints(threshold: number, stroke: Stroke): Stroke {
	if (stroke.length < 3) return [...stroke];
	const out: Stroke = [stroke[0]];
	let prev = stroke[0];
	let mid = stroke[1];
	for (let i = 2; i < stroke.length; i += 1) {
		const next = stroke[i];
		if (cornerAngle(prev, mid, next) >= threshold) {
			out.push(mid);
			prev = mid;
		}
		mid = next;
	}
	out.push(mid);
	return out;
}

// Full preprocessing pipeline applied to raw drawn strokes.
function preprocess(strokes: Stroke[]): Stroke[] {
	return strokes
		.slice(0, 10)
		.map((stroke) =>
			dropFlatPoints(
				ANGLE_THRESHOLD,
				dedupe(redistributeToCount(10, fitToUnitSquare(smooth(dedupe(stroke)))))
			)
		);
}

function flatten(strokes: Stroke[]): Point[] {
	const out: Point[] = [];
	for (const stroke of strokes) out.push(...stroke);
	return out;
}

// Linear (single-pass) dynamic time warping, mean distance per step.
function dtw(a: Point[], b: Point[]): number {
	if (a.length === 0 && b.length === 0) {
		throw new Error("Cannot compare two empty series");
	}
	if (a.length === 0) return dtw(b, a);
	if (b.length === 0) throw new Error("Cannot compare empty series");

	let s = a;
	let r = b;
	let si = 0;
	let ri = 0;
	let acc = manhattan(s[si], r[ri]);
	let steps = 1;

	while (s.length - si > 1 && r.length - ri > 1) {
		const moveS = manhattan(s[si + 1], r[ri]);
		const moveBoth = manhattan(s[si + 1], r[ri + 1]);
		const moveR = manhattan(s[si], r[ri + 1]);
		const best = Math.min(moveS, moveBoth, moveR);
		if (moveS === best) {
			si += 1;
			acc += moveS;
		} else if (moveBoth === best) {
			si += 1;
			ri += 1;
			acc += moveBoth;
		} else {
			ri += 1;
			acc += moveR;
		}
		steps += 1;
	}

	if (r.length - ri === 1) {
		const ts = s;
		const tsi = si;
		s = r;
		si = ri;
		r = ts;
		ri = tsi;
	}
	if (s.length - si !== 1) throw new Error("Unexpected DTW state");
	for (let i = ri + 1; i < r.length; i += 1) {
		acc += manhattan(s[si], r[i]);
		steps += 1;
	}
	return acc / steps;
}

function mean(values: number[]): number {
	if (values.length === 0) return Number.POSITIVE_INFINITY;
	return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function validStrokes(strokes: Stroke[]): boolean {
	return strokes.length > 0 && strokes.every((s) => s.length > 0);
}

interface PreparedSymbol {
	id: string;
	samples: Point[][];
}

export class DetexifyClassifier {
	private readonly preparedSymbols: PreparedSymbol[];
	private readonly meanNearest: number;

	constructor(snapshot: Snapshot, meanNearest = 2) {
		if (meanNearest <= 0) throw new Error("meanNearest must be positive");
		this.meanNearest = meanNearest;
		this.preparedSymbols = Object.entries(snapshot).map(([id, samples]) => ({
			id,
			samples: samples.map((sample) => flatten(sample.strokes)),
		}));
	}

	classify(strokes: Stroke[], limit = 10): ClassifyHit[] {
		if (!validStrokes(strokes)) return [];
		const query = flatten(preprocess(strokes));
		const hits: ClassifyHit[] = [];
		for (const symbol of this.preparedSymbols) {
			if (symbol.samples.length === 0) continue;
			const distances = symbol.samples
				.map((sample) => dtw(query, sample))
				.sort((x, y) => x - y);
			hits.push({ id: symbol.id, score: mean(distances.slice(0, this.meanNearest)) });
		}
		hits.sort((x, y) => x.score - y.score);
		return limit === undefined ? hits : hits.slice(0, limit);
	}
}
