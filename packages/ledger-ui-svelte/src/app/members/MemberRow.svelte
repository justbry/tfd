<script lang="ts">
	import type { MembersSummary, Member, Person } from "$contract/data/members.ts";
	import type { School } from "$contract/data/types.ts";
	import { Badge } from "$lib/components/ui/badge/index.ts";
	import { Button } from "$lib/components/ui/button/index.ts";
	import * as Table from "$lib/components/ui/table/index.ts";
	import PaneIcon from "../PaneIcon.svelte";
	import { cell, mono, muted, paneBadge } from "../panes/styles.ts";
	import { badgeTones } from "../styles.ts";
	import AttentionBadges from "./AttentionBadges.svelte";
	import AudienceChip from "./AudienceChip.svelte";
	import BalanceBar from "./BalanceBar.svelte";
	import FinanceChip from "./FinanceChip.svelte";
	import MemberMenuButton from "./MemberMenuButton.svelte";
	import {
		type Change,
		formatDay,
		formatPeriodEnd,
		project,
		type Standing,
	} from "./members-model.ts";
	import RoleChip from "./RoleChip.svelte";
	import type { AttentionReason } from "$contract/data/members.ts";

	/** A person's row (mockup `tr.row`): name and id, role and audience chips, the plan with the reasons it needs
	 * attention, the three-segment balance bar, what is available (with a pending change and what is held), when it
	 * expires, and the actions. A role holder with no plan says "No plan", never 0. A click on the row opens the
	 * drawer; the buttons keep their own. */
	let {
		person,
		member,
		standing,
		reasons,
		changes,
		school,
		unit,
		menuOpen,
		onOpen,
		onMenu,
		onViewAs,
	}: {
		person: Person;
		member: Member | null;
		standing: Standing | null;
		reasons: AttentionReason[];
		changes: Change[];
		school: School;
		unit: MembersSummary["unit"];
		menuOpen: boolean;
		onOpen: () => void;
		onMenu: (button: HTMLElement, focusFirst: boolean) => void;
		onViewAs: () => void;
	} = $props();

	const balance = $derived(member?.balances[0]);
	const projection = $derived(balance ? project(balance, person.id, changes) : null);
	const noPlan = "text-muted-foreground italic";
</script>

<Table.Row
	class="cursor-pointer [&>td]:hover:bg-secondary"
	data-test="member-row"
	data-id={person.id}
	onclick={(event) => {
		if (!(event.target instanceof Element && event.target.closest("button"))) onOpen();
	}}
>
	<Table.Cell class={[cell, "whitespace-normal"]}>
		<b data-test="member-name">
			<button
				type="button"
				class="cursor-pointer border-0 bg-transparent p-0 text-left [font-weight:inherit] text-foreground hover:underline"
				aria-haspopup="dialog"
				onclick={onOpen}>{person.name}</button
			>
		</b>
		{#if person.you}{" "}<span class={muted} data-test="you-tag">(you)</span>{/if}
		{#if person.family}
			<span
				class="ml-1.5 inline-flex items-center gap-[3px] text-[10px] text-muted-foreground"
				data-test="family-chip"
				title={`Family key ${person.family.key}`}
			><PaneIcon name="users" class="size-[11px]" />{person.family.label}</span>
		{/if}
		<div class={[mono, muted]} data-test="member-id">{person.id}</div>
	</Table.Cell>
	<Table.Cell class={[cell, "whitespace-normal"]}>
		<RoleChip role={person.role} />
		<FinanceChip {person} />
		<AudienceChip {person} />
	</Table.Cell>
	{#if member && balance && projection && standing}
		<Table.Cell class={[cell, "whitespace-normal"]}>
			<span data-test="member-plan">{member.tierName} ×{member.quantity}</span>{" "}
			{#if reasons.length > 0}
				<AttentionBadges {reasons} unitPlural={unit.other} />
			{:else if standing.canceled}
				<Badge class={paneBadge} data-test="status-badge">Canceled</Badge>
			{/if}
			{#if standing.cancelsAtPeriodEnd}
				{" "}<Badge class={paneBadge} data-test="status-badge">Cancels {formatPeriodEnd(member.currentPeriodEnd, school.timeZone)}</Badge>
			{/if}
		</Table.Cell>
		<Table.Cell class={[cell, "w-[140px]"]}><BalanceBar {balance} {projection} /></Table.Cell>
		<Table.Cell class={[cell, "text-right tabular-nums"]} data-test="member-available">
			{projection.reported}{#if projection.available !== projection.reported}{" "}<Badge
					class={[paneBadge, badgeTones.warning]}
					data-test="pending-badge"
					title="Shows after the pending change ships"
					><PaneIcon name="clock" class="mr-[3px] size-[11px]" />→ {projection.available}</Badge
				>{/if}/{balance.granted}{#if projection.held > 0}{" "}<Badge
					class={paneBadge}
					data-test="held-badge"
					title="Held for upcoming bookings">+{projection.held} held</Badge
				>{/if}
		</Table.Cell>
		<Table.Cell
			class={[cell, !standing.endsToday && balance.expiresAt === null && muted]}
			data-test="member-expires"
		>
			{standing.endsToday ? "Today" : balance.expiresAt === null ? "—" : formatDay(balance.expiresAt, school.timeZone)}
		</Table.Cell>
	{:else}
		<Table.Cell class={[cell, noPlan]} data-test="member-plan">No plan</Table.Cell>
		<Table.Cell class={cell}></Table.Cell>
		<Table.Cell class={[cell, "text-right", noPlan]} data-test="member-available">no plan</Table.Cell>
		<Table.Cell class={[cell, muted]} data-test="member-expires">—</Table.Cell>
	{/if}
	<Table.Cell class={[cell, "text-right"]}>
		<div class="flex justify-end gap-1">
			{#if member}
				<Button
					variant="tool"
					size="tool-small"
					class="px-1.5"
					data-test="view-as-member"
					aria-label={`View ${person.name} as member`}
					title="View as member"
					onclick={onViewAs}
				><PaneIcon name="eye" /></Button>
			{/if}
			<MemberMenuButton name={person.name} expanded={menuOpen} onOpen={onMenu} />
		</div>
	</Table.Cell>
</Table.Row>
