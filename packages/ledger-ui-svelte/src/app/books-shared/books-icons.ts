import type { Shape } from "../icons.ts";
import type { PaneIconName } from "../pane-icons.ts";

const path = (d: string): Shape => ({ tag: "path", d });

/** The mockup's icons (its `IC` table) that only the Ledger and Reports tabs draw and neither the shell nor the other
 * panes do; the same shapes as packages/ledger-ui/src/app/icon.tsx. */
export const booksShapes = {
	bank: [path("M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18")],
	dot: [{ tag: "circle", cx: 12, cy: 12, r: 2 }],
	gift: [
		{ tag: "rect", x: 3, y: 8, width: 18, height: 4, rx: 0 },
		path("M12 8v13M5 12v9h14v-9M12 8c-2-4-6-3-5 0M12 8c2-4 6-3 5 0"),
	],
	receipt: [path("M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2V3zM9 8h6M9 12h6")],
} as const satisfies Record<string, readonly Shape[]>;

export type BooksIconName = PaneIconName | keyof typeof booksShapes;

export const isBooksIcon = (
	name: BooksIconName,
): name is keyof typeof booksShapes => name in booksShapes;
