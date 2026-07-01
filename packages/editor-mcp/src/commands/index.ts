import type { CommandDef } from '../registry';
import { CommandRegistry } from '../registry';

import { assetCommands } from './asset';
import { componentCommands } from './component';
import { composerCommands } from './composer';
import { entityCommands } from './entity';
import { graphCommands } from './graph';
import { hierarchyCommands } from './hierarchy';
import { historyCommands } from './history';
import { logCommands } from './logs';
import { panelCommands } from './panels';
import { prefabCommands } from './prefab';
import { rendererCommands } from './renderer';
import { sceneCommands } from './scene';
import { screenshotCommands } from './screenshot';
import { selectionCommands } from './selection';
import { studioCommands } from './studio';

/** The built-in command set, in domain order. */
export const defaultCommands: readonly CommandDef[] = [
  ...studioCommands,
  ...selectionCommands,
  ...hierarchyCommands,
  ...entityCommands,
  ...componentCommands,
  ...assetCommands,
  ...prefabCommands,
  ...sceneCommands,
  ...historyCommands,
  ...rendererCommands,
  ...logCommands,
  ...panelCommands,
  ...composerCommands,
  ...screenshotCommands,
  ...graphCommands,
];

/** A registry pre-loaded with every built-in command. Add plugin commands before connecting. */
export const createDefaultRegistry = (): CommandRegistry => new CommandRegistry().addAll(defaultCommands);
