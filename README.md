# node-red-storage-valkey

A professional Valkey/Redis storage module for Node-RED with built-in pub/sub support for automatic worker reload in clustered environments.

> 💡 **Tip**: For complete Node-RED clustering, pair this with [node-red-context-valkey](https://github.com/Siphion/node-red-context-valkey) to share context data across instances. Both modules use the same `valkey` configuration object.

## Features

- ✅ **Full Storage API Implementation** - All 11 Node-RED storage methods
- ✅ **Valkey/Redis Compatible** - Works with both Valkey and Redis
- ✅ **Redis Sentinel Support** - High availability with automatic failover
- ✅ **Pub/Sub Auto-Reload** - Workers automatically reload when flows change
- ✅ **Package Synchronization** - Auto-sync Node-RED plugins from Admin to Workers
- ✅ **Projects Support** - Optional file system sync for Node-RED projects and Git integration
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

### Architecture

```
┌─────────────┐
│   Admin     │ ──── Save Flow ────┐
│  (Editor)   │                    │
└─────────────┘                    ▼
                              ┌──────────┐
┌─────────────┐               │  Valkey  │
│  Worker 1   │ ◄──────────── │  /Redis  │
└─────────────┘       ▲       └──────────┘
                      │             │
┌─────────────┐       │             │
│  Worker 2   │ ◄─────┴─ Pub/Sub ──┘
└─────────────┘       Reload

┌─────────────┐
│  Worker 3   │ ◄──── Auto Reload
└─────────────┘
```

### Flow Update Process

1. **Admin saves flow** → Data written to Valkey
2. **Publish event** → `PUBLISH nodered:flows:updated <timestamp>`
3. **Workers receive event** → Subscribe to update channel
4. **Auto-restart** → Workers exit (Docker restarts them)
5. **Load new flow** → Workers fetch latest from Valkey

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

- `nodered:flows` - Flow configuration
- `nodered:credentials` - Encrypted credentials
- `nodered:settings` - User settings
- `nodered:sessions` - User sessions (with TTL)
- `nodered:library:<type>:<path>` - Library entries
- `nodered:config` - Node-RED package configuration (when `syncPackages` enabled)

## Node-RED Projects Support

### Hybrid Storage Mode

Enable file system sync to support Node-RED projects features (Git integration, version control) while maintaining Redis-based clustering:

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    publishOnSave: true,
    supportFileSystemProjects: true  // Enable file system sync
  },
  // Enable projects
  editorTheme: {
    projects: {
      enabled: true
    }
  }
};
```

### How It Works

When `supportFileSystemProjects` is enabled:

1. **Redis remains primary storage** - All cluster nodes sync via Redis
2. **Flows written to disk** - Saved to `~/.node-red/flows.json` with proper formatting
3. **Git integration works** - Projects can track changes with Git
4. **Revision tracking** - Flow files include `rev` property for conflict detection
5. **Automatic backup** - Creates `.flows.json.backup` on each save
6. **Virgin installation fix** - If Redis is empty, loads from disk automatically

### Architecture (Hybrid Mode)

```
┌─────────────┐
│   Admin     │ ──── Save Flow ────┐
│  (Editor)   │                    │
└─────────────┘                    ▼
       │                      ┌──────────┐
       │                      │  Valkey  │
       ▼                      │  /Redis  │
  flows.json ◄──────────────► └──────────┘
  (Git repo)         Sync          │
                                   │
                          Pub/Sub  │
                                   ▼
                            ┌─────────────┐
                            │  Workers    │
                            │ Auto-Reload │
                            └─────────────┘
```

### Benefits

- ✅ **Git version control** - Full project features enabled
- ✅ **Cluster sync** - Redis ensures all nodes stay in sync
- ✅ **Auto-reload** - Workers still reload automatically via pub/sub
- ✅ **Backup & recovery** - Flows persisted to disk and Redis
- ✅ **Development workflow** - Edit flows, commit to Git, deploy

### Important Notes

- **Admin nodes only** - Only enable on nodes with editor access
- **Worker nodes** - Should NOT enable `supportFileSystemProjects` (Redis-only)
- **userDir required** - Node-RED must have a valid `userDir` configured
- **File format** - Flows saved as `{rev: "...", flows: [...]}` for projects compatibility

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


