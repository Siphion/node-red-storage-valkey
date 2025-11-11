import type { RedisOptions } from 'ioredis';

/**
 * Valkey Storage Configuration
 * Includes all RedisOptions to support all connection modes:
 * - Single instance: { host, port }
 * - Sentinel: { sentinels: [...], name: 'mymaster' }
 * - Cluster: { cluster: [...] }
 * - TLS: { tls: {...} }
 */
export interface ValkeyStorageConfig {
  /**
   * Node role: 'admin' or 'worker'
   * - admin: Uses projects, publishes flow updates, can install packages
   * - worker: No projects (flows.json only), subscribes to flow updates, auto-restarts
   * @required
   */
  role: 'admin' | 'worker';

  /**
   * Redis/Valkey key prefix for all storage keys
   * @default "nodered:"
   */
  keyPrefix?: string;

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

  /**
   * Enable package synchronization from Admin to Worker nodes
   * When enabled, .config.json changes are stored in Redis
   * @default false
   */
  syncPackages?: boolean;

  /**
   * Pub/sub channel name for package updates
   * @default "nodered:packages:updated"
   */
  packageChannel?: string;
}

export interface NodeREDSettings {
  valkey?: ValkeyStorageConfig;
  userDir?: string;
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
 * Project metadata stored in Redis
 */
export interface ProjectMetadata {
  /**
   * Name of the active project
   */
  name: string;
  /**
   * Timestamp of last update
   */
  updated?: number;
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
  saveLibraryEntry(
    type: string,
    path: string,
    meta: Record<string, any>,
    body: string
  ): Promise<void>;
}
