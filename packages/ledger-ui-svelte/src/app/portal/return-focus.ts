const focusReturnMilliseconds = 3000;

/** Exit hands the page back to the Members tab, whose roster loads again. Once the person's row is there, focus goes to
 * its ⋯ button (else its name button), as a dialog returns it to the control that opened it; if focus has gone somewhere
 * else meanwhile, it stays there (the Preact portal.tsx `returnFocusToRow`). */
export function returnFocusToRow(profileId: string): void {
	const row = `[data-test=member-row][data-id="${profileId.replaceAll('"', '\\"')}"]`;
	const opener = (): HTMLElement | null =>
		document.querySelector<HTMLElement>(
			`${row} [data-test=member-menu-button]`,
		) ?? document.querySelector<HTMLElement>(`${row} button`);
	const watcher = new MutationObserver(() => {
		const found = opener();
		if (!found) return;
		watcher.disconnect();
		const focused = document.activeElement;
		if (!focused || focused === document.body) found.focus();
	});
	watcher.observe(document.body, { childList: true, subtree: true });
	setTimeout(() => watcher.disconnect(), focusReturnMilliseconds);
}
