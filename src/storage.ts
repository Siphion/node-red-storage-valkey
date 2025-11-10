import { Redis, type RedisOptions } from 'ioredis';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import * as fs from 'fs/promises';
import * as path from 'path';
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
  ProjectMetadata,
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
  public localfilesystem?: any; // Public for git user sync in index.ts
  // In-memory cache for worker nodes (no file write permissions)
  private cachedFlows: FlowConfig | null = null;
  private cachedCredentials: CredentialsConfig | null = null;

  constructor() {
    // Properties initialized in init()
  }

  /**
   * Initialize storage connection
   */
  async init(settings: NodeREDSettings, runtime?: any): Promise<void> {
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
      enableProjects = true, // Default true for backward compatibility
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
      enableProjects,
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

    // Initialize localfilesystem for Projects support (Admin nodes only)
    if (this.config.enableProjects && settings.userDir && runtime) {
      try {
        // STEP 1: Restore project config from Redis BEFORE initializing localfilesystem
        // This ensures Node-RED can activate the correct project during init
        await this.restoreProjectConfigFromRedis(settings);

        // STEP 2: Load and initialize localfilesystem
        // Dynamically resolve the localfilesystem module path
        // require.resolve('@node-red/runtime') returns something like:
        // /usr/src/node-red/node_modules/@node-red/runtime/lib/index.js
        // We need to get to: /usr/src/node-red/node_modules/@node-red/runtime/lib/storage/localfilesystem
        const runtimePath = require.resolve('@node-red/runtime');
        const runtimeLibDir = path.dirname(runtimePath); // Gets the /lib directory
        const localfsPath = path.join(runtimeLibDir, 'storage/localfilesystem');

        console.log('[ValkeyStorage] Attempting to load localfilesystem from:', localfsPath);
        this.localfilesystem = require(localfsPath);

        // Check if projects module exists
        if (this.localfilesystem.projects) {
          console.log('[ValkeyStorage] LocalFileSystem has projects module');
        } else {
          console.log('[ValkeyStorage] WARNING: LocalFileSystem does not have projects module');
        }

        // Initialize localfilesystem (this will now read our pre-written .config.projects.json)
        await this.localfilesystem.init(settings, runtime);

        console.log('[ValkeyStorage] LocalFileSystem initialized successfully for Projects support');

        // STEP 3: Restore flow files from Redis AFTER localfilesystem init
        // Now that the project is activated, write flows.json and flows_cred.json
        await this.restoreFlowFilesFromRedis(settings);
      } catch (error) {
        console.error('[ValkeyStorage] Failed to initialize localfilesystem:', error);
        // Non-fatal - continue without Projects support
        this.localfilesystem = undefined;
      }
    } else {
      if (!this.config.enableProjects) {
        console.log('[ValkeyStorage] Projects disabled (enableProjects: false), using Redis-only mode');

        // Workers: initialize fsHelper for file writes
        if (settings.userDir) {
          this.fsHelper = new FileSystemHelper(settings.userDir);
          console.log('[ValkeyStorage] Worker: FileSystemHelper initialized for flow file writes');
        }

        // Workers: load flows from Redis and write to filesystem
        await this.loadFlowsIntoCache();
      } else if (!settings.userDir) {
        console.log('[ValkeyStorage] Projects not available: settings.userDir is not set');
      } else if (!runtime) {
        console.log('[ValkeyStorage] Projects not available: runtime parameter is missing');
      }
    }

    // Ensure required configuration files exist (if localfilesystem didn't create them)
    if (settings.userDir && !this.localfilesystem) {
      await this.ensurePackageJson(settings.userDir);
      await this.ensureConfigFiles(settings.userDir);
    }

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
   * Admin: reads from filesystem (restored during init)
   * Worker: reads from in-memory cache (loaded during init)
   */
  async getFlows(): Promise<FlowConfig> {
    // Admin with Projects: use localfilesystem (files restored from Redis during init)
    if (this.localfilesystem) {
      try {
        const flowsFromProject = await this.localfilesystem.getFlows();

        // Handle null/undefined return from localfilesystem
        if (!flowsFromProject) {
          console.warn('[ValkeyStorage] localfilesystem.getFlows() returned null/undefined');
          return { flows: [], rev: '0' };
        }

        console.log('[ValkeyStorage] Admin loaded flows from filesystem');
        // Return EXACTLY what localfilesystem returned (don't modify format)
        return flowsFromProject;
      } catch (error) {
        console.error('[ValkeyStorage] Error loading flows from Projects:', error);
        throw error;
      }
    }

    // Workers: return from in-memory cache (loaded during init)
    if (this.cachedFlows !== null) {
      console.log('[ValkeyStorage] Worker returning flows from memory cache');
      return this.cachedFlows;
    }

    // Workers with fsHelper (legacy support)
    if (this.fsHelper) {
      const flowsFromFile = await this.fsHelper.getFlowsFromFile();
      if (flowsFromFile) {
        console.log('[ValkeyStorage] Worker loaded flows from filesystem (legacy)');
        return flowsFromFile;
      }
    }

    // All sources empty - return empty flows with initial rev
    console.log('[ValkeyStorage] No flows found, returning empty');
    return { flows: [], rev: '0' };
  }

  /**
   * Save flows to storage and optionally publish update
   * @param skipPublish - If true, skip publishing update event (used during init restore)
   */
  async saveFlows(flows: FlowConfig, skipPublish = false): Promise<void> {
    // Debug logging
    console.log('[ValkeyStorage] saveFlows() called with:', {
      type: typeof flows,
      isNull: flows === null,
      isUndefined: flows === undefined,
      isArray: Array.isArray(flows),
      keys: flows ? Object.keys(flows) : 'N/A',
      hasFlows: flows?.flows ? true : false,
      hasRev: flows?.rev ? true : false,
    });

    // Validate and sanitize flows before saving
    const sanitized = this.sanitizeFlows(flows);

    // Save to Projects (if available) for Git versioning
    if (this.localfilesystem) {
      await this.localfilesystem.saveFlows(sanitized);
      console.log('[ValkeyStorage] Flows saved to Projects');

      // ALSO save to Redis for worker distribution
      const key = this.getKey('flows');
      const data = await this.serialize(sanitized);
      await this.client.set(key, data);
      console.log('[ValkeyStorage] Flows synced to Redis for workers');

      // Save active project name to Redis
      try {
        const activeProject = this.localfilesystem.projects?.getActiveProject();
        if (activeProject && activeProject.name) {
          const projectMeta: ProjectMetadata = {
            name: activeProject.name,
            updated: Date.now(),
          };
          const projectKey = this.getKey('activeProject');
          await this.client.set(projectKey, JSON.stringify(projectMeta));
          console.log(`[ValkeyStorage] Saved active project "${activeProject.name}" to Redis`);
        }
      } catch (error) {
        console.warn('[ValkeyStorage] Could not save active project name:', error);
        // Non-fatal - continue
      }

      // Publish update for worker nodes
      if (this.config.publishOnSave && !skipPublish) {
        await this.client.publish(this.config.updateChannel, Date.now().toString());
        console.log(`[ValkeyStorage] Published flow update to ${this.config.updateChannel}`);
      }

      return;
    }

    // Fallback to Redis storage
    const key = this.getKey('flows');

    // Save to file system if enabled (must be done first to generate rev)
    let rev: string | undefined;
    if (this.fsHelper) {
      rev = await this.fsHelper.saveFlowsToFile(sanitized);
    }

    // Prepare flow data for Redis with rev if available
    const flowData = rev ? { ...sanitized, rev } : sanitized;
    const data = await this.serialize(flowData);

    await this.client.set(key, data);

    // Publish update for worker nodes
    if (this.config.publishOnSave && !skipPublish) {
      await this.client.publish(this.config.updateChannel, Date.now().toString());
      console.log(`[ValkeyStorage] Published flow update to ${this.config.updateChannel}`);
    }
  }

  /**
   * Get credentials from storage
   * Admin: reads from filesystem (restored during init)
   * Worker: reads from in-memory cache (loaded during init)
   */
  async getCredentials(): Promise<CredentialsConfig> {
    // Admin with Projects: use localfilesystem (files restored from Redis during init)
    if (this.localfilesystem) {
      try {
        const credentialsFromProject = await this.localfilesystem.getCredentials();
        console.log('[ValkeyStorage] Admin loaded credentials from filesystem');
        return credentialsFromProject || {};
      } catch (error) {
        console.error('[ValkeyStorage] Error loading credentials from Projects:', error);
        return {};
      }
    }

    // Workers: return from in-memory cache (loaded during init)
    if (this.cachedCredentials !== null) {
      console.log('[ValkeyStorage] Worker returning credentials from memory cache');
      return this.cachedCredentials;
    }

    // No cache available - return empty
    console.log('[ValkeyStorage] Worker: no credentials cache available, returning empty');
    return {};
  }

  /**
   * Save credentials to storage
   * @param skipPublish - If true, skip any publish events (used during init restore)
   */
  async saveCredentials(credentials: CredentialsConfig, skipPublish = false): Promise<void> {
    // Save to Projects (if available) for Git versioning
    if (this.localfilesystem) {
      await this.localfilesystem.saveCredentials(credentials);
      console.log('[ValkeyStorage] Credentials saved to Projects');

      // ALSO save to Redis for worker distribution and container restart recovery
      const key = this.getKey('credentials');
      const data = await this.serialize(credentials);
      await this.client.set(key, data);
      console.log('[ValkeyStorage] Credentials synced to Redis for workers');

      return;
    }

    // Fallback to Redis storage
    const key = this.getKey('credentials');
    const data = await this.serialize(credentials);

    await this.client.set(key, data);
  }

  /**
   * Get user settings from storage
   */
  async getSettings(): Promise<UserSettings> {
    // Delegate to localfilesystem if available (required for Projects)
    if (this.localfilesystem) {
      return await this.localfilesystem.getSettings();
    }

    // Fallback to Redis storage
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
    console.log('[ValkeyStorage] saveSettings called with keys:', Object.keys(settings));

    // Validate input
    if (!settings || typeof settings !== 'object') {
      throw new Error('[ValkeyStorage] saveSettings: settings must be an object');
    }

    // Delegate to localfilesystem if available (required for Projects)
    if (this.localfilesystem) {
      await this.localfilesystem.saveSettings(settings);
      console.log('[ValkeyStorage] Settings saved to filesystem via localfilesystem');

      // Package sync: run in background (non-blocking) to prevent "Settings unavailable" errors
      if (this.config.syncPackages && this.config.packageSyncOnAdmin) {
        console.log('[ValkeyStorage] Starting package sync (non-blocking)...');
        // Fire and forget - don't block settings save
        this.handlePackageSync(settings).catch(error => {
          console.error('[ValkeyStorage] Package sync failed (non-blocking):', error);
        });
      }

      return;
    }

    // Fallback to Redis storage
    const key = this.getKey('settings');
    const data = await this.serialize(settings);

    console.log('[ValkeyStorage] Saving settings to Redis key:', key);
    await this.client.set(key, data);
    console.log('[ValkeyStorage] Settings saved successfully');

    // Package sync: run in background (non-blocking) to prevent "Settings unavailable" errors
    if (this.config.syncPackages && this.config.packageSyncOnAdmin) {
      console.log('[ValkeyStorage] Starting package sync (non-blocking)...');
      // Fire and forget - don't block settings save
      this.handlePackageSync(settings).catch(error => {
        console.error('[ValkeyStorage] Package sync failed (non-blocking):', error);
      });
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
   * Restore project configuration from Redis BEFORE localfilesystem init
   * Writes .config.projects.json so Node-RED can activate the project during init
   */
  private async restoreProjectConfigFromRedis(settings: NodeREDSettings): Promise<void> {
    if (!settings.userDir) {
      console.warn('[ValkeyStorage] Cannot restore project config: userDir not set');
      return;
    }

    try {
      // Get active project from Redis
      const projectKey = this.getKey('activeProject');
      const projectData = await this.client.get(projectKey);

      if (!projectData) {
        console.log('[ValkeyStorage] No active project in Redis, skipping project config restore');
        return;
      }

      const projectMeta: ProjectMetadata = JSON.parse(projectData);
      console.log(`[ValkeyStorage] Restoring project config for "${projectMeta.name}" from Redis`);

      // Ensure projects directory exists
      const projectsDir = path.join(settings.userDir, 'projects');
      await fs.mkdir(projectsDir, { recursive: true });

      // Write .config.projects.json to set active project
      // Node-RED's storageSettings expects: .config.projects.json with nested structure
      const projectsConfigPath = path.join(settings.userDir, '.config.projects.json');
      const projectsConfig = {
        projects: {
          activeProject: projectMeta.name,
          projects: {
            [projectMeta.name]: {
              // Minimal config - Projects module will fill in the rest
            },
          },
        },
      };
      await fs.writeFile(projectsConfigPath, JSON.stringify(projectsConfig, null, 2), 'utf8');
      console.log(`[ValkeyStorage] Set active project to "${projectMeta.name}" in .config.projects.json`);
    } catch (error) {
      console.error('[ValkeyStorage] Error restoring project config from Redis:', error);
      // Non-fatal - continue without restore
    }
  }

  /**
   * Restore flow and credential files from Redis AFTER localfilesystem init
   * Writes flows.json and flows_cred.json to the active project directory
   */
  private async restoreFlowFilesFromRedis(settings: NodeREDSettings): Promise<void> {
    if (!settings.userDir) {
      console.warn('[ValkeyStorage] Cannot restore flow files: userDir not set');
      return;
    }

    try {
      // Get active project from Redis
      const projectKey = this.getKey('activeProject');
      const projectData = await this.client.get(projectKey);

      if (!projectData) {
        console.log('[ValkeyStorage] No active project in Redis, skipping flow files restore');
        return;
      }

      const projectMeta: ProjectMetadata = JSON.parse(projectData);
      console.log(`[ValkeyStorage] Restoring flow files for project "${projectMeta.name}" from Redis`);

      // Get flows and credentials from Redis
      const flowsKey = this.getKey('flows');
      const credsKey = this.getKey('credentials');

      const [flowsData, credsData] = await Promise.all([
        this.client.get(flowsKey),
        this.client.get(credsKey),
      ]);

      if (!flowsData) {
        console.warn('[ValkeyStorage] No flows in Redis to restore');
        return;
      }

      const flows = await this.deserialize<FlowConfig>(flowsData);
      const creds = credsData ? await this.deserialize<CredentialsConfig>(credsData) : {};

      // Create project directory structure
      const projectDir = path.join(settings.userDir, 'projects', projectMeta.name);
      await fs.mkdir(projectDir, { recursive: true });

      // Write flows.json
      const flowsPath = path.join(projectDir, 'flows.json');
      const flowsToWrite = flows.flows || flows; // Handle both formats
      await fs.writeFile(flowsPath, JSON.stringify(flowsToWrite, null, 2), 'utf8');
      console.log(`[ValkeyStorage] Wrote flows to ${flowsPath}`);

      // Write flows_cred.json
      const credsPath = path.join(projectDir, 'flows_cred.json');
      await fs.writeFile(credsPath, JSON.stringify(creds, null, 2), 'utf8');
      console.log(`[ValkeyStorage] Wrote credentials to ${credsPath}`);
    } catch (error) {
      console.error('[ValkeyStorage] Error restoring flow files from Redis:', error);
      // Non-fatal - continue without restore
    }
  }

  /**
   * Load flows and credentials from Redis and save to filesystem (Workers without Projects)
   * Called during init() - loads from Redis and calls saveFlows()/saveCredentials()
   * This ensures Node-RED reads the correct files written by our save methods
   */
  private async loadFlowsIntoCache(): Promise<void> {
    try {
      // Get flows and credentials from Redis
      const flowsKey = this.getKey('flows');
      const credsKey = this.getKey('credentials');

      const [flowsData, credsData] = await Promise.all([
        this.client.get(flowsKey),
        this.client.get(credsKey),
      ]);

      if (flowsData) {
        const flows = await this.deserialize<FlowConfig>(flowsData);
        console.log('[ValkeyStorage] Worker: Loaded flows from Redis');

        // Call saveFlows() with skipPublish=true to write files without triggering restart
        await this.saveFlows(flows, true);
        console.log('[ValkeyStorage] Worker: Flows saved to filesystem');

        // Keep in cache for getFlows() calls
        this.cachedFlows = flows;
      } else {
        console.log('[ValkeyStorage] Worker: No flows in Redis, using empty');
        this.cachedFlows = { flows: [], rev: '0' };
      }

      if (credsData) {
        const creds = await this.deserialize<CredentialsConfig>(credsData);
        console.log('[ValkeyStorage] Worker: Loaded credentials from Redis');

        // Call saveCredentials() with skipPublish=true
        await this.saveCredentials(creds, true);
        console.log('[ValkeyStorage] Worker: Credentials saved');

        // Keep in cache
        this.cachedCredentials = creds;
      } else {
        console.log('[ValkeyStorage] Worker: No credentials in Redis, using empty');
        this.cachedCredentials = {};
      }
    } catch (error) {
      console.error('[ValkeyStorage] Error loading flows from Redis:', error);
      // Initialize with empty values
      this.cachedFlows = { flows: [], rev: '0' };
      this.cachedCredentials = {};
    }
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
   * Sanitize and validate flows data
   * Filters out null/undefined flows and ensures valid structure
   * Handles both array format (no project) and object format (with project)
   */
  private sanitizeFlows(flowConfig: any): FlowConfig {
    if (!flowConfig || typeof flowConfig !== 'object') {
      console.warn('[ValkeyStorage] Invalid flow config, returning empty');
      return { flows: [], rev: '0' };
    }

    // Handle case where flowConfig is already an array (no active project)
    // localfilesystem returns array directly when not using projects
    if (Array.isArray(flowConfig)) {
      console.log('[ValkeyStorage] Flow config is array (no active project), converting to object format');
      return {
        flows: flowConfig.filter((flow: any) => {
          if (flow === null || flow === undefined) return false;
          if (typeof flow !== 'object') return false;
          if (!flow.id) return false;
          return true;
        }),
        rev: '0',
      };
    }

    // Handle object format (active project or Redis storage)
    let flows = flowConfig.flows;
    if (!Array.isArray(flows)) {
      console.warn('[ValkeyStorage] Flow config missing flows array, initializing empty');
      flows = [];
    }

    // Filter out null/undefined entries and validate each flow has an id
    const validFlows = flows.filter((flow: any) => {
      if (flow === null || flow === undefined) {
        console.warn('[ValkeyStorage] Filtered out null/undefined flow');
        return false;
      }
      if (typeof flow !== 'object') {
        console.warn('[ValkeyStorage] Filtered out non-object flow:', typeof flow);
        return false;
      }
      if (!flow.id) {
        console.warn('[ValkeyStorage] Filtered out flow without id:', flow);
        return false;
      }
      return true;
    });

    // Log if we filtered any flows
    if (validFlows.length !== flows.length) {
      console.warn(
        `[ValkeyStorage] Sanitized flows: ${flows.length} → ${validFlows.length} (removed ${flows.length - validFlows.length} invalid entries)`
      );
    }

    // Ensure rev property exists
    const rev = flowConfig.rev || '0';

    return {
      flows: validFlows,
      rev: rev,
    };
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
   * Ensure package.json exists in userDir
   * Node-RED requires this file for Palette Manager to work
   */
  private async ensurePackageJson(userDir: string): Promise<void> {
    const packageJsonPath = path.join(userDir, 'package.json');

    try {
      await fs.access(packageJsonPath);
      console.log('[ValkeyStorage] package.json found at', packageJsonPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - create it
        console.log('[ValkeyStorage] Creating package.json at', packageJsonPath);

        const defaultPackageJson = {
          name: 'node-red-project',
          description: 'A Node-RED Project',
          version: '0.0.1',
          private: true,
          dependencies: {},
        };

        await fs.writeFile(packageJsonPath, JSON.stringify(defaultPackageJson, null, 4), 'utf8');

        console.log('[ValkeyStorage] package.json created successfully');
      } else {
        // Other error - re-throw
        console.error('[ValkeyStorage] Error checking package.json:', error);
        throw error;
      }
    }
  }

  /**
   * Ensure .config.json exists in userDir
   * Node-RED requires this file for settings management
   * Node-RED will automatically migrate this to separate .config.*.json files if needed
   */
  private async ensureConfigFiles(userDir: string): Promise<void> {
    const configPath = path.join(userDir, '.config.json');

    try {
      await fs.access(configPath);
      console.log('[ValkeyStorage] .config.json found at', configPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - create it with minimal structure
        console.log('[ValkeyStorage] Creating .config.json at', configPath);

        const defaultConfig = {
          nodes: {},
        };

        await fs.writeFile(configPath, JSON.stringify(defaultConfig, null, 4), 'utf8');

        console.log('[ValkeyStorage] .config.json created successfully');
      } else {
        // Other error - re-throw
        console.error('[ValkeyStorage] Error checking .config.json:', error);
        throw error;
      }
    }
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
    try {
      // Extract Node-RED .config.json from settings
      const configJson = settings['.config.json'];
      if (!configJson) {
        // No .config.json in settings - this is normal for non-palette operations
        return;
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
    } catch (error) {
      // Log detailed error for debugging
      console.error('[ValkeyStorage] Package sync failed:', error);
      console.error('[ValkeyStorage] Settings keys:', Object.keys(settings));

      // Re-throw with more context
      throw new Error(
        `Package synchronization failed: ${error instanceof Error ? error.message : String(error)}`
      );
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

  /**
   * Expose Projects module if localfilesystem is initialized
   */
  get projects() {
    const projectsModule = this.localfilesystem?.projects;
    console.log('[ValkeyStorage] projects getter called, returning:', projectsModule ? 'projects module' : 'undefined');
    return projectsModule;
  }
}
