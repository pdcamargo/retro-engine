import { ImGui, ImGuiTableColumnFlags, ImGuiTableFlags, ImVec2 } from '@mori2003/jsimgui';

/** A column in a {@link DataTableOptions}. */
export interface DataColumn<Row> {
  /** Stable key (also the column id). */
  readonly key: string;
  /** Header text. */
  readonly label: string;
  /** Fixed width in px; omit for a stretch column. */
  readonly width?: number;
  /** Right-align (use for tabular numerics). */
  readonly right?: boolean;
  /** Allow sorting on this column. */
  readonly sortable?: boolean;
  /** Draw this row's cell for the column. */
  readonly render: (row: Row, index: number) => void;
}

/** Border style for a {@link DataTableOptions}. */
export type TableBorders = 'none' | 'h' | 'inner' | 'all';

/** Options for {@link Widgets.dataTable}. */
export interface DataTableOptions<Row> {
  readonly id: string;
  readonly columns: readonly DataColumn<Row>[];
  readonly rows: readonly Row[];
  /** Zebra row striping. */
  readonly rowBg?: boolean;
  readonly borders?: TableBorders;
  /** Tighten row padding. */
  readonly dense?: boolean;
  /** Cap the body height and scroll under a sticky header. */
  readonly maxHeight?: number;
}

const bordersFlag = (b: TableBorders | undefined): number => {
  switch (b) {
    case 'all':
      return ImGuiTableFlags.Borders;
    case 'inner':
      return ImGuiTableFlags.BordersInner;
    case 'h':
      return ImGuiTableFlags.BordersInnerH | ImGuiTableFlags.BordersOuterH;
    case 'none':
    default:
      return 0;
  }
};

/** Render a sortable, zebra, scrollable data grid with a sticky header. */
export const dataTable = <Row>(options: DataTableOptions<Row>): void => {
  let flags = ImGuiTableFlags.RowBg | ImGuiTableFlags.NoSavedSettings | bordersFlag(options.borders);
  if (options.rowBg === false) flags &= ~ImGuiTableFlags.RowBg;
  if (options.maxHeight !== undefined) flags |= ImGuiTableFlags.ScrollY;
  const outer = new ImVec2(0, options.maxHeight ?? 0);
  if (!ImGui.BeginTable(`tbl-${options.id}`, options.columns.length, flags, outer)) return;
  for (const col of options.columns) {
    let cflags = col.width !== undefined ? ImGuiTableColumnFlags.WidthFixed : ImGuiTableColumnFlags.WidthStretch;
    if (col.sortable !== true) cflags |= ImGuiTableColumnFlags.NoSort;
    ImGui.TableSetupColumn(col.label, cflags, col.width ?? 0);
  }
  ImGui.TableSetupScrollFreeze(0, 1);
  ImGui.TableHeadersRow();
  for (const [r, row] of options.rows.entries()) {
    ImGui.TableNextRow(0, options.dense === true ? 22 : 0);
    for (const [c, col] of options.columns.entries()) {
      ImGui.TableSetColumnIndex(c);
      col.render(row, r);
    }
  }
  ImGui.EndTable();
};
