/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_LEDGER_SOURCE?: string;
	readonly VITE_API_BASE?: string;
	readonly VITE_LEDGER_WORKER_BASE?: string;
}
