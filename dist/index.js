import { ValkeyStorage } from './storage.js';
export { ValkeyStorage };
export * from './types.js';
// Export factory function for Node-RED
export default function createStorage() {
    return new ValkeyStorage();
}
// Also export as module.exports for CommonJS compatibility
export const storageModule = createStorage();
//# sourceMappingURL=index.js.map