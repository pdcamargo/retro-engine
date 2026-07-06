/**
 * A parsed compound selector (no combinators in this phase): an optional element
 * type, an optional `#name`, zero or more `.class`es, and zero or more `:state`
 * pseudo-classes (`Button.primary:hover`). `*` sets {@link universal}.
 */
export interface RssSelector {
  readonly type?: string;
  readonly name?: string;
  readonly classes: readonly string[];
  readonly states: readonly string[];
  readonly universal: boolean;
}

/** One `property: value` pair from a rule body. */
export interface RssDeclaration {
  readonly property: string;
  readonly value: string;
}

/**
 * One selector + its declarations, plus the 0-based source order used to break
 * specificity ties (later wins). A comma-separated selector list expands to one
 * rule per selector.
 */
export interface RssRule {
  readonly selector: RssSelector;
  readonly declarations: readonly RssDeclaration[];
  readonly order: number;
}

const SELECTOR_TOKEN = /(\*)|#([\w-]+)|\.([\w-]+)|:([\w-]+)|([A-Za-z_][\w-]*)/g;

/** Parse a single compound selector string into an {@link RssSelector}. */
export const parseSelector = (text: string): RssSelector => {
  const classes: string[] = [];
  const states: string[] = [];
  let type: string | undefined;
  let name: string | undefined;
  let universal = false;

  SELECTOR_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SELECTOR_TOKEN.exec(text)) !== null) {
    if (match[1] !== undefined) universal = true;
    else if (match[2] !== undefined) name = match[2];
    else if (match[3] !== undefined) classes.push(match[3]);
    else if (match[4] !== undefined) states.push(match[4]);
    else if (match[5] !== undefined) type = match[5];
  }

  return {
    ...(type !== undefined ? { type } : {}),
    ...(name !== undefined ? { name } : {}),
    classes,
    states,
    universal: universal && type === undefined && name === undefined && classes.length === 0,
  };
};

const parseDeclarations = (body: string): RssDeclaration[] => {
  const out: RssDeclaration[] = [];
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const property = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (property !== '' && value !== '') out.push({ property, value });
  }
  return out;
};

/**
 * Parse a `.rss` (USS/CSS-subset) stylesheet into flat {@link RssRule}s. Supports
 * comments, comma-separated selector lists, and compound selectors (type /
 * `#name` / `.class` / `:state` / `*`). Combinators, `@`-rules, and nested blocks
 * are not parsed in this phase (a rule with no `{ … }` body is skipped).
 */
export const parseRss = (source: string): RssRule[] => {
  const noComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: RssRule[] = [];
  let order = 0;
  for (const chunk of noComments.split('}')) {
    const brace = chunk.indexOf('{');
    if (brace < 0) continue;
    const selectorText = chunk.slice(0, brace).trim();
    if (selectorText === '') continue;
    const declarations = parseDeclarations(chunk.slice(brace + 1));
    for (const group of selectorText.split(',')) {
      const trimmed = group.trim();
      if (trimmed === '') continue;
      rules.push({ selector: parseSelector(trimmed), declarations, order: order++ });
    }
  }
  return rules;
};
