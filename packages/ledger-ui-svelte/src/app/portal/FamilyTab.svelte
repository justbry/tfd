<script lang="ts">
	import { count } from "$contract/app/portal-format.ts";
	import type { MemberPortal, PortalMember } from "$contract/data/portal.ts";
	import type { School } from "$contract/data/types.ts";
	import { bookingsOf, familyRoleLabel, whenOf } from "./portal-model.ts";
	import { bigSmall, card, cardFlat, cardTitle, muted, rowBetween } from "./styles.ts";
	import UsageBar from "./UsageBar.svelte";

	/** The Family tab of the member's view (mockup `mpFam`): each person of the portal with the plan, the balance and the
	 * bookings the server scoped to this view. An account with no family says so. */
	let { school, portal, viewed }: { school: School; portal: MemberPortal; viewed: PortalMember } = $props();
	const unit = $derived(school.creditUnit);
</script>

{#if !portal.family}
	<div class="mb-3 rounded-(--mp-rad) border border-(--mp-border) bg-(--mp-card) p-3.5 text-(--mp-muted)" data-test="portal-empty">No family on this account. You see only your own {unit.other} and bookings.</div>
{:else}
	<div class="grid gap-2.5">
		<div class={muted} data-test="portal-family-note">
			{portal.scope === "family"
				? `${portal.family.label}: as the adult you see everyone's ${unit.other} and bookings.`
				: `You see only your own ${unit.other} and bookings. The adult on the account sees the rest of the family.`}
		</div>
		{#each portal.people as person (person.profileId)}
			{@const bookings = bookingsOf(portal, person.profileId)}
			<div class={cardFlat} data-test="portal-family-card" data-profile={person.profileId}>
				<div class={rowBetween}>
					<div>
						<h4 class={cardTitle}>{person.name}{person.profileId === viewed.profileId ? " (you)" : ""}</h4>
						<div class={muted}>{person.familyRole ? familyRoleLabel(person.familyRole) : ""} · {person.tierName} ×{person.quantity}</div>
					</div>
					{#each person.balances as balance (balance.featureId)}
						<div class="text-right">
							<div class={bigSmall} data-test="portal-available">{balance.available}</div>
							<div class={muted}>{balance.unit.other} available</div>
						</div>
					{/each}
				</div>
				{#each person.balances as balance (balance.featureId)}
					<UsageBar {balance} />
				{/each}
				<div class={[muted, "mt-2"]}>
					{#if bookings.length === 0}
						No upcoming bookings.
					{:else}
						{#each bookings as booking, index (booking.id)}
							{#if index > 0}<br />{/if}{booking.service} · {whenOf(booking)}{booking.held > 0 ? ` · ${count(booking.held, unit)} held` : ""}
						{/each}
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
