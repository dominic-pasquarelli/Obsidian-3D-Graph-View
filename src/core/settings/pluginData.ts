import { normalizeForceSettings, type ForceSettings } from "../forces/registry";
import { DEFAULT_PERFORMANCE_PREFS, type PerformancePrefs } from "../perf/scaling";
import { builtInForceProfiles, builtInViewProfiles } from "../profiles/builtins";
import { ProfileLibrary, type Profile } from "../profiles/ProfileLibrary";
import { isPlainObject, mergeWithDefaults } from "../util/object";
import { normalizeViewSettings, type ViewSettings } from "./view";

/** Everything persisted in the plugin's data.json. */
export interface PluginData {
	version: 1;
	forceProfiles: Profile<ForceSettings>[];
	viewProfiles: Profile<ViewSettings>[];
	activeForceProfile: string | null;
	activeViewProfile: string | null;
	performance: PerformancePrefs;
	/** Vault folder used for exported / imported profile files. */
	profileFolder: string;
	/** Let colour-group and filter queries read note text (needed for plain words / content:). */
	contentQueries: boolean;
	/** Clicking a not-yet-created note creates it (like the core graph). */
	createOnGhostClick: boolean;
}

export const DEFAULT_GLOBAL_SETTINGS = {
	performance: DEFAULT_PERFORMANCE_PREFS,
	profileFolder: "Graph profiles",
	contentQueries: true,
	createOnGhostClick: true,
};

export function createForceLibrary(): ProfileLibrary<ForceSettings> {
	return new ProfileLibrary<ForceSettings>("force", normalizeForceSettings, builtInForceProfiles);
}

export function createViewLibrary(): ProfileLibrary<ViewSettings> {
	return new ProfileLibrary<ViewSettings>("view", normalizeViewSettings, builtInViewProfiles);
}

export interface LoadedPluginData {
	forces: ProfileLibrary<ForceSettings>;
	views: ProfileLibrary<ViewSettings>;
	activeForceProfile: string | null;
	activeViewProfile: string | null;
	performance: PerformancePrefs;
	profileFolder: string;
	contentQueries: boolean;
	createOnGhostClick: boolean;
}

export function loadPluginData(raw: unknown): LoadedPluginData {
	const data = isPlainObject(raw) ? raw : {};
	const forces = createForceLibrary();
	forces.load(data.forceProfiles);
	const views = createViewLibrary();
	views.load(data.viewProfiles);
	const globals = mergeWithDefaults(DEFAULT_GLOBAL_SETTINGS, data);
	return {
		forces,
		views,
		activeForceProfile: forces.resolve(typeof data.activeForceProfile === "string" ? data.activeForceProfile : null).id,
		activeViewProfile: views.resolve(typeof data.activeViewProfile === "string" ? data.activeViewProfile : null).id,
		performance: globals.performance,
		profileFolder: globals.profileFolder,
		contentQueries: globals.contentQueries,
		createOnGhostClick: globals.createOnGhostClick,
	};
}

export function serializePluginData(d: LoadedPluginData): PluginData {
	return {
		version: 1,
		forceProfiles: d.forces.toJSON(),
		viewProfiles: d.views.toJSON(),
		activeForceProfile: d.activeForceProfile,
		activeViewProfile: d.activeViewProfile,
		performance: d.performance,
		profileFolder: d.profileFolder,
		contentQueries: d.contentQueries,
		createOnGhostClick: d.createOnGhostClick,
	};
}
