# node-red-storage-valkey

A professional Valkey/Redis storage module for Node-RED with built-in pub/sub support for automatic worker reload in clustered environments.

## Features

- ✅ **Full Storage API Implementation** - All 11 Node-RED storage methods
- ✅ **Valkey/Redis Compatible** - Works with both Valkey and Redis
- ✅ **Pub/Sub Auto-Reload** - Workers automatically reload when flows change
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
    sessionTTL: 86400 // 24 hours
  }
};
```

### Worker Nodes (Load Balanced API)

```javascript
// settings.js
module.exports = {
  storageModule: require('node-red-storage-valkey'),
  valkey: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    keyPrefix: 'nodered:',
    subscribeToUpdates: true, // Auto-restart on flow changes
    updateChannel: 'nodered:flows:updated'
  },
  // Disable editor on workers
  httpAdminRoot: false
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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | string | `'localhost'` | Valkey/Redis host |
| `port` | number | `6379` | Valkey/Redis port |
| `password` | string | `undefined` | Authentication password |
| `keyPrefix` | string | `'nodered:'` | Prefix for all keys |
| `publishOnSave` | boolean | `false` | Enable pub/sub on admin |
| `subscribeToUpdates` | boolean | `false` | Enable auto-reload on workers |
| `updateChannel` | string | `'nodered:flows:updated'` | Pub/sub channel name |
| `enableCompression` | boolean | `false` | Gzip compression for flows |
| `sessionTTL` | number | `86400` | Session expiry in seconds |

## Storage Keys

All data is stored with the configured `keyPrefix`:

- `nodered:flows` - Flow configuration
- `nodered:credentials` - Encrypted credentials
- `nodered:settings` - User settings
- `nodered:sessions` - User sessions (with TTL)
- `nodered:library:<type>:<path>` - Library entries

## Use Cases

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
| **High Availability** | ❌ Single point | ✅ Redis cluster |
| **Setup Complexity** | Simple | Simple |

## Troubleshooting

### Workers don't reload

Check that:
- `publishOnSave: true` on admin
- `subscribeToUpdates: true` on workers
- Same `updateChannel` on both
- Workers can connect to Valkey/Redis

### Connection errors

```javascript
// Add retry and reconnect settings
valkey: {
  host: 'valkey',
  port: 6379,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 3
}
```

## License

MIT

## Author

Siphion

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## Support

- GitHub Issues: https://github.com/Siphion/node-red-storage-valkey/issues
- Node-RED Forum: https://discourse.nodered.org/
