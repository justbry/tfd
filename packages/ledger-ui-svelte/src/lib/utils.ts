import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn-svelte's class joiner: later Tailwind classes win over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

/** The prop helpers shadcn-svelte's components import from `$lib/utils`. */
type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, "child"> : T;
type WithoutChildren<T> = T extends { children?: unknown }
	? Omit<T, "children">
	: T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};
