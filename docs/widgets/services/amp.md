---
title: AMP
description: AMP Widget Configuration
---

Learn more about [CubeCoders AMP](https://cubecoders.com/AMP).

This widget connects directly to AMP, logs in with your AMP user, and displays either:

- a summary view for all game instances, or
- a single instance view when `instance` is set.

Allowed fields:

- Summary mode: `["running", "total", "cpu", "ram"]`
- Instance mode: `["state", "cpu", "players", "maxPlayers"]`

Summary mode example:

```yaml
widget:
  type: amp
  url: http://192.168.0.81:8080
  username: homepage_api
  password: your_amp_password
  refreshInterval: 60000 # optional, defaults to 60000
```

Instance mode example:

```yaml
widget:
  type: amp
  url: http://192.168.0.81:8080
  username: homepage_api
  password: your_amp_password
  instance: 5bb79473 # full UUID, unique short UUID prefix, exact instance name, or exact display name
  refreshInterval: 60000
```

Optional advanced settings:

```yaml
widget:
  type: amp
  url: http://192.168.0.81:8080
  username: homepage_api
  password: your_amp_password
  loginPath: /API/Core/Login # optional
  instancesPath: /API/ADSModule/GetInstances # optional
  requestTimeoutMs: 10000 # optional
```
