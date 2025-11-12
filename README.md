> ⚠️ **Deprecated:** This repository is no longer maintained.  
> The project has moved to [Siphion/node-red-cluster](https://github.com/Siphion/node-red-cluster).


# node-red-storage-valkey

A professional Valkey/Redis storage module for Node-RED with built-in pub/sub support for automatic worker reload in clustered environments.

> 💡 **Tip**: For complete Node-RED clustering, pair this with [node-red-context-valkey](https://github.com/Siphion/node-red-context-valkey) to share context data across instances. Both modules use the same `valkey` configuration object.

## Features

- ✅ **Full Storage API Implementation** - All 11 Node-RED storage methods
- ✅ **Admin/Worker Architecture** - Separate roles for editor and execution
- ✅ **Valkey/Redis Compatible** - Works with both Valkey and Redis
- ✅ **Redis Sentinel Support** - High availability with automatic failover
- ✅ **Pub/Sub Hot-Reload** - Workers reload flows without process restart
- ✅ **Package Synchronization** - Auto-sync Node-RED plugins from Admin to Workers
- ✅ **TypeScript** - Full type safety and IntelliSense support
- ✅ **Compression** - Optional gzip compression for large flows
- ✅ **Production Ready** - Connection pooling, retry logic, error handling
- ✅ **Docker/K8s Ready** - Perfect for horizontal scaling

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
    role: 'admin',  // REQUIRED: Specify admin role
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD, // Optional
    keyPrefix: 'nodered:',
    enableCompression: true, // Optional: compress large flows
    sessionTTL: 86400, // 24 hours
    // Package synchronization (enabled by default)
    syncPackages: true, // Default: true
    packageChannel: 'nodered:packages:updated'
  }
};
```

### Worker Nodes (Flow Execution)

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  autoInstallModules: true, // Allow loading packages from node_modules
  valkey: {
    role: 'worker',  // REQUIRED: Specify worker role
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379',
    keyPrefix: 'nodered:',
    updateChannel: 'nodered:flows:updated',
    // Package synchronization (enabled by default)
    syncPackages: true, // Default: true
    packageChannel: 'nodered:packages:updated'
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
    role: 'admin', // or 'worker'
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
    enableCompression: true,
    syncPackages: true
  }
};
```

## How It Works

### Architecture Overview

**Admin/Worker Architecture** - Admin nodes provide the editor UI and manage flows on disk. Worker nodes are stateless and read everything from Redis for execution. Redis is the single source of truth for all worker nodes.

```
┌─────────────┐
│   Admin     │ ──── Save Flow ────┐
│  (Editor)   │                    │
│  Disk: RW   │                    ▼
└─────────────┘              ┌──────────┐
       │                     │  Valkey  │ ◄── Source of Truth
       │                     │  /Redis  │     (flows, credentials,
       ▼                     └──────────┘      settings, packages)
 Local Disk                       │
 (flows.json)                     │
                         Pub/Sub  │
                                  ▼
                          ┌─────────────┐
                          │  Workers    │
                          │ Hot-Reload  │
                          │ (Read-Only) │
                          └─────────────┘
                                 │
                                 ▼
                           flows.json
                          (read from Redis)
```

### Role-Based Behavior

#### Admin Node (`role: 'admin'`)
- **Disk is source** → Reads/writes flows to local filesystem
- **Syncs to Redis** → Every save writes to Redis for workers
- **Publishes updates** → Notifies workers via pub/sub when flows change
- **Manages packages** → Installs plugins via Palette Manager, publishes package list to Redis
- **Editor enabled** → Provides web UI for flow development

#### Worker Node (`role: 'worker'`)
- **Redis is source** → Reads flows, credentials, settings directly from Redis
- **Stateless** → No persistent disk storage needed
- **Hot-reload** → Listens for flow updates and reloads without restart
- **Auto-sync packages** → Automatically installs packages published by admin
- **Read-only** → Cannot modify flows (editor disabled)

### Flow Update Process

1. **Admin saves flow** → Data written to local filesystem
2. **Sync to Redis** → Flow data synced to Redis (`nodered:flows`)
3. **Publish event** → `PUBLISH nodered:flows:updated <timestamp>`
4. **Workers receive event** → Subscribe to update channel
5. **Hot reload** → Workers call `runtime.nodes.loadFlows()` to reload without restart
6. **No downtime** → Workers continue running, flows reloaded in-place

### Package Synchronization

1. **Admin installs package** → Install via Palette Manager
2. **Read package.json** → After 500ms debounce, read installed packages
3. **Save to Redis** → Package list stored in `nodered:packages`
4. **Publish event** → `PUBLISH nodered:packages:updated [package-list]`
5. **Workers receive event** → Subscribe to package channel
6. **Compare packages** → Worker reads own package.json, calculates diff
7. **Install/Uninstall** → Worker runs `npm install --save` / `npm uninstall --save`
8. **Packages available** → New nodes immediately available to flows (no restart)

### Startup Process

**Admin Node Startup:**
1. **Connect to Redis** → Initialize Redis client
2. **Load from disk** → Read flows.json from local filesystem
3. **Sync to Redis** → Ensure Redis has latest flows
4. **Start Node-RED** → Load flows from disk
5. **Ready** → Editor available, can modify flows

**Worker Node Startup:**
1. **Connect to Redis** → Initialize Redis client
2. **Restore from Redis** → Write flows, credentials, settings to local disk
3. **Sync packages** → Read package list from Redis, install missing packages
4. **Start Node-RED** → Load flows from restored filesystem
5. **Subscribe to updates** → Listen for flow and package changes
6. **Ready** → Execute flows, auto-reload on updates

## Deployment Architecture

### Recommended Pattern: Admin + Worker Nodes

For production deployments, use separate admin and worker nodes:

```
┌─────────────────────────────────────────────────────┐
│ Admin Node (Single Instance)                        │
│ ┌─────────────────────────────────────────────────┐ │
│ │ - role: 'admin'                                 │ │
│ │ - Editor enabled (/admin UI)                    │ │
│ │ - Palette Manager enabled                       │ │
│ │ - Persistent volume: /data/                     │ │
│ │ - Publishes flow updates via pub/sub           │ │
│ │ - Publishes package list to Redis              │ │
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
│ │ role:      │  │ role:      │  │ role:      │     │
│ │ 'worker'   │  │ 'worker'   │  │ 'worker'   │     │
│ │ Ephemeral  │  │ Ephemeral  │  │ Ephemeral  │     │
│ │ Hot-reload │  │ Hot-reload │  │ Hot-reload │     │
│ └────────────┘  └────────────┘  └────────────┘     │
└─────────────────────────────────────────────────────┘
```

### Why This Architecture?

1. **Admin Node**:
   - Single instance with persistent storage for flows
   - Provides web editor for flow development
   - Publishes flow/package updates to workers via Redis pub/sub
   - Manages package installation via Palette Manager

2. **Worker Nodes**:
   - Horizontally scalable (add/remove as needed)
   - Stateless - no persistent storage required
   - Hot-reload flows from Redis when admin publishes (no restart)
   - Auto-install packages published by admin (no restart)
   - Read-only execution mode

3. **Benefits**:
   - Flow data persists on admin node only
   - Workers can scale independently
   - Zero-downtime deployments (hot-reload)
   - No process restarts for flow or package updates
   - Simple and clean separation of concerns

## Configuration Options

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `role` | `'admin'` \| `'worker'` | **REQUIRED** - Specifies node role |

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
| `updateChannel` | string | `'nodered:flows:updated'` | Pub/sub channel for flow updates |
| `enableCompression` | boolean | `false` | Gzip compression for large data |
| `sessionTTL` | number | `86400` | Session expiry (seconds) |
| `syncPackages` | boolean | `true` | Enable package synchronization |
| `packageChannel` | string | `'nodered:packages:updated'` | Pub/sub channel for package updates |

## Storage Keys

All data is stored with the configured `keyPrefix`:

- `nodered:flows` - Flow configuration (worker source of truth)
- `nodered:credentials` - Encrypted credentials (worker source of truth)
- `nodered:settings` - User settings
- `nodered:sessions` - User sessions (with TTL)
- `nodered:library:<type>:<path>` - Library entries
- `nodered:packages` - Installed package list (for worker sync)

**Important:** For workers, the `flows`, `credentials`, and `settings` keys in Redis are the **single source of truth**. Workers always read from Redis.

## Package Synchronization

### Automatic Plugin Sync Across Cluster

Package synchronization is **enabled by default**. When you install a package via the Palette Manager on the Admin node, it automatically installs on all Worker nodes without restart.

### How It Works

1. **Admin installs package** → Install via Palette Manager
2. **Debounced sync** → After 500ms, read package.json
3. **Save to Redis** → Package list stored in `nodered:packages`
4. **Publish event** → `PUBLISH nodered:packages:updated [package-list]`
5. **Workers receive event** → Subscribe to package channel
6. **Calculate diff** → Compare admin list with worker's package.json
7. **Install missing** → Workers run `npm install --save <packages>`
8. **Uninstall removed** → Workers run `npm uninstall --save <packages>`
9. **No restart** → Packages immediately available to flows

### Configuration

```javascript
// Admin node
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    role: 'admin',
    host: 'localhost',
    port: 6379,
    syncPackages: true, // Default: true, can disable with false
    packageChannel: 'nodered:packages:updated'
  }
};
```

```javascript
// Worker node
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  autoInstallModules: true,  // Node-RED setting - required!
  valkey: {
    role: 'worker',
    host: 'localhost',
    port: 6379,
    syncPackages: true, // Default: true, can disable with false
    packageChannel: 'nodered:packages:updated'
  },
  editorTheme: {
    palette: {
      editable: false  // Disable palette on workers
    }
  }
};
```

### Important Notes

- **Default enabled** - Package sync is ON by default, set `syncPackages: false` to disable
- **Admin only installs** - Only Admin node should have palette editor enabled
- **Worker auto-install** - Workers automatically install/uninstall packages
- **No restart** - Packages available immediately without process restart
- **Debounced** - Admin waits 500ms after saveSettings() to allow package.json update
- **userDir required** - Workers need write access to `node_modules` directory
- **--save flag** - Both install and uninstall use `--save` to update package.json

### Requirements

- Node-RED `userDir` must be configured
- Workers must have write access to `userDir/node_modules`
- npm must be available in PATH
- `autoInstallModules: true` in Node-RED settings

### Troubleshooting

#### Workers don't install packages

Check that:
- `syncPackages: true` on both Admin and Workers (or omit, defaults to true)
- Same `packageChannel` on both
- Workers have write access to `userDir`
- npm is available: run `which npm` or `npm --version`

#### Package install fails

Check logs for errors:

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
// settings.js - Worker node with full clustering
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
    role: 'worker',
    host: 'localhost',
    port: 6379,
    keyPrefix: 'nodered:',
    updateChannel: 'nodered:flows:updated',
    enableCompression: true,
    syncPackages: true
  }
};
```

This gives you:
- ✅ Shared flows and credentials (this module)
- ✅ Shared context data (node-red-context-valkey)
- ✅ Hot-reload on flow updates (no restart)
- ✅ Auto-sync packages across cluster (no restart)
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
    volumes:
      - admin_data:/data
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
| **Hot-Reload** | ❌ Manual restart | ✅ Automatic |
| **Performance** | Disk I/O | In-memory |
| **High Availability** | ❌ Single point | ✅ Sentinel/Cluster |
| **Setup Complexity** | Simple | Simple |

## Troubleshooting

### Workers don't reload

Check that:
- `role: 'admin'` on admin node
- `role: 'worker'` on worker nodes
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

