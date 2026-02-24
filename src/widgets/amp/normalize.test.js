import { describe, expect, it } from "vitest";

import { computeSummary, normalizeInstances, normalizeState, resolveInstanceSelector } from "./normalize";

describe("widgets/amp/normalize", () => {
  it("maps AppState values to Running/Idle/Stopped/Offline", () => {
    expect(normalizeState({ AppState: 20 })).toEqual({ state: "Running", isRunning: true });
    expect(normalizeState({ AppState: 0, Running: true })).toEqual({ state: "Idle", isRunning: false });
    expect(normalizeState({ AppState: 0, Running: false })).toEqual({ state: "Stopped", isRunning: false });
    expect(normalizeState({ AppState: -1 })).toEqual({ state: "Offline", isRunning: false });
  });

  it("normalizes nested AMP payloads, excludes ADS, and de-dupes by instance id", () => {
    const payload = {
      result: {
        AvailableInstances: {
          0: {
            InstanceID: "11111111-1111-1111-1111-111111111111",
            FriendlyName: "Lunateek",
            Module: "GenericModule",
            AppState: 20,
            Metrics: {
              CPUUsage: { Percent: 4 },
              MemoryUsage: { RawValue: 2048, MaxValue: 4096 },
              Players: { RawValue: 1, MaxValue: 10 },
            },
          },
          1: {
            InstanceID: "22222222-2222-2222-2222-222222222222",
            FriendlyName: "Valheim",
            Module: "GenericModule",
            AppState: 0,
            Running: true,
            Metrics: {
              CPUUsage: { Percent: 1 },
              MemoryUsage: { RawValue: 1024, MaxValue: 2048 },
              Players: { RawValue: 0, MaxValue: 10 },
            },
          },
          2: {
            InstanceID: "33333333-3333-3333-3333-333333333333",
            FriendlyName: "ADS Manager",
            Module: "ADS",
            AppState: 20,
          },
          3: {
            InstanceID: "11111111-1111-1111-1111-111111111111",
            FriendlyName: "Lunateek (dup)",
            Module: "GenericModule",
            AppState: 20,
          },
        },
      },
    };

    const instances = normalizeInstances(payload);
    expect(instances).toHaveLength(2);
    expect(instances.map((item) => item.instanceName)).toEqual(["Lunateek", "Valheim"]);
    expect(instances[0]).toEqual(
      expect.objectContaining({
        state: "Running",
        isRunning: true,
        cpuPercent: 4,
        ramUsedMiB: 2048,
        ramTotalMiB: 4096,
        playersOnline: 1,
        playersMax: 10,
      }),
    );
    expect(instances[1]).toEqual(
      expect.objectContaining({
        state: "Idle",
        isRunning: false,
      }),
    );
  });

  it("computes AMP summary from normalized instances", () => {
    const summary = computeSummary([
      {
        isRunning: true,
        cpuPercent: 4,
        ramUsedMiB: 2048,
        ramTotalMiB: 4096,
      },
      {
        isRunning: false,
        cpuPercent: 1,
        ramUsedMiB: 1024,
        ramTotalMiB: 2048,
      },
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        totalInstances: 2,
        runningInstances: 1,
        ampCpuPercent: 5,
        ampRamPercent: 50,
        ampRamUsedMiB: 3072,
        ampRamTotalMiB: 6144,
        ampRamUsedDisplay: "3 GiB",
      }),
    );
  });

  it("resolves selectors by exact match and unique short-id prefix", () => {
    const instances = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        instanceName: "Lunateek",
        displayName: "Lunateek",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        instanceName: "ValheimLuna",
        displayName: "Valheim",
      },
    ];

    expect(resolveInstanceSelector(instances, "Lunateek")).toBe(instances[0]);
    expect(resolveInstanceSelector(instances, "22222222-2222-2222-2222-222222222222")).toBe(instances[1]);
    expect(resolveInstanceSelector(instances, "11111111")).toBe(instances[0]);
  });

  it("returns null for ambiguous short-id prefixes", () => {
    const instances = [
      { id: "aaaa1111-1111-1111-1111-111111111111", instanceName: "A", displayName: "A" },
      { id: "aaaa2222-2222-2222-2222-222222222222", instanceName: "B", displayName: "B" },
    ];

    expect(resolveInstanceSelector(instances, "aaaa")).toBeNull();
  });
});
