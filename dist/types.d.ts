export interface ValkeyStorageConfig {
    /**
     * Redis/Valkey host
     * @default "localhost"
     */
    host?: string;
    /**
     * Redis/Valkey port
     * @default 6379
     */
    port?: number;
    /**
     * Redis/Valkey password (optional)
     */
    password?: string;
    /**
     * Redis/Valkey database number
     * @default 0
     */
    db?: number;
    /**
     * Redis/Valkey key prefix for all storage keys
     * @default "nodered:"
     */
    keyPrefix?: string;
    /**
     * Enable pub/sub for auto-reload on flow changes
     * Admin nodes publish, worker nodes subscribe
     * @default false
     */
    publishOnSave?: boolean;
    /**
     * Subscribe to flow update events and auto-restart
     * Only for worker nodes
     * @default false
     */
    subscribeToUpdates?: boolean;
    /**
     * Pub/sub channel name for flow updates
     * @default "nodered:flows:updated"
     */
    updateChannel?: string;
    /**
     * Enable compression for large flows/credentials
     * @default false
     */
    enableCompression?: boolean;
    /**
     * TTL for sessions in seconds
     * @default 86400 (24 hours)
     */
    sessionTTL?: number;
}
export interface NodeREDSettings {
    valkey?: ValkeyStorageConfig;
    [key: string]: any;
}
export interface FlowConfig {
    flows?: any[];
    rev?: string;
    [key: string]: any;
}
export interface CredentialsConfig {
    [nodeId: string]: any;
}
export interface UserSettings {
    [key: string]: any;
}
export interface SessionsConfig {
    [sessionId: string]: any;
}
export interface LibraryEntry {
    fn?: string;
    [key: string]: any;
}
/**
 * Node-RED Storage API interface
 * @see https://nodered.org/docs/api/storage/methods/
 */
export interface StorageModule {
    /**
     * Initialize the storage system
     */
    init(settings: NodeREDSettings): Promise<void>;
    /**
     * Get the runtime flow configuration
     */
    getFlows(): Promise<FlowConfig>;
    /**
     * Save the runtime flow configuration
     */
    saveFlows(flows: FlowConfig): Promise<void>;
    /**
     * Get the runtime flow credentials
     */
    getCredentials(): Promise<CredentialsConfig>;
    /**
     * Save the runtime flow credentials
     */
    saveCredentials(credentials: CredentialsConfig): Promise<void>;
    /**
     * Get the user settings
     */
    getSettings(): Promise<UserSettings>;
    /**
     * Save the user settings
     */
    saveSettings(settings: UserSettings): Promise<void>;
    /**
     * Get the sessions object
     */
    getSessions(): Promise<SessionsConfig>;
    /**
     * Save the sessions object
     */
    saveSessions(sessions: SessionsConfig): Promise<void>;
    /**
     * Get a library entry
     * @param type - Entry type ('flows', 'functions', etc.)
     * @param path - Entry pathname
     */
    getLibraryEntry(type: string, path: string): Promise<LibraryEntry | LibraryEntry[]>;
    /**
     * Save a library entry
     * @param type - Entry type
     * @param path - Entry pathname
     * @param meta - Entry metadata
     * @param body - Entry content
     */
    saveLibraryEntry(type: string, path: string, meta: Record<string, any>, body: string): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map