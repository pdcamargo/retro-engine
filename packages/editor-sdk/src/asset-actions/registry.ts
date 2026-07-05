import type { MenuEntry } from '../components';
import type { AssetType } from '../components-asset';
import type { IconName } from '../icons';

/**
 * The asset a context action targets — the right-clicked (or selected) card. Absent
 * from an {@link AssetActionContext} when the action was invoked over the panel's
 * empty space (a "create" action).
 */
export interface AssetActionTarget {
  /** The asset's GUID (a sub-asset ref `<parent>#label` for a derived child). */
  readonly guid: string;
  /** Display name (the file's base name, as shown on the card). */
  readonly name: string;
  /** The browser bucket the card is drawn in. */
  readonly type: AssetType;
  /** The manifest / reflection kind (e.g. `'AnimationController'`). */
  readonly assetKind: string;
  /** Project-relative path of the asset file. */
  readonly location: string;
  /** True for a derived sub-asset (no file of its own — rename/delete don't apply). */
  readonly isChild: boolean;
}

/**
 * A request to create a new asset "on the fly": the panel shows a virtual card with
 * an inline, focused name input, then calls {@link AssetDraft.create} with the
 * chosen base name once the user confirms.
 */
export interface AssetDraft {
  /** Browser bucket for the virtual card's preview/icon. */
  readonly type: AssetType;
  /** File extension (no dot) the created file gets, e.g. `'ranimctrl'`. */
  readonly extension: string;
  /** Base name pre-filled (and selected) in the input. */
  readonly defaultName: string;
  /** Visual override for the virtual card (kinds sharing a browser bucket). */
  readonly icon?: IconName | undefined;
  readonly tag?: string | undefined;
  /** Write the asset under `folder` with `baseName`; resolves once it is on disk + indexed. */
  readonly create: (baseName: string, folder: string) => Promise<void>;
}

/** The imperative operations an action reaches back into the panel/host to perform. */
export interface AssetActionHost {
  /** Start an inline create session (virtual card) for a new asset. */
  beginCreate(draft: AssetDraft): void;
  /** Start inline rename on an existing asset's card. */
  beginRename(guid: string): void;
  /** Delete an asset (its file + `.meta` sidecar + registry entry). */
  deleteAsset(target: AssetActionTarget): void;
}

/** What an {@link AssetAction} is handed when its menu entry is built and run. */
export interface AssetActionContext {
  /** The target card, or `undefined` for a panel/empty-space (create) action. */
  readonly asset?: AssetActionTarget | undefined;
  /** The folder currently being browsed (the create target). */
  readonly folder: string;
  /** Panel operations an action drives (inline create/rename, delete). */
  readonly host: AssetActionHost;
}

/**
 * One contributed asset context-menu action. Registered by the editor or an end
 * user's project against a scope (a specific asset type/kind, all assets, or the
 * panel). `run` does the work — typically by calling back into the {@link
 * AssetActionHost} on the context.
 */
export interface AssetAction {
  /** Stable id (dedupe / diagnostics). */
  readonly id: string;
  /** Menu label. */
  readonly label: string;
  readonly icon?: IconName | undefined;
  readonly shortcut?: string | undefined;
  /** Render in the danger tone (e.g. Delete). */
  readonly danger?: boolean | undefined;
  /** Nest under a submenu with this label, e.g. `'Animation'` → `Animation ▸ …`. */
  readonly group?: string | undefined;
  /** Sort order within its menu (lower first). Defaults to 100. */
  readonly order?: number | undefined;
  /** Draw a separator immediately before this (top-level) entry. */
  readonly separatorBefore?: boolean | undefined;
  /** Whether the action applies to `ctx` (hidden entirely when it returns false). Defaults to shown. */
  readonly when?: ((ctx: AssetActionContext) => boolean) | undefined;
  /** Perform the action. */
  readonly run: (ctx: AssetActionContext) => void;
}

const DEFAULT_ORDER = 100;

const toEntry = (action: AssetAction, ctx: AssetActionContext): MenuEntry => ({
  label: action.label,
  icon: action.icon,
  shortcut: action.shortcut,
  ...(action.danger === true ? { danger: true } : {}),
  onClick: () => action.run(ctx),
});

/**
 * Assemble a sorted `MenuEntry[]` from `actions`: grouped actions collapse into a
 * submenu placed at the first (sorted) position of their group; ungrouped actions
 * render as top-level items. `separatorBefore` inserts a rule before a top-level
 * entry.
 */
const buildMenu = (actions: readonly AssetAction[], ctx: AssetActionContext): MenuEntry[] => {
  const visible = actions
    .filter((a) => a.when?.(ctx) ?? true)
    .sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
  const out: MenuEntry[] = [];
  const groups = new Map<string, MenuEntry[]>();
  for (const a of visible) {
    if (a.group !== undefined) {
      let bucket = groups.get(a.group);
      if (bucket === undefined) {
        bucket = [];
        groups.set(a.group, bucket);
        out.push({ label: a.group, submenu: bucket });
      }
      bucket.push(toEntry(a, ctx));
      continue;
    }
    if (a.separatorBefore === true) out.push({ separator: true });
    out.push(toEntry(a, ctx));
  }
  return out;
};

/**
 * The registry of asset context-menu actions, keyed by scope. The editor seeds it
 * with its own actions (Open / Rename / Delete / type-specific / create); an end
 * user's project registers more the same way. Three scopes:
 *
 * - **type** — shown for a specific browser {@link AssetType} or a raw asset kind
 *   string (so a project's own kind works), matched against the target card.
 * - **all** — shown for every asset card.
 * - **panel** — shown on the panel's empty space (create actions).
 *
 * Menus are built lazily each frame from the live context, so `when` / `danger` /
 * labels reflect current state.
 */
export class AssetActionRegistry {
  private readonly byType = new Map<string, AssetAction[]>();
  private readonly forAllActions: AssetAction[] = [];
  private readonly forPanelActions: AssetAction[] = [];

  /** Register `action` for a browser {@link AssetType} or a raw asset-kind string. Chainable. */
  registerForType(key: AssetType | string, action: AssetAction): this {
    const bucket = this.byType.get(key);
    if (bucket === undefined) this.byType.set(key, [action]);
    else bucket.push(action);
    return this;
  }

  /** Register `action` for every asset card. Chainable. */
  registerForAll(action: AssetAction): this {
    this.forAllActions.push(action);
    return this;
  }

  /** Register `action` on the panel's empty space (a create action). Chainable. */
  registerForPanel(action: AssetAction): this {
    this.forPanelActions.push(action);
    return this;
  }

  /** Build the right-click menu for a target card: all-asset actions + its type's + its kind's. */
  buildAssetMenu(ctx: AssetActionContext): MenuEntry[] {
    const target = ctx.asset;
    const actions: AssetAction[] = [...this.forAllActions];
    if (target !== undefined) {
      actions.push(...(this.byType.get(target.type) ?? []));
      if (target.assetKind !== target.type) actions.push(...(this.byType.get(target.assetKind) ?? []));
    }
    return buildMenu(actions, ctx);
  }

  /** Build the empty-space (create) menu for the panel. */
  buildPanelMenu(ctx: AssetActionContext): MenuEntry[] {
    return buildMenu(this.forPanelActions, ctx);
  }
}

/** Create an empty {@link AssetActionRegistry}. */
export const createAssetActionRegistry = (): AssetActionRegistry => new AssetActionRegistry();
