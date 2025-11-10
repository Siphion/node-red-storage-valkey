import type { RedisOptions } from 'ioredis';

/**
 * Valkey Storage Configuration
 * Extends ioredis RedisOptions to support all connection modes:
 * - Single instance: { host, port }
 * - Sentinel: { sentinels: [...], name: 'mymaster' }
 * - Cluster: { cluster: [...] }
 * - TLS: { tls: {...} }
 */
export interface ValkeyStorageConfig extends Partial<RedisOptions> {
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

  /**
   * Enable file system sync for Node-RED projects support
   * When enabled, flows are written to disk in addition to Redis
   * This allows Git integration and project features to work
   * @default false
   */
  supportFileSystemProjects?: boolean;

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

  /**
   * Publish package updates to workers (Admin nodes only)
   * Requires syncPackages to be enabled
   * @default false
   */
  packageSyncOnAdmin?: boolean;

  /**
   * Subscribe to package updates and auto-install (Worker nodes only)
   * Requires syncPackages to be enabled
   * @default false
   */
  packageSyncOnWorker?: boolean;

  /**
   * Enable LocalFileSystem and Projects support (Admin nodes only)
   * When true, initializes localfilesystem module for Projects/Git integration
   * Workers should set this to false to use Redis-only mode
   * @default true
   */
  enableProjects?: boolean;
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
