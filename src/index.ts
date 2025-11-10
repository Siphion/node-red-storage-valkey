import { ValkeyStorage } from './storage.js';
import { PackageHelper } from './package-helper.js';

export { ValkeyStorage, PackageHelper };
export * from './types.js';

// Create singleton instance
const storage = new ValkeyStorage();

// Projects proxy - forwards all calls to the real module after init
// We use a Proxy to handle the case where Node-RED copies the reference before init()
let realProjectsModule: any = null;
let localfilesystemModule: any = null;

// Cache for Git user settings - updated synchronously from saveSettings
// Node-RED calls getGlobalGitUser() WITHOUT await, so it must be synchronous
let cachedGitUser: any = null;

/**
 * Update the cached Git user from user settings
 * Called after init and after every saveSettings call
 */
const updateGitUserCache = async (): Promise<void> => {
  if (!localfilesystemModule) {
    return;
  }

  try {
    const settings = await localfilesystemModule.getSettings();

    // User settings are stored in users object with username as key
    if (settings.users) {
      const usernames = Object.keys(settings.users);
      if (usernames.length > 0) {
        const firstUser = settings.users[usernames[0]];
        if (firstUser && firstUser.git && firstUser.git.user) {
          cachedGitUser = firstUser.git;
          console.log('[ValkeyStorage] Git user cache updated:', cachedGitUser);

          // Automatically configure Git in the active project repository
          await configureGitInProject(firstUser.git.user);
          return;
        }
      }
    }

    // No user settings found - keep existing cache or use original
    console.log('[ValkeyStorage] No git user in settings, cache unchanged');
  } catch (error) {
    console.error('[ValkeyStorage] Error updating git user cache:', error);
  }
};

/**
 * Configure Git user in the active project repository
 * This ensures git commits work even if global config is not set
 */
const configureGitInProject = async (gitUser: { name?: string; email?: string }): Promise<void> => {
  if (!realProjectsModule || !gitUser.name || !gitUser.email) {
    return;
  }

  try {
    // Get active project
    const activeProject = realProjectsModule.getActiveProject();
    if (!activeProject || !activeProject.path) {
      console.log('[ValkeyStorage] No active project, skipping git config');
      return;
    }

    const projectPath = activeProject.path;
    console.log('[ValkeyStorage] Configuring Git in project:', projectPath);

    // Use Node.js child_process to run git config commands
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);

    // Set user.name
    await execAsync(`git config user.name "${gitUser.name}"`, {
      cwd: projectPath,
    });

    // Set user.email
    await execAsync(`git config user.email "${gitUser.email}"`, {
      cwd: projectPath,
    });

    console.log('[ValkeyStorage] Git configured successfully:', gitUser);
  } catch (error: any) {
    console.error('[ValkeyStorage] Error configuring git in project:', error.message);
  }
};

const projectsProxy = new Proxy(
  {},
  {
    get(target, prop) {
      // If Projects module failed to initialize, return safe defaults
      if (!realProjectsModule) {
        console.warn(`[ValkeyStorage] Projects not available - method "${String(prop)}" called but module not initialized`);

        // Return safe defaults for common methods
        if (prop === 'getActiveProject') {
          return () => null;
        }
        if (prop === 'getGlobalGitUser') {
          return () => cachedGitUser || false;
        }
        if (prop === 'flowFileExists') {
          return () => false;
        }

        // For other methods, return a function that returns empty object
        return () => ({});
      }

      // Intercept getGlobalGitUser to return cached value SYNCHRONOUSLY
      // Node-RED calls this without await, so it must not return a Promise
      if (prop === 'getGlobalGitUser') {
        return () => {
          // Return cached value if available, otherwise fall back to original
          if (cachedGitUser) {
            return cachedGitUser;
          }
          return realProjectsModule.getGlobalGitUser();
        };
      }

      // Get the original property/method
      const originalValue = realProjectsModule[prop];

      // If it's a function, wrap it to handle errors gracefully
      if (typeof originalValue === 'function') {
        return (...args: any[]) => {
          try {
            const result = originalValue.apply(realProjectsModule, args);

            // If it's a Promise, handle async result
            if (result && typeof result.then === 'function') {
              return result
                .then((asyncResult: any) => {
                  // If async result is undefined/null, return empty object
                  if (asyncResult === undefined || asyncResult === null) {
                    console.warn(`[ValkeyStorage] Async method ${String(prop)} returned null/undefined, returning empty object`);
                    return {};
                  }
                  return asyncResult;
                })
                .catch((error: any) => {
                  console.error(`[ValkeyStorage] Error in async projects.${String(prop)}:`, error.message);
                  return null;
                });
            }

            // Sync result - if undefined/null, return empty object
            if (result === undefined || result === null) {
              console.warn(`[ValkeyStorage] Sync method ${String(prop)} returned null/undefined, returning empty object`);
              return {};
            }

            return result;
          } catch (error: any) {
            console.error(`[ValkeyStorage] Error calling projects.${String(prop)}:`, error.message);
            return null;
          }
        };
      }

      return originalValue;
    },
    has(target, prop) {
      // Return true to indicate properties exist (for hasOwnProperty checks)
      return realProjectsModule ? prop in realProjectsModule : false;
    },
  }
);

// Export plain object with methods as own properties for Node-RED compatibility
// Node-RED uses hasOwnProperty() to check method existence, which doesn't work with class instances
const storageModule: any = {
  init: async (settings: any, runtime: any) => {
    await storage.init(settings, runtime);

    // Populate the real projects module reference and localfilesystem reference
    if (storage.projects) {
      realProjectsModule = storage.projects;
      localfilesystemModule = storage.localfilesystem;
      console.log('[ValkeyStorage] Projects module loaded and ready');

      // Initialize Git user cache from settings
      await updateGitUserCache();
    } else {
      console.log('[ValkeyStorage] Projects module not available');
    }
  },
  getFlows: () => storage.getFlows(),
  saveFlows: (flows: any) => storage.saveFlows(flows),
  getCredentials: () => storage.getCredentials(),
  saveCredentials: (credentials: any) => storage.saveCredentials(credentials),
  getSettings: () => storage.getSettings(),
  saveSettings: async (settings: any) => {
    await storage.saveSettings(settings);

    // Update Git user cache after settings are saved
    // This ensures UI changes to Git config are immediately reflected
    await updateGitUserCache();
  },
  getSessions: () => storage.getSessions(),
  saveSessions: (sessions: any) => storage.saveSessions(sessions),
  getLibraryEntry: (type: string, path: string) => storage.getLibraryEntry(type, path),
  saveLibraryEntry: (type: string, path: string, meta: Record<string, any>, body: string) =>
    storage.saveLibraryEntry(type, path, meta, body),

  // Expose projects proxy - Node-RED will copy this reference before init()
  // The proxy will forward all calls to the real module after init
  projects: projectsProxy,
};

// Export as default for ESM
export default storageModule;

// Export for CommonJS (Node-RED compatibility)
module.exports = storageModule;
