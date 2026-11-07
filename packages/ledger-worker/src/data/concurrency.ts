/** `map` over `items` with at most `limit` running at once; results keep the order of `items`. */
export const mapLimited = async <Item, Result>(
	items: readonly Item[],
	limit: number,
	map: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
	const results: Result[] = new Array(items.length);
	let next = 0;
	const lane = async (): Promise<void> => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await map(items[index] as Item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, lane),
	);
	return results;
};
