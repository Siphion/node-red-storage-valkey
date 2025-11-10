# node-red-storage-valkey

A professional Valkey/Redis storage module for Node-RED with built-in pub/sub support for automatic worker reload in clustered environments.

> 💡 **Tip**: For complete Node-RED clustering, pair this with [node-red-context-valkey](https://github.com/Siphion/node-red-context-valkey) to share context data across instances. Both modules use the same `valkey` configuration object.

## Features

- ✅ **Full Storage API Implementation** - All 11 Node-RED storage methods
- ✅ **Valkey/Redis Compatible** - Works with both Valkey and Redis
- ✅ **Redis Sentinel Support** - High availability with automatic failover
- ✅ **Pub/Sub Auto-Reload** - Workers automatically reload when flows change
- ✅ **Package Synchronization** - Auto-sync Node-RED plugins from Admin to Workers
- ✅ **Projects & Git Integration** - Full support for Node-RED Projects with Git version control
- ✅ **Hybrid Storage** - Projects use file system (Git), flows use Redis (clustering)
- ✅ **TypeScript** - Full type safety and IntelliSense support
- ✅ **Compression** - Optional gzip compression for large flows
- ✅ **Production Ready** - Connection pooling, retry logic, error handling
- ✅ **Docker Swarm Ready** - Perfect for horizontal scaling

## Installation

```bash
npm install node-red-storage-valkey
```

## Configuration

### Admin Node (Flow Editor)

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD, // Optional
    keyPrefix: 'nodered:',
    publishOnSave: true, // Enable pub/sub notifications
    enableCompression: true, // Optional: compress large flows
    sessionTTL: 86400, // 24 hours
    // Package synchronization (optional)
    syncPackages: true, // Enable package sync to workers
    packageSyncOnAdmin: true // Publish package updates
  }
};
```

### Worker Nodes (Load Balanced API)

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  autoInstallModules: true, // Allow loading packages from node_modules
  valkey: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    keyPrefix: 'nodered:',
    enableProjects: false, // IMPORTANT: Disable Projects on workers
    subscribeToUpdates: true, // Auto-restart on flow changes
    updateChannel: 'nodered:flows:updated',
    // Package synchronization (optional)
    syncPackages: true, // Enable package sync from admin
    packageSyncOnWorker: true // Auto-install packages
  },
  // Disable editor on workers
  httpAdminRoot: false,
  editorTheme: {
    palette: {
      editable: false // Disable palette manager on workers
    }
  }
};
```

### Redis Sentinel (High Availability)

For production deployments with automatic failover:

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    // Sentinel configuration
    sentinels: [
      { host: 'sentinel1', port: 26379 },
      { host: 'sentinel2', port: 26379 },
      { host: 'sentinel3', port: 26379 }
    ],
    name: 'mymaster', // Sentinel master group name
    password: process.env.REDIS_PASSWORD, // Optional
    sentinelPassword: process.env.SENTINEL_PASSWORD, // Optional

    // Storage-specific options
    keyPrefix: 'nodered:',
    publishOnSave: true,
    enableCompression: true,

    // Package synchronization (optional - for admin nodes)
    syncPackages: true,
    packageSyncOnAdmin: true
  }
};
```

## How It Works

### Architecture Overview

**Redis is the Single Source of Truth** - All flows and credentials are stored in Redis. Both admin and worker nodes restore data from Redis to disk on startup, then execute from the local filesystem.

```
┌─────────────┐
│   Admin     │ ──── Save Flow ────┐
│  (Editor)   │                    │
└─────────────┘                    ▼
       │                      ┌──────────┐
       │                      │  Valkey  │ ◄── Source of Truth
       │                      │  /Redis  │
       ▼                      └──────────┘
 Local Disk                         │
  (synced)                          │
                           Pub/Sub  │
                                    ▼
                            ┌─────────────┐
                            │  Workers    │
                            │ Auto-Reload │
                            │  + Restore  │
                            └─────────────┘
                                   │
                                   ▼
                             Local Disk
                              (synced)
```

### Startup Process (Restore-on-Init)

Both admin and worker nodes follow this pattern on startup:

**Admin Node Startup:**
1. **Connect to Redis** → Initialize Redis client
2. **Check for active project** → Read `nodered:activeProject` from Redis
3. **Restore from Redis** → Write flows and credentials to project directory
4. **Activate project** → Write `.projects.json` to set active project
5. **Start Node-RED** → Load flows from restored filesystem

**Worker Node Startup:**
1. **Connect to Redis** → Initialize Redis client
2. **Restore from Redis** → Write flows and credentials to `/data/flows.json`
3. **Start Node-RED** → Load flows from restored filesystem
4. **Subscribe to updates** → Listen for flow changes from admin

### Flow Update Process

1. **Admin saves flow** → Data written to filesystem (Projects) AND Redis
2. **Save active project** → Project name stored in Redis (`nodered:activeProject`)
3. **Publish event** → `PUBLISH nodered:flows:updated <timestamp>`
4. **Workers receive event** → Subscribe to update channel
5. **Auto-restart** → Workers exit (Docker restarts them)
6. **Restore on restart** → Workers read latest flows from Redis to disk
7. **Load new flow** → Workers start with updated flows

## Deployment Architecture

### Recommended Pattern: Admin + Worker Nodes

For production deployments, use separate admin and worker nodes with different configurations:

```
┌─────────────────────────────────────────────────────┐
│ Admin Node (Single Instance)                        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ - Projects enabled (Git repos on disk)          │ │
│ │ - Editor enabled (/admin UI)                    │ │
│ │ - Palette Manager enabled                       │ │
│ │ - Persistent volume: /data/projects/            │ │
│ │ - publishOnSave: true                           │ │
│ │ - packageSyncOnAdmin: true                      │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
                      │
                      │ Redis Pub/Sub
                      │ (flows + packages)
                      ▼
┌─────────────────────────────────────────────────────┐
│ Worker Nodes (Horizontally Scaled)                  │
│ ┌────────────┐  ┌────────────┐  ┌────────────┐     │
│ │  Worker 1  │  │  Worker 2  │  │  Worker 3  │ ... │
│ │ Projects:  │  │ Projects:  │  │ Projects:  │     │
│ │ disabled   │  │ disabled   │  │ disabled   │     │
│ │ Ephemeral  │  │ Ephemeral  │  │ Ephemeral  │     │
│ │ storage    │  │ storage    │  │ storage    │     │
│ └────────────┘  └────────────┘  └────────────┘     │
└─────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Admin Node**:
   - Single instance with persistent storage for Git repositories
   - Enables Node-RED Projects for version control
   - Provides web editor for flow development
   - Publishes flow/package updates to workers via Redis pub/sub

2. **Worker Nodes**:
   - Horizontally scalable (add/remove as needed)
   - Stateless - no persistent storage required
   - Auto-reload flows from Redis when admin publishes
   - No Projects - just execute flows

3. **Benefits**:
   - Projects data persists on admin node only
   - Workers can scale independently
   - Zero-downtime deployments (rolling updates)
   - Git integration only where needed

### Example Configurations

#### Admin Node Settings

```javascript
// settings.js (Admin)
module.exports = {
  // Enable editor
  adminAuth: {
    type: "credentials",
    users: [{ username: "admin", password: "$2b$...", permissions: "*" }]
  },

  // Enable Projects with Git
  editorTheme: {
    projects: {
      enabled: true,
      workflow: { mode: "manual" }
    }
  },

  // Valkey storage with Projects support
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    keyPrefix: 'nodered:',

    // Admin publishes updates
    publishOnSave: true,
    updateChannel: 'nodered:flows:updated',

    // Package sync: admin publishes
    syncPackages: true,
    packageSyncOnAdmin: true,
    packageChannel: 'nodered:packages:updated'
  },

  // Persistent directory for Projects
  userDir: '/data'
};
```

#### Worker Node Settings

```javascript
// settings.js (Worker)
module.exports = {
  // Disable editor
  httpAdminRoot: false,

  // Projects disabled on workers
  editorTheme: {
    projects: { enabled: false },
    palette: { editable: false }
  },

  // Valkey storage without Projects
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    keyPrefix: 'nodered:',

    // IMPORTANT: Disable Projects on workers
    enableProjects: false,

    // Worker subscribes and auto-restarts
    subscribeToUpdates: true,
    updateChannel: 'nodered:flows:updated',

    // Package sync: worker installs
    syncPackages: true,
    packageSyncOnWorker: true,
    packageChannel: 'nodered:packages:updated'
  },

  // Ephemeral directory (no persistence needed)
  userDir: '/data'
};
```

### Docker/Kubernetes Examples

See the [examples/](./examples/) directory for:
- `docker-compose.yml` - Admin + Worker setup with Docker Compose
- `k8s/admin-statefulset.yaml` - Admin node with persistent volume
- `k8s/worker-deployment.yaml` - Scalable worker deployment

## Configuration Options

### Connection Options

The module supports all [ioredis connection options](https://github.com/redis/ioredis/blob/main/API.md#new-redisport-host-options). Common options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `'localhost'` | Redis host (single instance) |
| `port` | number | `6379` | Redis port (single instance) |
| `password` | string | `undefined` | Redis authentication password |
| `db` | number | `0` | Redis database number |
| `sentinels` | array | `undefined` | Sentinel nodes: `[{host, port}, ...]` |
| `name` | string | `undefined` | Sentinel master group name |
| `sentinelPassword` | string | `undefined` | Sentinel authentication password |
| `tls` | object | `undefined` | TLS/SSL configuration |

### Storage-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `keyPrefix` | string | `'nodered:'` | Prefix for all Redis keys |
| `enableProjects` | boolean | `true` | Enable Projects/Git support (admin: true, workers: false) |
| `publishOnSave` | boolean | `false` | Publish updates (admin nodes) |
| `subscribeToUpdates` | boolean | `false` | Subscribe to updates (worker nodes) |
| `updateChannel` | string | `'nodered:flows:updated'` | Pub/sub channel name |
| `enableCompression` | boolean | `false` | Gzip compression for large data |
| `sessionTTL` | number | `86400` | Session expiry (seconds) |
| `supportFileSystemProjects` | boolean | `false` | Enable file system sync for Node-RED projects |
| `syncPackages` | boolean | `false` | Enable package synchronization feature |
| `packageChannel` | string | `'nodered:packages:updated'` | Pub/sub channel for package updates |
| `packageSyncOnAdmin` | boolean | `false` | Publish package updates (admin nodes) |
| `packageSyncOnWorker` | boolean | `false` | Subscribe and auto-install (worker nodes) |

## Storage Keys

All data is stored with the configured `keyPrefix`:

- `nodered:flows` - Flow configuration (source of truth)
- `nodered:credentials` - Encrypted credentials (source of truth)
- `nodered:activeProject` - Active project metadata (name + timestamp)
- `nodered:settings` - User settings
- `nodered:sessions` - User sessions (with TTL)
- `nodered:library:<type>:<path>` - Library entries
- `nodered:config` - Node-RED package configuration (when `syncPackages` enabled)

**Important:** The `flows` and `credentials` keys in Redis are the **single source of truth**. Both admin and worker nodes restore from Redis to disk on startup.

## Node-RED Projects Support

### Git Integration Built-in

The storage module **includes full Node-RED Projects support** with Git integration. Projects use the local file system for Git operations while flows are stored in Redis for clustering.

```javascript
// settings.js - Admin Node
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    publishOnSave: true
  },
  // Enable projects in the editor
  editorTheme: {
    projects: {
      enabled: true
    }
  }
};
```

### How It Works

The module integrates Node-RED's built-in Projects module with Redis-as-source-of-truth architecture:

1. **Redis is source of truth** - All flows stored in Redis (`nodered:flows`)
2. **Active project tracking** - Project name stored in Redis (`nodered:activeProject`)
3. **Restore on startup** - Admin restores project files from Redis to disk
4. **Projects use file system** - Git repositories in `userDir/projects/<name>/`
5. **Save to both** - Admin saves to filesystem (Git) AND Redis (workers)
6. **Full Git integration** - Commit, push, pull, branch, merge via Node-RED UI
7. **Version control** - Track flow changes with Git history
8. **SSH keys** - Manage SSH keys for remote Git repositories
9. **Hybrid architecture** - Development (Git) + Production (Redis)

### Optional: File System Sync

Enable `supportFileSystemProjects` to also write flows to disk (in addition to Redis):

```javascript
valkey: {
  // ... other options
  supportFileSystemProjects: true  // Optional: also write flows to disk
}
```

When enabled:
- **Flows written to disk** - Saved to `userDir/flows.json` with proper formatting
- **Revision tracking** - Flow files include `rev` property for conflict detection
- **Automatic backup** - Creates `.flows.json.backup` on each save
- **Virgin installation fix** - If Redis is empty, loads from disk automatically

### Architecture (Hybrid Mode)

```
┌─────────────┐
│   Admin     │ ──── Save Flow ────────────┐
│  (Editor)   │                            │
└─────────────┘                            ▼
       │                              ┌──────────┐
       │                              │  Valkey  │ ◄── Source of Truth
       ▼                              │  /Redis  │     + activeProject
  projects/                           └──────────┘
  myproject/                               │
   flows.json ◄────── Restore on Init ─────┤
   (Git repo)                               │
                                   Pub/Sub  │
                                            ▼
                                    ┌─────────────┐
                                    │  Workers    │
                                    │ Auto-Reload │
                                    │  + Restore  │
                                    └─────────────┘
                                           │
                                           ▼
                                      flows.json
                                   (simple, no Git)
```

### Benefits

- ✅ **Git version control** - Full project features enabled on admin
- ✅ **Redis source of truth** - All nodes restore from Redis on startup
- ✅ **Cluster sync** - Redis ensures all nodes stay in sync
- ✅ **Auto-reload** - Workers reload automatically via pub/sub
- ✅ **Project tracking** - Active project name saved to Redis
- ✅ **Backup & recovery** - Flows persisted to disk and Redis
- ✅ **Development workflow** - Edit flows, commit to Git, deploy

### Important Notes

- **Admin nodes only** - Set `enableProjects: true` (default) on admin nodes
- **Worker nodes** - Must set `enableProjects: false` to disable Projects
- **userDir required** - Node-RED must have a valid `userDir` configured
- **Restore on init** - Both admin and workers restore from Redis at startup
- **File format** - Admin uses project structure, workers use simple `flows.json`

## Package Synchronization

### Automatic Plugin Sync Across Cluster

Enable automatic synchronization of Node-RED plugins (palette nodes) from Admin to Worker nodes. When you install a package via the Palette Manager on the Admin node, it automatically installs on all Worker nodes.

```javascript
// Admin node configuration
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    publishOnSave: true,
    // Enable package sync
    syncPackages: true,
    packageSyncOnAdmin: true,
    packageChannel: 'nodered:packages:updated'
  }
};
```

```javascript
// Worker node configuration
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  autoInstallModules: true,  // Node-RED setting
  valkey: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    subscribeToUpdates: true,
    // Enable package sync
    syncPackages: true,
    packageSyncOnWorker: true,
    packageChannel: 'nodered:packages:updated'
  },
  editorTheme: {
    palette: {
      editable: false  // Disable palette on workers
    }
  }
};
```

### How It Works

1. **Admin installs package** → Install via Palette Manager
2. **Save to Redis** → `.config.json` stored in `nodered:config`
3. **Publish event** → `PUBLISH nodered:packages:updated [package-list]`
4. **Workers receive event** → Subscribe to package channel
5. **Auto-install** → Workers run `npm install <packages>`
6. **Auto-restart** → Workers exit (Docker restarts them)
7. **Load with new packages** → Workers start with new nodes available

### Package Sync Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `syncPackages` | boolean | `false` | Enable package synchronization feature |
| `packageChannel` | string | `'nodered:packages:updated'` | Pub/sub channel for package updates |
| `packageSyncOnAdmin` | boolean | `false` | Publish package updates (Admin only) |
| `packageSyncOnWorker` | boolean | `false` | Subscribe and auto-install (Workers only) |

### Storage Keys

When package sync is enabled:

- `nodered:config` - Node-RED `.config.json` (installed packages metadata)

### Architecture

```
┌─────────────┐
│   Admin     │ ── Install Package via Palette Manager
│  (Editor)   │
└─────────────┘
       │
       │ 1. Save .config.json
       ▼
  ┌──────────┐
  │  Valkey  │ ── Store package list: nodered:config
  │  /Redis  │
  └──────────┘
       │
       │ 2. PUBLISH nodered:packages:updated
       │
       ├───────────────┬───────────────┐
       ▼               ▼               ▼
  ┌─────────┐    ┌─────────┐    ┌─────────┐
  │Worker 1 │    │Worker 2 │    │Worker 3 │
  │npm inst │    │npm inst │    │npm inst │
  │restart  │    │restart  │    │restart  │
  └─────────┘    └─────────────┘    └─────────┘
```

### Important Notes

- **Fail-fast behavior** - Workers crash if package installation fails (ensures consistency)
- **Admin only installs** - Only Admin node should have palette editor enabled
- **Worker auto-install** - Workers automatically install packages without user intervention
- **userDir required** - Workers need write access to `node_modules` directory
- **Docker/K8s ready** - Designed for container orchestration with automatic restarts
- **Core nodes filtered** - Only user-installed packages sync (not built-in `node-red/*` modules)

### Requirements

- Node-RED `userDir` must be configured
- Workers must have write access to `userDir/node_modules`
- npm must be available in PATH
- Container orchestration with restart policy (Docker, Kubernetes, etc.)

### Troubleshooting

#### Workers don't install packages

Check that:
- `syncPackages: true` on both Admin and Workers
- `packageSyncOnAdmin: true` on Admin
- `packageSyncOnWorker: true` on Workers
- Same `packageChannel` on both
- Workers have write access to `userDir`
- npm is available: run `which npm` or `npm --version`

#### Package install fails

Workers will crash (exit code 1) if package installation fails. Check logs:

```bash
# Docker
docker logs <worker-container>

# View npm errors
[ValkeyStorage] npm: ERR! <error details>
```

Common causes:
- Network issues (npm registry unreachable)
- Invalid package name
- Package version conflicts
- Insufficient disk space
- Missing build tools (for native modules)

#### Packages installed but nodes not available

Ensure `autoInstallModules: true` in Node-RED settings. This tells Node-RED to load packages from `node_modules` directory.

## Use Cases

### Complete Clustering Solution

For full Node-RED clustering with shared state across all instances, combine with [node-red-context-valkey](https://github.com/Siphion/node-red-context-valkey):

```javascript
// settings.js - Complete clustering setup
module.exports = {
  // Storage module (flows, credentials, settings)
  storageModule: require('node-red-storage-valkey'),

  // Context module (shared context data)
  contextStorage: {
    default: {
      module: require('node-red-context-valkey')
    }
  },

  // Node-RED settings
  autoInstallModules: true,

  // Shared configuration for both modules
  valkey: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    publishOnSave: true,
    subscribeToUpdates: true,
    enableCompression: true,
    // Package synchronization
    syncPackages: true,
    packageSyncOnAdmin: true,    // Enable on admin
    packageSyncOnWorker: true    // Enable on workers
  }
};
```

This gives you:
- ✅ Shared flows and credentials (this module)
- ✅ Shared context data (node-red-context-valkey)
- ✅ Auto-reload on flow updates
- ✅ Auto-sync packages across cluster
- ✅ True horizontal scaling with shared state

### Docker Swarm Cluster

Perfect for horizontally scaled Node-RED deployments:

```yaml
services:
  nodered-admin:
    image: nodered/node-red:latest
    ports:
      - "8880:1880"
    environment:
      - REDIS_HOST=valkey
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.role == manager

  nodered-worker:
    image: nodered/node-red:latest
    ports:
      - "8881:1880"
    environment:
      - REDIS_HOST=valkey
    deploy:
      replicas: 10  # Scale to any number!

  valkey:
    image: valkey/valkey:8-alpine
    volumes:
      - valkey_data:/data
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: nodered-workers
spec:
  replicas: 5
  selector:
    matchLabels:
      app: nodered-worker
  template:
    spec:
      containers:
      - name: nodered
        image: nodered/node-red:latest
        env:
        - name: REDIS_HOST
          value: "valkey-service"
```

## Development

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Lint code
npm run lint

# Publish to npm
npm publish
```

## Requirements

- Node.js >= 18.0.0
- Valkey >= 8.0 or Redis >= 6.0
- Node-RED >= 3.0.0

## Comparison

| Feature | File System | node-red-storage-valkey |
|---------|------------|------------------------|
| **Horizontal Scaling** | ❌ Requires NFS | ✅ Native |
| **Auto-Reload** | ❌ Manual restart | ✅ Automatic |
| **Performance** | Disk I/O | In-memory |
| **High Availability** | ❌ Single point | ✅ Sentinel/Cluster |
| **Setup Complexity** | Simple | Simple |

## Troubleshooting

### Workers don't reload

Check that:
- `publishOnSave: true` on admin
- `subscribeToUpdates: true` on workers
- Same `updateChannel` on both
- Workers can connect to Valkey/Redis

### Connection errors

The module automatically handles reconnections, but you can customize retry behavior:

```javascript
valkey: {
  host: 'valkey',
  port: 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3,
  connectTimeout: 10000
}
```

### Sentinel failover

When using Sentinel, failover is automatic. The module will:
1. Detect master failure via Sentinel
2. Automatically connect to new master
3. Continue operations without manual intervention

Check logs for connection status:
```
[ValkeyStorage] Connected to Redis (Sentinel mode)
```

## License

Apache-2.0

## Author

Siphion

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## Support

- GitHub Issues: https://github.com/Siphion/node-red-storage-valkey/issues
- Node-RED Forum: https://discourse.nodered.org/


