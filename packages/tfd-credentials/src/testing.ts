/** tfd-credentials/testing: contract suites for adapters, and test-only keys, entropy and an object store. */

export {
	type ContractCase,
	credentialStoreContract,
	statusListStoreContract,
} from "./testing/contracts.js";
export {
	createTestKey,
	seededRandomBytes,
	type TestKey,
} from "./testing/keys.js";
export { memoryObjectStore } from "./testing/memory-object-store.js";
