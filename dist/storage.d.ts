import type { NodeREDSettings, FlowConfig, CredentialsConfig, UserSettings, SessionsConfig, LibraryEntry, StorageModule } from './types.js';
/**
 * Valkey/Redis storage module for Node-RED with pub/sub support
 */
export declare class ValkeyStorage implements StorageModule {
    private client;
    private subscriber?;
    private config;
    private fsHelper?;
    private packageHelper?;
    private packageSubscriber?;
    private lastKnownPackages?;
    localfilesystem?: any;
    private cachedFlows;
    private cachedCredentials;
    constructor();
    /**
     * Initialize storage connection
     */
    init(settings: NodeREDSettings, runtime?: any): Promise<void>;
    /**
     * Get flows from storage
     * Admin: reads from filesystem (restored during init)
     * Worker: reads from in-memory cache (loaded during init)
     */
    getFlows(): Promise<FlowConfig>;
    /**
     * Save flows to storage and optionally publish update
     * @param skipPublish - If true, skip publishing update event (used during init restore)
     */
    saveFlows(flows: FlowConfig, skipPublish?: boolean): Promise<void>;
    /**
     * Get credentials from storage
     * Admin: reads from filesystem (restored during init)
     * Worker: reads from in-memory cache (loaded during init)
     */
    getCredentials(): Promise<CredentialsConfig>;
    /**
     * Save credentials to storage
     * @param skipPublish - If true, skip any publish events (used during init restore)
     */
    saveCredentials(credentials: CredentialsConfig, skipPublish?: boolean): Promise<void>;
    /**
     * Get user settings from storage
     */
    getSettings(): Promise<UserSettings>;
    /**
     * Save user settings to storage
     */
    saveSettings(settings: UserSettings): Promise<void>;
    /**
     * Get sessions from storage
     */
    getSessions(): Promise<SessionsConfig>;
    /**
     * Save sessions to storage with TTL
     */
    saveSessions(sessions: SessionsConfig): Promise<void>;
    /**
     * Get library entry from storage
     */
    getLibraryEntry(type: string, path: string): Promise<LibraryEntry | LibraryEntry[]>;
    /**
     * Save library entry to storage
     */
    saveLibraryEntry(type: string, path: string, meta: Record<string, any>, body: string): Promise<void>;
    /**
     * Restore project configuration from Redis BEFORE localfilesystem init
     * Writes .config.projects.json so Node-RED can activate the project during init
     */
    private restoreProjectConfigFromRedis;
    /**
     * Restore flow and credential files from Redis AFTER localfilesystem init
     * Uses localfilesystem.saveFlows() to update both filesystem AND memory
     */
    private restoreFlowFilesFromRedis;
    /**
     * Load flows and credentials from Redis and save to filesystem (Workers without Projects)
     * Called during init() - loads from Redis and calls saveFlows()/saveCredentials()
     * This ensures Node-RED reads the correct files written by our save methods
     */
    private loadFlowsIntoCache;
    /**
     * Get full Redis key with prefix
     */
    private getKey;
    /**
     * Get library key with type and path
     */
    private getLibraryKey;
    /**
     * Sanitize and validate flows data
     * Filters out null/undefined flows and ensures valid structure
     * Handles both array format (no project) and object format (with project)
     */
    private sanitizeFlows;
    /**
     * Serialize data with optional compression
     */
    private serialize;
    /**
     * Deserialize data with optional decompression
     */
    private deserialize;
    /**
     * Ensure package.json exists in userDir
     * Node-RED requires this file for Palette Manager to work
     */
    private ensurePackageJson;
    /**
     * Ensure .config.json exists in userDir
     * Node-RED requires this file for settings management
     * Node-RED will automatically migrate this to separate .config.*.json files if needed
     */
    private ensureConfigFiles;
    /**
     * Close connections (for cleanup)
     */
    close(): Promise<void>;
    /**
     * Handle package synchronization from .config.json changes
     * Throws errors to ensure data integrity - Node-RED needs to know if save fails
     */
    private handlePackageSync;
    /**
     * Extract package names from Node-RED .config.json
     * Filters out core Node-RED modules
     * Returns empty set if data is invalid (defensive)
     */
    private extractPackages;
    /**
     * Check if package list has changed from last known state
     */
    private hasPackageChanges;
    /**
     * Expose Projects module if localfilesystem is initialized
     */
    get projects(): any;
}
//# sourceMappingURL=storage.d.ts.map