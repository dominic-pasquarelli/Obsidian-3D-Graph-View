/**
 * Declarative control specs. Force modules and display sections describe their
 * settings with these; the UI renders them automatically, so adding a setting
 * never requires touching UI code.
 */

interface BaseControl<S> {
	/** Dotted path inside the settings object, e.g. "level2.minPaths". */
	key: string;
	label: string;
	desc?: string;
	/** Hide the control unless this returns true for the current settings. */
	showIf?: (settings: S) => boolean;
}

export type ControlSpec<S = any> =
	| (BaseControl<S> & { type: "slider"; min: number; max: number; step: number })
	| (BaseControl<S> & { type: "toggle" })
	| (BaseControl<S> & { type: "dropdown"; options: Record<string, string> })
	| (BaseControl<S> & { type: "color" })
	| (BaseControl<S> & { type: "text"; placeholder?: string })
	| { type: "heading"; label: string; desc?: string; showIf?: (settings: S) => boolean };

/** A titled group of controls bound to one settings object. */
export interface ControlSection<S = any> {
	id: string;
	label: string;
	description?: string;
	controls: ControlSpec<S>[];
}
