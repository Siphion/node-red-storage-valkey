"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValkeyStorage = void 0;
const ioredis_1 = require("ioredis");
const util_1 = require("util");
const zlib_1 = require("zlib");
const gzipAsync = (0, util_1.promisify)(zlib_1.gzip);
const gunzipAsync = (0, util_1.promisify)(zlib_1.gunzip);
/**
 * Valkey/Redis storage module for Node-RED with pub/sub support
 */
class ValkeyStorage {
    client;
    subscriber;
    config;
    constructor() {
        // Properties initialized in init()
    }
    /**
     * Initialize storage connection
     */
    async init(settings) {
        const userConfig = settings.valkey || {};
        // Default configuration
        this.config = {
            host: 'localhost',
            port: 6379,
            password: undefined,
            db: 0,
            keyPrefix: 'nodered:',
            publishOnSave: false,
            subscribeToUpdates: false,
            updateChannel: 'nodered:flows:updated',
            enableCompression: false,
            sessionTTL: 86400, // 24 hours
            ...userConfig,
        };
        // Create Redis client
        this.client = new ioredis_1.Redis({
            host: this.config.host,
            port: this.config.port,
            password: this.config.password,
            db: this.config.db || 0,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                    return true;
                }
                return false;
            },
        });
        await this.client.ping();
        console.log(`[ValkeyStorage] Connected to ${this.config.host}:${this.config.port}`);
        // Setup subscriber for worker nodes
        if (this.config.subscribeToUpdates) {
            this.subscriber = this.client.duplicate();
            await this.subscriber.subscribe(this.config.updateChannel);
            this.subscriber.on('message', (channel, message) => {
                if (channel === this.config.updateChannel) {
                    console.log(`[ValkeyStorage] Flows updated at ${message}, restarting...`);
                    // Exit process, Docker/Swarm will restart automatically
                    process.exit(0);
                }
            });
            console.log(`[ValkeyStorage] Subscribed to ${this.config.updateChannel}`);
        }
    }
    /**
     * Get flows from storage
     */
    async getFlows() {
        const key = this.getKey('flows');
        const data = await this.client.get(key);
        if (!data) {
            return { flows: [] };
        }
        return await this.deserialize(data);
    }
    /**
     * Save flows to storage and optionally publish update
     */
    async saveFlows(flows) {
        const key = this.getKey('flows');
        const data = await this.serialize(flows);
        await this.client.set(key, data);
        // Publish update for worker nodes
        if (this.config.publishOnSave) {
            await this.client.publish(this.config.updateChannel, Date.now().toString());
            console.log(`[ValkeyStorage] Published flow update to ${this.config.updateChannel}`);
        }
    }
    /**
     * Get credentials from storage
     */
    async getCredentials() {
        const key = this.getKey('credentials');
        const data = await this.client.get(key);
        if (!data) {
            return {};
        }
        return await this.deserialize(data);
    }
    /**
     * Save credentials to storage
     */
    async saveCredentials(credentials) {
        const key = this.getKey('credentials');
        const data = await this.serialize(credentials);
        await this.client.set(key, data);
    }
    /**
     * Get user settings from storage
     */
    async getSettings() {
        const key = this.getKey('settings');
        const data = await this.client.get(key);
        if (!data) {
            return {};
        }
        return await this.deserialize(data);
    }
    /**
     * Save user settings to storage
     */
    async saveSettings(settings) {
        const key = this.getKey('settings');
        const data = await this.serialize(settings);
        await this.client.set(key, data);
    }
    /**
     * Get sessions from storage
     */
    async getSessions() {
        const key = this.getKey('sessions');
        const data = await this.client.get(key);
        if (!data) {
            return {};
        }
        return await this.deserialize(data);
    }
    /**
     * Save sessions to storage with TTL
     */
    async saveSessions(sessions) {
        const key = this.getKey('sessions');
        const data = await this.serialize(sessions);
        await this.client.set(key, data, 'EX', this.config.sessionTTL);
    }
    /**
     * Get library entry from storage
     */
    async getLibraryEntry(type, path) {
        const key = this.getLibraryKey(type, path);
        // Check if it's a directory listing
        if (path.endsWith('/') || !path) {
            const pattern = `${key}*`;
            const keys = await this.client.keys(pattern);
            const entries = [];
            for (const k of keys) {
                const data = await this.client.get(k);
                if (data) {
                    const entry = await this.deserialize(data);
                    entries.push(entry);
                }
            }
            return entries;
        }
        // Get single entry
        const data = await this.client.get(key);
        if (!data) {
            throw new Error('Library entry not found');
        }
        return await this.deserialize(data);
    }
    /**
     * Save library entry to storage
     */
    async saveLibraryEntry(type, path, meta, body) {
        const key = this.getLibraryKey(type, path);
        const entry = { ...meta, fn: body };
        const data = await this.serialize(entry);
        await this.client.set(key, data);
    }
    /**
     * Get full Redis key with prefix
     */
    getKey(name) {
        return `${this.config.keyPrefix}${name}`;
    }
    /**
     * Get library key with type and path
     */
    getLibraryKey(type, path) {
        return `${this.config.keyPrefix}library:${type}:${path}`;
    }
    /**
     * Serialize data with optional compression
     */
    async serialize(data) {
        const json = JSON.stringify(data);
        if (this.config.enableCompression && json.length > 1024) {
            const compressed = await gzipAsync(Buffer.from(json));
            return `gzip:${compressed.toString('base64')}`;
        }
        return json;
    }
    /**
     * Deserialize data with optional decompression
     */
    async deserialize(data) {
        if (data.startsWith('gzip:')) {
            const compressed = Buffer.from(data.substring(5), 'base64');
            const decompressed = await gunzipAsync(compressed);
            return JSON.parse(decompressed.toString());
        }
        return JSON.parse(data);
    }
    /**
     * Close connections (for cleanup)
     */
    async close() {
        if (this.subscriber) {
            await this.subscriber.quit();
        }
        await this.client.quit();
    }
}
exports.ValkeyStorage = ValkeyStorage;
//# sourceMappingURL=storage.js.map