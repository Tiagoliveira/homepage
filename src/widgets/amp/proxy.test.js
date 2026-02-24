import { beforeEach, describe, expect, it, vi } from "vitest";

import createMockRes from "test-utils/create-mock-res";

const { httpProxy, getServiceWidget, cache, logger } = vi.hoisted(() => {
  const store = new Map();

  return {
    httpProxy: vi.fn(),
    getServiceWidget: vi.fn(),
    cache: {
      get: vi.fn((k) => store.get(k)),
      put: vi.fn((k, v) => store.set(k, v)),
      del: vi.fn((k) => store.delete(k)),
      _reset: () => store.clear(),
    },
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    },
  };
});

vi.mock("utils/logger", () => ({
  default: () => logger,
}));

vi.mock("utils/config/service-helpers", () => ({
  default: getServiceWidget,
}));

vi.mock("utils/proxy/http", () => ({
  httpProxy,
}));

vi.mock("memory-cache", () => ({
  default: cache,
  ...cache,
}));

import ampProxyHandler from "./proxy";

function ampInstancesPayload() {
  return {
    result: {
      AvailableInstances: [
        {
          InstanceID: "11111111-1111-1111-1111-111111111111",
          FriendlyName: "Lunateek",
          AppState: 20,
          CPU: 4,
          MemoryMB: 1024,
          MemoryMaxMB: 2048,
          CurrentPlayers: 1,
          MaxPlayers: 4,
          Module: "GenericModule",
        },
        {
          InstanceID: "22222222-2222-2222-2222-222222222222",
          FriendlyName: "Valheim",
          AppState: 0,
          Running: true,
          CPU: 1,
          MemoryMB: 512,
          MemoryMaxMB: 1024,
          CurrentPlayers: 0,
          MaxPlayers: 10,
          Module: "GenericModule",
        },
      ],
    },
  };
}

describe("widgets/amp/proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache._reset();
  });

  it("returns normalized summary payload and caches SESSIONID", async () => {
    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "apiuser",
      password: "secret",
    });

    httpProxy
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify({ SESSIONID: "sess-1" })), {}])
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify(ampInstancesPayload())), {}]);

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.mode).toBe("summary");
    expect(res.body.health).toBe("ok");
    expect(res.body.summary).toEqual(
      expect.objectContaining({
        totalInstances: 2,
        runningInstances: 1,
        ampCpuPercent: 5,
        ampRamUsedDisplay: "1.5 GiB",
      }),
    );

    expect(httpProxy).toHaveBeenCalledTimes(2);
    expect(httpProxy.mock.calls[1][1].headers.Authorization).toBe("Bearer sess-1");
    expect(cache.put).toHaveBeenCalledWith("ampProxyHandler__session.g.svc.0", "sess-1");
  });

  it("reuses cached SESSIONID when available", async () => {
    cache.put("ampProxyHandler__session.g.svc.0", "cached-session");

    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "apiuser",
      password: "secret",
    });

    httpProxy.mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify(ampInstancesPayload())), {}]);

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(httpProxy).toHaveBeenCalledTimes(1);
    expect(httpProxy.mock.calls[0][1].headers.Authorization).toBe("Bearer cached-session");
    expect(res.statusCode).toBe(200);
  });

  it("re-logins once when session is invalid", async () => {
    cache.put("ampProxyHandler__session.g.svc.0", "expired-session");

    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "apiuser",
      password: "secret",
    });

    httpProxy
      .mockResolvedValueOnce([401, "application/json", Buffer.from(JSON.stringify({ Message: "Invalid session" })), {}])
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify({ SESSIONID: "fresh-session" })), {}])
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify(ampInstancesPayload())), {}]);

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(httpProxy).toHaveBeenCalledTimes(3);
    expect(httpProxy.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh-session");
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for missing required AMP config", async () => {
    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "apiuser",
    });

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toContain("password");
  });

  it("returns 404 when instance selector is not found", async () => {
    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "apiuser",
      password: "secret",
      instance: "does-not-exist",
    });

    httpProxy
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify({ SESSIONID: "sess-1" })), {}])
      .mockResolvedValueOnce([200, "application/json", Buffer.from(JSON.stringify(ampInstancesPayload())), {}]);

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({
      error: "instance_not_found",
      id: "does-not-exist",
    });
  });

  it("returns amp_unreachable with redacted error details", async () => {
    getServiceWidget.mockResolvedValue({
      type: "amp",
      url: "http://amp",
      username: "my-user",
      password: "my-pass",
    });

    httpProxy.mockResolvedValueOnce([
      200,
      "application/json",
      Buffer.from(JSON.stringify({ Message: "bad my-user and my-pass credentials" })),
      {},
    ]);

    const req = { query: { group: "g", service: "svc", index: "0", endpoint: "stats" } };
    const res = createMockRes();

    await ampProxyHandler(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error.health).toBe("amp_unreachable");
    expect(res.body.error.message).not.toContain("my-user");
    expect(res.body.error.message).not.toContain("my-pass");
  });
});
