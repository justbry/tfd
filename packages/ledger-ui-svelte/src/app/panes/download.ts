import {
	type CsvColumn,
	csvMediaType,
	type DownloadFile,
	downloadedToast,
	toCsv,
} from "$contract/data/ledger.ts";
import { run } from "../../effect/run.ts";
import { type AppContext, perform } from "../context.ts";
import { notifySuccess } from "./writes.ts";

const revokeAfterMilliseconds = 1000;

/** Saves a file in the browser through a temporary link, as the mockup's `kSave` does: the member drawer's history,
 * which its golden file keeps out of the Writer (the Preact package's download.ts `saveFile`). */
export function saveFile({ name, type, text }: DownloadFile): void {
	const address = URL.createObjectURL(new Blob([text], { type }));
	const link = document.createElement("a");
	link.href = address;
	link.download = name;
	link.hidden = true;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(address), revokeAfterMilliseconds);
}

export type CsvFile<Row> = {
	name: string;
	columns: ReadonlyArray<CsvColumn<Row>>;
	rows: ReadonlyArray<Row>;
};

/** A CSV download (mockup `kSave`): the file is the contract's `toCsv` over the columns and rows; the browser keeps
 * it, and the toast counts the rows once it is saved. A browser that refuses is a failure like any other of the app's:
 * logged, and a toast from the message table. */
export async function saveCsv<Row>(
	context: AppContext,
	{ name, columns, rows }: CsvFile<Row>,
): Promise<void> {
	const outcome = await perform(
		context,
		run(async () =>
			saveFile({ name, type: csvMediaType, text: toCsv(columns, rows) }),
		),
	);
	if (outcome.ok) notifySuccess(context, downloadedToast(rows.length));
}
