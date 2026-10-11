/** Bundled compute-worker source, injected by the esbuild `inline-compute-worker` plugin. */
declare module "virtual:compute-worker" {
	const source: string;
	export default source;
}

/** Minimal typings for the parts of d3-force-3d this plugin uses (the package ships no types). */
declare module "d3-force-3d" {
	export interface SimNode {
		index?: number;
		x?: number;
		y?: number;
		z?: number;
		vx?: number;
		vy?: number;
		vz?: number;
		fx?: number;
		fy?: number;
		fz?: number;
	}
	export interface Force<N extends SimNode = SimNode> {
		(alpha: number): void;
		initialize?: (nodes: N[], random: () => number, numDimensions: number) => void;
	}
	export interface LinkForce<N extends SimNode, L> extends Force<N> {
		links(): L[];
		links(links: L[]): this;
		id(fn: (node: N) => string | number): this;
		strength(fn: number | ((link: L, i: number, links: L[]) => number)): this;
		distance(fn: number | ((link: L, i: number, links: L[]) => number)): this;
		iterations(n: number): this;
	}
	export interface ManyBodyForce<N extends SimNode> extends Force<N> {
		strength(fn: number | ((node: N, i: number, nodes: N[]) => number)): this;
		theta(theta: number): this;
		distanceMin(d: number): this;
		distanceMax(d: number): this;
	}
	export interface PositionForce<N extends SimNode> extends Force<N> {
		strength(fn: number | ((node: N, i: number, nodes: N[]) => number)): this;
		x?(v: number): this;
		y?(v: number): this;
		z?(v: number): this;
	}
	export interface CollideForce<N extends SimNode> extends Force<N> {
		radius(fn: number | ((node: N, i: number, nodes: N[]) => number)): this;
		strength(s: number): this;
		iterations(n: number): this;
	}
	export interface Simulation<N extends SimNode> {
		tick(iterations?: number): this;
		stop(): this;
		nodes(): N[];
		nodes(nodes: N[]): this;
		alpha(): number;
		alpha(alpha: number): this;
		alphaMin(): number;
		alphaMin(min: number): this;
		alphaDecay(): number;
		alphaDecay(decay: number): this;
		alphaTarget(): number;
		alphaTarget(target: number): this;
		velocityDecay(): number;
		velocityDecay(decay: number): this;
		force(name: string): Force<N> | undefined;
		force(name: string, force: Force<N> | null): this;
		numDimensions(): number;
		numDimensions(dims: number): this;
	}
	export function forceSimulation<N extends SimNode>(nodes?: N[], numDimensions?: number): Simulation<N>;
	export function forceLink<N extends SimNode, L>(links?: L[]): LinkForce<N, L>;
	export function forceManyBody<N extends SimNode>(): ManyBodyForce<N>;
	export interface CenterForce<N extends SimNode> extends Force<N> {
		strength(s: number): this;
	}
	export function forceCenter<N extends SimNode>(x?: number, y?: number, z?: number): CenterForce<N>;
	export function forceX<N extends SimNode>(x?: number): PositionForce<N>;
	export function forceY<N extends SimNode>(y?: number): PositionForce<N>;
	export function forceZ<N extends SimNode>(z?: number): PositionForce<N>;
	export function forceCollide<N extends SimNode>(radius?: number): CollideForce<N>;
}
