<script lang="ts" generics="Row">
	import { onDestroy } from "svelte";
	import {
		type CsvColumn,
		type DownloadFile,
		csvMediaType,
		downloadedToast,
		toCsv,
	} from "$contract/data/ledger.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import { useApp } from "../context.ts";
	import { link } from "../panes/styles.ts";
	import { notifySuccess, retryingWrite } from "../panes/writes.ts";
	import BooksIcon from "./BooksIcon.svelte";

	/** A CSV download (mockup `kSave`) through the Writer's `download`, the one way the books panes make a file: the file
	 * is the contract's `toCsv` over the columns and rows as they stand at the click, and what is sent is that file, for
	 * the `scope` (a school) of the click, whatever the pane shows later. The button is busy and disabled while the
	 * Writer works. A write that was sent is never aborted: its failure is a toast from the message table with Retry (the
	 * same request, so the same `Idempotency-Key`) and the button offered again; its success toasts the rows once the
	 * Writer has answered, and only if the person is still looking at that `scope`. */
	let {
		test,
		kind,
		title,
		label,
		name,
		columns,
		rows,
		scope,
	}: {
		test: string;
		/** `link` (the Ledger's and the donors card's) or `button` (Reports'). */
		kind: "link" | "button";
		title: string;
		label: string;
		name: string;
		columns: ReadonlyArray<CsvColumn<Row>>;
		rows: ReadonlyArray<Row>;
		scope: string;
	} = $props();

	const app = useApp();
	let busy = $state(false);
	/** The pane is gone: a write that finishes then says nothing. */
	let gone = false;
	onDestroy(() => {
		gone = true;
	});

	const save = (): void => {
		const file: DownloadFile = { name, type: csvMediaType, text: toCsv(columns, rows) };
		const count = rows.length;
		const sentFor = scope;
		retryingWrite(app, (writer) => writer.download(file), {
			value: () => {
				if (!gone && scope === sentFor)
					notifySuccess(app, downloadedToast(count));
			},
			busy: (next) => {
				busy = next;
			},
		}).run();
	};
</script>

{#if kind === "link"}
	<button
		type="button"
		class={[link, "[&_svg]:mr-1"]}
		data-test={test}
		{title}
		aria-busy={busy}
		disabled={busy}
		onclick={save}
	><BooksIcon name="download" />{label}</button>
{:else}
	<Button
		variant="tool"
		size="tool"
		data-test={test}
		{title}
		aria-busy={busy}
		disabled={busy}
		onclick={save}
	><BooksIcon name="download" />{label}</Button>
{/if}
