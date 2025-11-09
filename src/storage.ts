import { Redis, type RedisOptions } from 'ioredis';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import { FileSystemHelper } from './filesystem-helper.js';
import { PackageHelper } from './package-helper.js';
import type {
  ValkeyStorageConfig,
  NodeREDSettings,
  FlowConfig,
  CredentialsConfig,
  UserSettings,
  SessionsConfig,
  LibraryEntry,
  StorageModule,
} from './types.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Valkey/Redis storage module for Node-RED with pub/sub support
 */
export class ValkeyStorage implements StorageModule {
  private client!: Redis;
  private subscriber?: Redis;
  private config!: Required<ValkeyStorageConfig>;
  private fsHelper?: FileSystemHelper;
  private packageHelper?: PackageHelper;
  private packageSubscriber?: Redis;
  private lastKnownPackages?: Set<string>;

  constructor() {
    // Properties initialized in init()
  }

  /**
   * Initialize storage connection
   */
  async init(settings: NodeREDSettings): Promise<void> {
    const userConfig = settings.valkey || {};

    // Separate storage-specific options from ioredis connection options
    const {
      keyPrefix = 'nodered:',
      publishOnSave = false,
      subscribeToUpdates = false,
      updateChannel = 'nodered:flows:updated',
      enableCompression = false,
      sessionTTL = 86400, // 24 hours
      supportFileSystemProjects = false,
      syncPackages = false,
      packageChannel = 'nodered:packages:updated',
      packageSyncOnAdmin = false,
      packageSyncOnWorker = false,
      ...ioredisConfig
    } = userConfig;

    // Type-safe ioredis config
    const ioredisOptions = ioredisConfig as RedisOptions;

    // Store storage-specific config
    this.config = {
      keyPrefix,
      publishOnSave,
      subscribeToUpdates,
      updateChannel,
      enableCompression,
      sessionTTL,
      supportFileSystemProjects,
      syncPackages,
      packageChannel,
      packageSyncOnAdmin,
      packageSyncOnWorker,
      // Preserve ioredis config for logging and duplicate()
      ...ioredisOptions,
    } as Required<ValkeyStorageConfig>;

    // Pass ioredis options directly - let ioredis handle its own defaults
    const connectionConfig: RedisOptions = ioredisOptions;
    const hasAdvancedConfig = ioredisOptions.sentinels;

    // Create Redis client with all ioredis options
    this.client = new Redis({
      ...connectionConfig,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err: Error) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    await this.client.ping();

    // Log connection info
    const connInfo = hasAdvancedConfig
      ? 'Redis (Sentinel mode)'
      : connectionConfig.host
        ? `${connectionConfig.host}:${connectionConfig.port || 6379}`
        : 'Redis (default connection)';
    console.log(`[ValkeyStorage] Connected to ${connInfo}`);

    // Setup subscriber for worker nodes
    if (this.config.subscribeToUpdates) {
      this.subscriber = this.client.duplicate();
      await this.subscriber.subscribe(this.config.updateChannel);

      this.subscriber.on('message', (channel: string, message: string) => {
        if (channel === this.config.updateChannel) {
          console.log(`[ValkeyStorage] Flows updated at ${message}, restarting...`);
          // Exit process, Docker/Swarm will restart automatically
          process.exit(0);
        }
      });

      console.log(`[ValkeyStorage] Subscribed to ${this.config.updateChannel}`);
    }

    // Initialize file system helper for projects support
    if (this.config.supportFileSystemProjects) {
      if (!settings.userDir) {
        throw new Error('[ValkeyStorage] supportFileSystemProjects requires settings.userDir to be set');
      }
      this.fsHelper = new FileSystemHelper(settings.userDir);
      console.log(`[ValkeyStorage] File system projects support enabled, using ${settings.userDir}`);
    }

    // Initialize package synchronization
    if (this.config.syncPackages) {
      if (!settings.userDir) {
        throw new Error('[ValkeyStorage] syncPackages requires settings.userDir to be set');
      }

      // Initialize PackageHelper
      this.packageHelper = new PackageHelper(settings.userDir);
      console.log(`[ValkeyStorage] Package synchronization enabled, using ${settings.userDir}`);

      // Setup package subscriber for worker nodes
      if (this.config.packageSyncOnWorker) {
        this.packageSubscriber = this.client.duplicate();
        await this.packageSubscriber.subscribe(this.config.packageChannel);

        this.packageSubscriber.on('message', async (channel: string, message: string) => {
          if (channel === this.config.packageChannel) {
            try {
              console.log(`[ValkeyStorage] Package update notification received`);

              // Parse package list from message
              const packageList: string[] = JSON.parse(message);

              if (packageList.length > 0) {
                // Install packages (will throw on error, causing process to exit)
                await this.packageHelper!.installPackages(packageList);

                console.log('[ValkeyStorage] Packages installed successfully, restarting...');
                // Exit process, Docker/Swarm will restart automatically
                process.exit(0);
              } else {
                console.log('[ValkeyStorage] No packages to install, skipping restart');
              }
            } catch (error) {
              console.error('[ValkeyStorage] Error processing package update:', error);
              // Fail fast - exit with error code
              process.exit(1);
            }
          }
        });

        console.log(`[ValkeyStorage] Subscribed to package updates on ${this.config.packageChannel}`);
      }

      // Load initial package state from Redis for admin nodes
      if (this.config.packageSyncOnAdmin) {
        const configKey = this.getKey('config');
        const configData = await this.client.get(configKey);

        if (configData) {
          try {
            const configJson = await this.deserialize<any>(configData);
            this.lastKnownPackages = this.extractPackages(configJson);
            console.log(`[ValkeyStorage] Loaded ${this.lastKnownPackages.size} existing packages from Redis`);
          } catch (error) {
            console.error('[ValkeyStorage] Error loading initial package state:', error);
            // Non-fatal - just start with empty state
            this.lastKnownPackages = new Set();
          }
        } else {
          this.lastKnownPackages = new Set();
        }
      }
    }
  }

  /**
   * Get flows from storage
   */
  async getFlows(): Promise<FlowConfig> {
    const key = this.getKey('flows');
    const data = await this.client.get(key);

    // If Redis has data, use it
    if (data) {
      return await this.deserialize<FlowConfig>(data);
    }

    // Redis is empty - check file system if enabled
    if (this.fsHelper) {
      const flowsFromFile = await this.fsHelper.getFlowsFromFile();
      if (flowsFromFile) {
        console.log('[ValkeyStorage] Loaded flows from file system (Redis was empty)');

        // Sync to Redis for next time
        const dataToStore = await this.serialize(flowsFromFile);
        await this.client.set(key, dataToStore);
        console.log('[ValkeyStorage] Synced flows from file system to Redis');

        return flowsFromFile;
      }
    }

    // Both Redis and file system are empty - return empty flows
    // This allows the first deploy to work on virgin installations
    return { flows: [] };
  }

  /**
   * Save flows to storage and optionally publish update
   */
  async saveFlows(flows: FlowConfig): Promise<void> {
    const key = this.getKey('flows');

    // Save to file system if enabled (must be done first to generate rev)
    let rev: string | undefined;
    if (this.fsHelper) {
      rev = await this.fsHelper.saveFlowsToFile(flows);
    }

    // Prepare flow data for Redis with rev if available
    const flowData = rev ? { ...flows, rev } : flows;
    const data = await this.serialize(flowData);

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
  async getCredentials(): Promise<CredentialsConfig> {
    const key = this.getKey('credentials');
    const data = await this.client.get(key);

    if (!data) {
      return {};
    }

    return await this.deserialize<CredentialsConfig>(data);
  }

  /**
   * Save credentials to storage
   */
  async saveCredentials(credentials: CredentialsConfig): Promise<void> {
    const key = this.getKey('credentials');
    const data = await this.serialize(credentials);

    await this.client.set(key, data);
  }

  /**
   * Get user settings from storage
   */
  async getSettings(): Promise<UserSettings> {
    const key = this.getKey('settings');
    const data = await this.client.get(key);

    if (!data) {
      return {};
    }

    return await this.deserialize<UserSettings>(data);
  }

  /**
   * Save user settings to storage
   */
  async saveSettings(settings: UserSettings): Promise<void> {
    // Validate input
    if (!settings || typeof settings !== 'object') {
      throw new Error('[ValkeyStorage] saveSettings: settings must be an object');
    }

    const key = this.getKey('settings');
    const data = await this.serialize(settings);

    await this.client.set(key, data);

    // Package sync: intercept .config.json changes
    if (this.config.syncPackages && this.config.packageSyncOnAdmin) {
      await this.handlePackageSync(settings);
    }
  }

  /**
   * Get sessions from storage
   */
  async getSessions(): Promise<SessionsConfig> {
    const key = this.getKey('sessions');
    const data = await this.client.get(key);

    if (!data) {
      return {};
    }

    return await this.deserialize<SessionsConfig>(data);
  }

  /**
   * Save sessions to storage with TTL
   */
  async saveSessions(sessions: SessionsConfig): Promise<void> {
    const key = this.getKey('sessions');
    const data = await this.serialize(sessions);

    await this.client.set(key, data, 'EX', this.config.sessionTTL);
  }

  /**
   * Get library entry from storage
   */
  async getLibraryEntry(type: string, path: string): Promise<LibraryEntry | LibraryEntry[]> {
    const key = this.getLibraryKey(type, path);

    // Check if it's a directory listing
    if (path.endsWith('/') || !path) {
      const pattern = `${key}*`;
      const keys = await this.client.keys(pattern);

      const entries: LibraryEntry[] = [];
      for (const k of keys) {
        const data = await this.client.get(k);
        if (data) {
          const entry = await this.deserialize<LibraryEntry>(data);
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

    return await this.deserialize<LibraryEntry>(data);
  }

  /**
   * Save library entry to storage
   */
  async saveLibraryEntry(
    type: string,
    path: string,
    meta: Record<string, any>,
    body: string
  ): Promise<void> {
    const key = this.getLibraryKey(type, path);
    const entry: LibraryEntry = { ...meta, fn: body };
    const data = await this.serialize(entry);

    await this.client.set(key, data);
  }

  /**
   * Get full Redis key with prefix
   */
  private getKey(name: string): string {
    return `${this.config.keyPrefix}${name}`;
  }

  /**
   * Get library key with type and path
   */
  private getLibraryKey(type: string, path: string): string {
    return `${this.config.keyPrefix}library:${type}:${path}`;
  }

  /**
   * Serialize data with optional compression
   */
  private async serialize(data: any): Promise<string> {
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
  private async deserialize<T>(data: string): Promise<T> {
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
  async close(): Promise<void> {
    if (this.packageSubscriber) {
      await this.packageSubscriber.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    await this.client.quit();
  }

  /**
   * Handle package synchronization from .config.json changes
   * Throws errors to ensure data integrity - Node-RED needs to know if save fails
   */
  private async handlePackageSync(settings: UserSettings): Promise<void> {
    // Extract Node-RED .config.json from settings
    const configJson = settings['.config.json'];
    if (!configJson) {
      return; // No .config.json in settings, nothing to sync
    }

    // Save .config.json to Redis
    const configKey = this.getKey('config');
    const configData = await this.serialize(configJson);
    await this.client.set(configKey, configData);

    // Extract installed packages (nodes property contains installed modules)
    const installedPackages = this.extractPackages(configJson);

    // Detect changes
    if (this.hasPackageChanges(installedPackages)) {
      console.log('[ValkeyStorage] Package changes detected, publishing update...');

      // Publish package list as JSON array
      const packageList = Array.from(installedPackages);
      await this.client.publish(this.config.packageChannel, JSON.stringify(packageList));

      console.log(`[ValkeyStorage] Published ${packageList.length} package(s) to ${this.config.packageChannel}`);

      // Update known packages
      this.lastKnownPackages = installedPackages;
    }
  }

  /**
   * Extract package names from Node-RED .config.json
   * Filters out core Node-RED modules
   * Returns empty set if data is invalid (defensive)
   */
  private extractPackages(configJson: any): Set<string> {
    const packages = new Set<string>();

    // Defensive checks - return empty set if invalid data
    if (!configJson || typeof configJson !== 'object') {
      console.warn('[ValkeyStorage] extractPackages: configJson is not a valid object');
      return packages;
    }

    if (!configJson.nodes || typeof configJson.nodes !== 'object') {
      console.warn('[ValkeyStorage] extractPackages: configJson.nodes is missing or invalid');
      return packages;
    }

    try {
      for (const packageName of Object.keys(configJson.nodes)) {
        // Filter out core nodes (start with 'node-red/')
        // Keep all user-installed packages
        if (typeof packageName === 'string' && !packageName.startsWith('node-red/')) {
          packages.add(packageName);
        }
      }
    } catch (error) {
      console.error('[ValkeyStorage] extractPackages: Error iterating packages:', error);
      // Return whatever packages we collected so far
    }

    return packages;
  }

  /**
   * Check if package list has changed from last known state
   */
  private hasPackageChanges(newPackages: Set<string>): boolean {
    // First run - always consider as changed
    if (!this.lastKnownPackages) {
      return true;
    }

    // Different size means changes occurred
    if (newPackages.size !== this.lastKnownPackages.size) {
      return true;
    }

    // Check if all packages match
    for (const pkg of newPackages) {
      if (!this.lastKnownPackages.has(pkg)) {
        return true;
      }
    }

    return false;
  }
}
