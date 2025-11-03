"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageModule = exports.ValkeyStorage = void 0;
exports.default = createStorage;
const storage_js_1 = require("./storage.cjs");
Object.defineProperty(exports, "ValkeyStorage", { enumerable: true, get: function () { return storage_js_1.ValkeyStorage; } });
__exportStar(require("./types.cjs"), exports);
// Export factory function for Node-RED
function createStorage() {
    return new storage_js_1.ValkeyStorage();
}
// Also export as module.exports for CommonJS compatibility
exports.storageModule = createStorage();
//# sourceMappingURL=index.js.map