import { ImGui, ImGuiKey } from '@mori2003/jsimgui';
import { type Entity } from '@retro-engine/ecs';
import {
  type AssetDragPayload,
  buildOutline,
  type DragPayload,
  Draw,
  drawIcon,
  type EditorContext,
  type EntityDragPayload,
  getActivePalette,
  Keys,
  type PanelDef,
  srgbU32,
} from '@retro-engine/editor-sdk';
import { type App, AppTypeRegistry, Parent } from '@retro-engine/engine';

import { openComposer } from './composer/composer-state';
import { INSTANTIABLE_KINDS, instantiateAsset, reparentEntity, type RunCommand } from './dnd-actions';
import { EditorOnly } from './editor-markers';
import { studioClassifiers } from './entity-classifiers';
import { createHierarchyActions, hierarchyRootMenu, hierarchyRowMenu } from './hierarchy-actions';
import { computeHierarchyDecorations } from './hierarchy-decorations';
import { type StudioState } from './state';

/** Whether a drag payload is an instantiable asset (scene/prefab/glTF/mesh). */
const isInstantiableDrag = (payload: DragPayload): boolean =>
  payload.kind === 'asset' && INSTANTIABLE_KINDS.has((payload as AssetDragPayload).assetKind);

/**
 * Whether dragging `dragged` under `target` is a valid reparent: not onto itself,
 * not onto one of its own descendants (which would form a cycle), and not onto the
 * parent it already has (a no-op). Walks `Parent` up from `target`.
 */
const canReparent = (app: App, dragged: Entity, target: Entity): boolean => {
  if (dragged === target) return false;
  let cursor: Entity | undefined = target;
  const guard = new Set<Entity>();
  while (cursor !== undefined && !guard.has(cursor)) {
    if (cursor === dragged) return false; // target sits inside dragged's subtree
    guard.add(cursor);
    const p = app.world.getComponent(cursor, Parent) as { entity: Entity } | undefined;
    cursor = p !== undefined ? p.entity : undefined;
  }
  // Reject a drop onto the entity that is already the drag's parent (no-op edit).
  const draggedParent = app.world.getComponent(dragged, Parent) as { entity: Entity } | undefined;
  return draggedParent === undefined || draggedParent.entity !== target;
};

/** The HIERARCHY panel — the live entity tree with filter, selection, expand/collapse, and edit actions. */
export const hierarchyPanel = (state: StudioState, app: App, runCommand: RunCommand): PanelDef => {
  const actions = createHierarchyActions(state, runCommand);
  return {
    id: '/hierarchy',
    title: 'Hierarchy',
    icon: 'list-tree',
    slot: 'left',
    flush: true,
    render: ({ ui, widgets }: EditorContext): void => {
      const p = getActivePalette();
      const SEARCH_H = 38;
      const FOOTER_H = 26;
      const totalH = ui.contentAvail()[1];

      // Search + header actions strip, with a 1px bottom hairline.
      const searchTop = ui.cursorScreenPos();
      ui.child('hier-search', { size: [0, SEARCH_H], border: false, padding: [8, 6] }, () => {
        const avail = ui.contentAvail()[0];
        const h = ui.frameHeight();
        const it = ui.cursorScreenPos();
        drawIcon('search', [it[0], it[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
        ui.dummy([18, h]);
        ui.sameLine(0, 4);
        state.entityFilter = ui.inputText('##entity-filter', state.entityFilter, {
          hint: 'Filter entities…',
          width: avail - 78,
        });
        ui.sameLine(0, 4);
        if (widgets.iconButton('hier-add', 'plus', { tooltip: 'Create entity', size: 'sm' })) {
          openComposer(state.composer, 'create');
        }
        ui.sameLine(0, 2);
        if (widgets.iconButton('hier-collapse', 'chevrons-down-up', { tooltip: 'Collapse all', size: 'sm' })) {
          for (const node of buildOutline(app.world)) if (node.hasChildren) state.collapsed.add(node.entity);
        }
      });
      Draw.window().line([searchTop[0], searchTop[1] + SEARCH_H], [searchTop[0] + 9999, searchTop[1] + SEARCH_H], srgbU32(p.borderSubtle));

      // Read the live world into a flattened tree each frame. Collapsed subtrees
      // are omitted by the reader; selection + expand state live on StudioState
      // keyed by entity (the model is rebuilt, so it can't live on the nodes).
      const filter = state.entityFilter.trim().toLowerCase();
      const nodes = buildOutline(app.world, {
        isOpen: (e) => !state.collapsed.has(e),
        // Editor-owned entities (cameras, lights, helpers) are hidden from the
        // authored tree unless debug mode reveals them.
        skip: (e) => !state.debugMode && app.world.has(e, EditorOnly),
        classifiers: studioClassifiers,
        // Badge counts non-derived components so it matches the inspector; in debug
        // mode the inspector also lists derived ones, so count everything.
        registry: state.debugMode ? undefined : app.getResource(AppTypeRegistry)!.registry,
      });
      // Per-frame instance/model styling: prefab/scene/model tone + source name +
      // override dot for instance roots, and the inherited set for recessing
      // reactor-spawned children.
      const deco = computeHierarchyDecorations(app, p);
      const treeH = Math.max(48, totalH - SEARCH_H - FOOTER_H - 8);
      ui.child('hier-tree', { size: [0, treeH], border: false, padding: [4, 4] }, () => {
        ui.withItemSpacing(0, 0, () => {
          // A virtual "create empty" row: an inline field with no backing entity;
          // committing spawns it under `entityDraft.parent`. Rendered right after
          // its parent's row (or at root level below), reusing the shared buffer.
          const drawDraft = (depth: number): void => {
            const result = widgets.treeItem({
              id: '__entity-draft__',
              label: state.entityEditBuffer,
              icon: 'circle-dot',
              depth,
              editing: { value: state.entityEditBuffer, focus: state.entityEditFocus },
            });
            state.entityEditFocus = false;
            if (result.edit !== undefined) {
              state.entityEditBuffer = result.edit.value;
              if (result.edit.cancel) actions.cancelEdit();
              else if (result.edit.commit) actions.commitCreate(result.edit.value);
            }
          };

          for (const node of nodes) {
            if (filter !== '' && !node.name.toLowerCase().includes(filter)) continue;
            const row = deco.roots.get(node.entity);
            const renaming = state.renamingEntity === node.entity;
            const result = widgets.treeItem({
              id: String(node.entity),
              label: node.name,
              icon: row?.icon ?? node.class.icon,
              depth: node.depth,
              hasChildren: node.hasChildren,
              open: !state.collapsed.has(node.entity),
              selected: state.selectedEntity === node.entity,
              badge: node.componentCount > 0 ? String(node.componentCount) : undefined,
              ...(row !== undefined ? { accent: row.accent, overridden: row.overridden } : {}),
              ...(row?.suffix !== undefined ? { suffix: row.suffix } : {}),
              recessed: deco.inherited.has(node.entity),
              ...(renaming ? { editing: { value: state.entityEditBuffer, focus: state.entityEditFocus } } : {}),
              onContextMenu: () => widgets.contextMenu(String(node.entity), hierarchyRowMenu(actions, node.entity, node.name)),
              // Drag the entity out (e.g. onto the assets panel to author a prefab);
              // drop another entity onto this row to reparent it, or a prefab/scene
              // to instantiate it as a child of this entity.
              dnd: {
                source: { payload: { kind: 'entity', entity: node.entity, label: node.name } },
                target: {
                  accepts: (payload) =>
                    isInstantiableDrag(payload) ||
                    (payload.kind === 'entity' && canReparent(app, (payload as EntityDragPayload).entity, node.entity)),
                  onDrop: (payload) => {
                    if (payload.kind === 'entity') {
                      reparentEntity(runCommand, (payload as EntityDragPayload).entity, node.entity);
                    } else {
                      const a = payload as AssetDragPayload;
                      instantiateAsset(runCommand, a.guid, a.assetKind, { parent: node.entity });
                    }
                  },
                },
              },
            });
            if (renaming) {
              state.entityEditFocus = false;
              if (result.edit !== undefined) {
                state.entityEditBuffer = result.edit.value;
                if (result.edit.cancel) actions.cancelEdit();
                else if (result.edit.commit) actions.commitRename(node.entity, result.edit.value);
              }
            } else if (result.toggled) {
              if (state.collapsed.has(node.entity)) state.collapsed.delete(node.entity);
              else state.collapsed.add(node.entity);
            } else if (result.clicked) {
              state.selectedEntity = node.entity;
              state.selectedAsset = null;
            }
            if (state.entityDraft !== null && state.entityDraft.parent === node.entity) drawDraft(node.depth + 1);
          }
          // A pending root-level "create empty" renders below the tree.
          if (state.entityDraft !== null && state.entityDraft.parent === null) drawDraft(0);

          // Empty space below the rows: drop a prefab/scene to spawn at the scene
          // root, or an entity to unparent it to the root.
          const rest = ui.contentAvail();
          if (rest[1] > 4) {
            ui.invisibleButton('hier-drop-root', [Math.max(rest[0], 1), rest[1]]);
            ui.dropTarget({
              accepts: (payload) =>
                isInstantiableDrag(payload) ||
                // Moving to the root is only meaningful for an entity that has a parent.
                (payload.kind === 'entity' &&
                  app.world.getComponent((payload as EntityDragPayload).entity, Parent) !== undefined),
              onDrop: (payload) => {
                if (payload.kind === 'entity') {
                  reparentEntity(runCommand, (payload as EntityDragPayload).entity, null);
                } else {
                  const a = payload as AssetDragPayload;
                  instantiateAsset(runCommand, a.guid, a.assetKind);
                }
              },
            });
            // The drop button covers the empty area below the rows, and the window
            // menu's NoOpenOverItems won't fire over it — anchor the create menu to
            // the button so a right-click anywhere in that area still works.
            widgets.contextMenu('hier-drop-root', hierarchyRootMenu(actions));
          }
          // Right-clicking the tree background (the thin void not covered by the
          // drop button) opens the create menu too; a row's own menu wins over it.
          widgets.contextMenuWindow('hierarchy', hierarchyRootMenu(actions));

          // With the tree focused and no active edit: F2 rename, Delete removes,
          // ⌘/Ctrl+D duplicates the selected entity.
          const sel = state.selectedEntity;
          if (
            sel !== null &&
            state.renamingEntity === null &&
            state.entityDraft === null &&
            !ImGui.GetIO().WantTextInput &&
            ui.isWindowFocused()
          ) {
            const selName = nodes.find((n) => n.entity === sel)?.name ?? '';
            if (ui.isKeyPressed(Keys.F2)) actions.beginRename(sel, selName);
            else if (ui.isKeyPressed(Keys.Delete)) actions.deleteEntity(sel);
            else if (ImGui.IsKeyChordPressed(ImGuiKey.ImGuiMod_Ctrl | ImGuiKey._D)) actions.duplicate(sel);
          }
        });
      });
      const footTop = ui.cursorScreenPos();
      Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
      ui.child('hier-footer', { size: [0, 0], border: false, padding: [8, 6] }, () => {
        ui.textColored([0.2, 0.88, 0.48, 1], String(nodes.length));
        ui.sameLine(0, 5);
        ui.textDisabled('entities');
      });
    },
  };
};
