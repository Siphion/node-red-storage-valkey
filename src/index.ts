import { ValkeyStorage } from './storage.js';
import { PackageHelper } from './package-helper.js';

export { ValkeyStorage, PackageHelper };
export * from './types.js';

// Export factory function for Node-RED
export default function createStorage() {
  return new ValkeyStorage();
}

// Also export as module.exports for CommonJS compatibility
export const storageModule = createStorage();
