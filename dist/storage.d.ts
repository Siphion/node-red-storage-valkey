import type { NodeREDSettings, FlowConfig, CredentialsConfig, UserSettings, SessionsConfig, LibraryEntry, StorageModule } from './types.js';
/**
 * Valkey/Redis storage module for Node-RED with pub/sub support
 */
export declare class ValkeyStorage implements StorageModule {
    private client;
    private subscriber?;
    private config;
    constructor();
    /**
     * Initialize storage connection
     */
    init(settings: NodeREDSettings): Promise<void>;
    /**
     * Get flows from storage
     */
    getFlows(): Promise<FlowConfig>;
    /**
     * Save flows to storage and optionally publish update
     */
    saveFlows(flows: FlowConfig): Promise<void>;
    /**
     * Get credentials from storage
     */
    getCredentials(): Promise<CredentialsConfig>;
    /**
     * Save credentials to storage
     */
    saveCredentials(credentials: CredentialsConfig): Promise<void>;
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
     * Get full Redis key with prefix
     */
    private getKey;
    /**
     * Get library key with type and path
     */
    private getLibraryKey;
    /**
     * Serialize data with optional compression
     */
    private serialize;
    /**
     * Deserialize data with optional decompression
     */
    private deserialize;
    /**
     * Close connections (for cleanup)
     */
    close(): Promise<void>;
}
//# sourceMappingURL=storage.d.ts.map