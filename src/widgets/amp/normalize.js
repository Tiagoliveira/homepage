function roundOneDecimal(value) {
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = toFiniteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function formatUsedRamDisplay(usedGiB) {
  if (!Number.isFinite(usedGiB)) {
    return null;
  }
  const rounded = roundOneDecimal(usedGiB);
  if (rounded === null) {
    return null;
  }
  return `${rounded} GiB`;
}

function getObjectField(obj, keys) {
  if (!obj || typeof obj !== "object") {
    return null;
  }

  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  return null;
}

function getNumericObjectValues(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return [];
  }

  const numericKeys = Object.keys(obj).filter((key) => /^\d+$/.test(key));
  if (numericKeys.length === 0) {
    return [];
  }

  return numericKeys
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((key) => obj[key]);
}

function hasInstanceIdentifier(obj) {
  return Boolean(
    getObjectField(obj, ["InstanceID", "InstanceId", "instanceId", "instanceID", "ID", "Id", "id"]),
  );
}

function isLikelyInstanceObject(obj) {
  if (!obj || typeof obj !== "object" || !hasInstanceIdentifier(obj)) {
    return false;
  }

  const hasName = Boolean(
    getObjectField(obj, ["FriendlyName", "DisplayName", "InstanceName", "instanceName", "Name", "name"]),
  );
  const hasStateOrModule =
    getObjectField(obj, [
      "Running",
      "running",
      "IsRunning",
      "isRunning",
      "State",
      "state",
      "AppState",
      "appState",
      "Module",
      "module",
    ]) !== null;

  return hasName || hasStateOrModule;
}

export function unwrapPayload(payload) {
  if (payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "result")) {
    return payload.result;
  }
  return payload;
}

export function extractInstancesArray(payload) {
  const candidates = [];

  function collect(node) {
    if (!node) {
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }

    if (typeof node !== "object") {
      return;
    }

    const childArrays = ["AvailableInstances", "availableInstances", "Instances", "instances", "Items", "items"];
    for (const key of childArrays) {
      if (Array.isArray(node[key])) {
        collect(node[key]);
        return;
      }
    }

    for (const key of ["AvailableInstances", "availableInstances", "Instances", "instances"]) {
      const nestedValues = getNumericObjectValues(node[key]);
      if (nestedValues.length > 0) {
        collect(nestedValues);
        return;
      }
    }

    const numericValues = getNumericObjectValues(node);
    if (numericValues.length > 0) {
      collect(numericValues);
      return;
    }

    if (isLikelyInstanceObject(node)) {
      candidates.push(node);
    }
  }

  collect(unwrapPayload(payload));
  return candidates;
}

function mapAppStateCode(rawState, runningFlag) {
  const code = toFiniteNumber(rawState);
  if (code === null) {
    return null;
  }

  const runningNumeric = toFiniteNumber(runningFlag);
  const runningNormalized =
    typeof runningFlag === "boolean"
      ? runningFlag
      : runningNumeric !== null
        ? runningNumeric > 0
        : String(runningFlag || "")
            .trim()
            .toLowerCase() === "true";

  if (code === -1) {
    return { state: "Offline", isRunning: false };
  }
  if (code === 0) {
    return { state: runningNormalized ? "Idle" : "Stopped", isRunning: false };
  }
  if (code === 20) {
    return { state: "Running", isRunning: true };
  }

  return null;
}

export function normalizeState(instance) {
  const rawState = getObjectField(instance, [
    "State",
    "state",
    "InstanceState",
    "CurrentState",
    "AppState",
    "appState",
    "Status",
    "status",
    "DisplayState",
    "displayState",
  ]);
  const runningFlag = getObjectField(instance, ["Running", "running", "IsRunning", "isRunning"]);

  const mapped = mapAppStateCode(rawState, runningFlag);
  if (mapped) {
    return mapped;
  }

  if (typeof rawState === "string" && rawState.trim()) {
    const normalized = rawState.trim();
    return { state: normalized, isRunning: normalized.toLowerCase() === "running" };
  }

  if (typeof runningFlag === "boolean") {
    return { state: runningFlag ? "Running" : "Stopped", isRunning: runningFlag };
  }

  if (typeof runningFlag === "number") {
    return { state: runningFlag > 0 ? "Running" : "Stopped", isRunning: runningFlag > 0 };
  }

  return { state: "Unknown", isRunning: false };
}

function extractMetricPercent(metric) {
  if (!metric || typeof metric !== "object") {
    return null;
  }

  const percent = toFiniteNumber(getObjectField(metric, ["Percent", "percent"]));
  if (percent !== null) {
    return percent;
  }

  const rawValue = toFiniteNumber(getObjectField(metric, ["RawValue", "rawValue", "Value", "value"]));
  const maxValue = toFiniteNumber(getObjectField(metric, ["MaxValue", "maxValue"]));
  if (rawValue !== null && maxValue !== null && maxValue > 0) {
    return (rawValue / maxValue) * 100;
  }

  return rawValue;
}

function extractInstanceCpuPercent(instance) {
  const metrics = getObjectField(instance, ["Metrics", "metrics"]);
  if (metrics && typeof metrics === "object" && !Array.isArray(metrics)) {
    for (const [key, metric] of Object.entries(metrics)) {
      const normalizedName = key.toLowerCase().replace(/[^a-z]/g, "");
      if (normalizedName.includes("cpu")) {
        const value = extractMetricPercent(metric);
        if (value !== null) {
          return value;
        }
      }
    }
  }

  return toFiniteNumber(
    getObjectField(instance, ["CPU", "cpu", "CPUUsage", "cpuUsage", "CurrentCPUUsage", "currentCpuUsage"]),
  );
}

function normalizeMetricKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isLikelyPlayerMetric(metricName) {
  if (!metricName) {
    return false;
  }

  const includeHints = ["player", "players", "user", "users", "slot", "slots", "client", "clients"];
  const excludeHints = ["cpu", "ram", "mem", "memory", "disk", "io", "network", "net", "ping", "latency"];

  const hasIncludeHint = includeHints.some((hint) => metricName.includes(hint));
  return hasIncludeHint && !excludeHints.some((hint) => metricName.includes(hint));
}

function isLikelyMemoryMetric(metricName) {
  if (!metricName) {
    return false;
  }

  const includeHints = ["memory", "ram", "mem"];
  const excludeHints = ["player", "players", "user", "users", "slot", "slots", "client", "clients", "disk", "network"];

  const hasIncludeHint = includeHints.some((hint) => metricName.includes(hint));
  return hasIncludeHint && !excludeHints.some((hint) => metricName.includes(hint));
}

function extractPlayersFromMetrics(instance) {
  const metrics = getObjectField(instance, ["Metrics", "metrics"]);
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return { playersOnline: null, playersMax: null };
  }

  let bestCandidate = null;

  for (const [key, metric] of Object.entries(metrics)) {
    const normalizedName = normalizeMetricKey(key);
    if (!isLikelyPlayerMetric(normalizedName)) {
      continue;
    }

    const current = firstFiniteNumber(
      getObjectField(metric, ["RawValue", "rawValue", "Value", "value", "CurrentValue", "currentValue"]),
      getObjectField(metric, ["Current", "current", "Now", "now"]),
    );
    const max = firstFiniteNumber(
      getObjectField(metric, ["MaxValue", "maxValue", "Maximum", "maximum", "Limit", "limit", "Cap", "cap"]),
      getObjectField(metric, ["MaximumValue", "maximumValue", "UpperBound", "upperBound"]),
    );

    if (current === null && max === null) {
      continue;
    }

    const score =
      (normalizedName.includes("player") ? 6 : 0) +
      (normalizedName.includes("user") ? 4 : 0) +
      (normalizedName.includes("slot") ? 2 : 0) +
      (normalizedName.includes("client") ? 1 : 0);

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { score, current, max };
    }
  }

  if (!bestCandidate) {
    return { playersOnline: null, playersMax: null };
  }

  return {
    playersOnline: bestCandidate.current,
    playersMax: bestCandidate.max,
  };
}

function extractMemoryFromMetrics(instance) {
  const metrics = getObjectField(instance, ["Metrics", "metrics"]);
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return { ramPercent: null, ramUsedMiB: null, ramTotalMiB: null };
  }

  let bestCandidate = null;

  for (const [key, metric] of Object.entries(metrics)) {
    const normalizedName = normalizeMetricKey(key);
    if (!isLikelyMemoryMetric(normalizedName)) {
      continue;
    }

    const usedMiB = firstFiniteNumber(
      getObjectField(metric, ["RawValue", "rawValue", "Value", "value", "CurrentValue", "currentValue"]),
      getObjectField(metric, ["Current", "current", "Now", "now"]),
    );
    const totalMiB = firstFiniteNumber(
      getObjectField(metric, ["MaxValue", "maxValue", "Maximum", "maximum", "Limit", "limit", "Cap", "cap"]),
      getObjectField(metric, ["MaximumValue", "maximumValue", "UpperBound", "upperBound"]),
    );
    const percent = extractMetricPercent(metric);

    if (usedMiB === null && totalMiB === null && percent === null) {
      continue;
    }

    const score =
      (normalizedName.includes("memoryusage") ? 6 : 0) +
      (normalizedName.includes("ramusage") ? 5 : 0) +
      (normalizedName.includes("memory") ? 4 : 0) +
      (normalizedName.includes("ram") ? 3 : 0) +
      (normalizedName.includes("mem") ? 2 : 0);

    if (!bestCandidate || score > bestCandidate.score) {
      bestCandidate = { score, percent, usedMiB, totalMiB };
    }
  }

  if (!bestCandidate) {
    return { ramPercent: null, ramUsedMiB: null, ramTotalMiB: null };
  }

  return {
    ramPercent: bestCandidate.percent,
    ramUsedMiB: bestCandidate.usedMiB,
    ramTotalMiB: bestCandidate.totalMiB,
  };
}

function normalizeOneInstance(instance, index) {
  const idValue = getObjectField(instance, ["InstanceID", "InstanceId", "instanceId", "instanceID", "ID", "Id", "id"]);
  const nameValue = getObjectField(instance, [
    "FriendlyName",
    "DisplayName",
    "InstanceName",
    "instanceName",
    "Name",
    "name",
  ]);
  const moduleValue = getObjectField(instance, ["Module", "ModuleName", "TargetApplication", "ApplicationName", "module"]);

  const playersOnline = getObjectField(instance, [
    "CurrentPlayers",
    "PlayersCurrent",
    "PlayersOnline",
    "OnlinePlayers",
    "CurrentUsers",
    "CurrentClients",
    "ConnectedPlayers",
    "NumPlayers",
    "Players",
    "playersOnline",
  ]);
  const playersMax = getObjectField(instance, [
    "MaxPlayers",
    "PlayersMax",
    "MaximumPlayers",
    "PlayerLimit",
    "PlayersLimit",
    "MaxUsers",
    "UserLimit",
    "MaxClients",
    "ClientLimit",
    "MaxSlots",
    "SlotLimit",
    "playersMax",
  ]);

  const metricPlayers = extractPlayersFromMetrics(instance);
  const metricMemory = extractMemoryFromMetrics(instance);
  const normalizedState = normalizeState(instance);
  const cpuPercent = extractInstanceCpuPercent(instance);
  const playersOnlineValue = firstFiniteNumber(playersOnline, metricPlayers.playersOnline);
  const playersMaxValue = firstFiniteNumber(playersMax, metricPlayers.playersMax);
  const ramPercent = firstFiniteNumber(
    getObjectField(instance, ["MemoryPercent", "memoryPercent", "RAMPercent", "ramPercent"]),
    metricMemory.ramPercent,
  );
  const ramUsedMiB = firstFiniteNumber(
    getObjectField(instance, ["MemoryMB", "memoryMB", "MemoryMiB", "memoryMiB", "RAMMB", "ramMB"]),
    metricMemory.ramUsedMiB,
  );
  const ramTotalMiB = firstFiniteNumber(
    getObjectField(instance, ["MemoryMaxMB", "memoryMaxMB", "MemoryLimitMB", "memoryLimitMB", "RAMMaxMB", "ramMaxMB"]),
    metricMemory.ramTotalMiB,
  );
  const ramUsedGiB = ramUsedMiB === null ? null : ramUsedMiB / 1024;
  const ramTotalGiB = ramTotalMiB === null ? null : ramTotalMiB / 1024;

  return {
    id: idValue ? String(idValue) : `instance-${index + 1}`,
    instanceName: nameValue ? String(nameValue) : `Instance ${index + 1}`,
    displayName: nameValue ? String(nameValue) : `Instance ${index + 1}`,
    module: moduleValue ? String(moduleValue) : null,
    state: normalizedState.state,
    isRunning: normalizedState.isRunning,
    cpuPercent: roundOneDecimal(cpuPercent),
    ramPercent: roundOneDecimal(ramPercent),
    ramUsedMiB: roundOneDecimal(ramUsedMiB),
    ramTotalMiB: roundOneDecimal(ramTotalMiB),
    ramUsedGiB: roundOneDecimal(ramUsedGiB),
    ramTotalGiB: roundOneDecimal(ramTotalGiB),
    ramUsedDisplay: formatUsedRamDisplay(ramUsedGiB),
    playersOnline: playersOnlineValue,
    playersMax: playersMaxValue,
    playersOnlineDisplay: playersOnlineValue === null ? "-" : String(playersOnlineValue),
    playersMaxDisplay: playersMaxValue === null ? "-" : String(playersMaxValue),
  };
}

function shouldExcludeFromSummary(instance, normalized) {
  const moduleName = (normalized.module || getObjectField(instance, ["Module", "module"]) || "")
    .toString()
    .trim()
    .toLowerCase();

  if (moduleName === "ads") {
    return true;
  }

  const instanceName = (normalized.instanceName || "").toLowerCase();
  const managementMode = toFiniteNumber(getObjectField(instance, ["ManagementMode", "managementMode"]));

  return managementMode === 0 && instanceName.startsWith("ads");
}

export function normalizeInstances(payload) {
  const items = extractInstancesArray(payload);
  const normalizedItems = [];
  const seenIds = new Set();

  items.forEach((instance, index) => {
    const normalized = normalizeOneInstance(instance, index);

    if (shouldExcludeFromSummary(instance, normalized)) {
      return;
    }

    if (seenIds.has(normalized.id)) {
      return;
    }

    seenIds.add(normalized.id);
    normalizedItems.push(normalized);
  });

  return normalizedItems;
}

export function computeSummary(instances) {
  const totalInstances = instances.length;
  const runningInstances = instances.filter((instance) => instance.isRunning).length;
  const ampCpuValues = instances.map((instance) => toFiniteNumber(instance.cpuPercent)).filter((value) => value !== null);
  const ampCpuPercent =
    ampCpuValues.length > 0 ? roundOneDecimal(ampCpuValues.reduce((sum, value) => sum + value, 0)) : null;

  const ampRamUsedMiBValues = instances
    .map((instance) => toFiniteNumber(instance.ramUsedMiB))
    .filter((value) => value !== null);
  const ampRamTotalMiBValues = instances
    .map((instance) => toFiniteNumber(instance.ramTotalMiB))
    .filter((value) => value !== null);

  const ampRamUsedMiB = ampRamUsedMiBValues.length > 0 ? ampRamUsedMiBValues.reduce((sum, value) => sum + value, 0) : null;
  const ampRamTotalMiB =
    ampRamTotalMiBValues.length > 0 ? ampRamTotalMiBValues.reduce((sum, value) => sum + value, 0) : null;
  const ampRamUsedGiB = ampRamUsedMiB === null ? null : roundOneDecimal(ampRamUsedMiB / 1024);
  const ampRamTotalGiB = ampRamTotalMiB === null ? null : roundOneDecimal(ampRamTotalMiB / 1024);
  const ampRamPercent =
    ampRamUsedMiB !== null && ampRamTotalMiB !== null && ampRamTotalMiB > 0
      ? roundOneDecimal((ampRamUsedMiB / ampRamTotalMiB) * 100)
      : null;

  return {
    totalInstances,
    runningInstances,
    ampCpuPercent,
    ampRamPercent,
    ampRamUsedMiB: roundOneDecimal(ampRamUsedMiB),
    ampRamTotalMiB: roundOneDecimal(ampRamTotalMiB),
    ampRamUsedGiB,
    ampRamTotalGiB,
    ampRamUsedDisplay: formatUsedRamDisplay(ampRamUsedGiB),
  };
}

function normalizeSelector(value) {
  return String(value || "").trim().toLowerCase();
}

export function resolveInstanceSelector(instances, rawSelector) {
  const selector = normalizeSelector(rawSelector);
  if (!selector) {
    return null;
  }

  const safeItems = Array.isArray(instances) ? instances : [];

  const exactMatch = safeItems.find((item) => {
    const id = normalizeSelector(item?.id);
    const instanceName = normalizeSelector(item?.instanceName);
    const displayName = normalizeSelector(item?.displayName);
    return id === selector || instanceName === selector || displayName === selector;
  });

  if (exactMatch) {
    return exactMatch;
  }

  const prefixMatches = safeItems.filter((item) => normalizeSelector(item?.id).startsWith(selector));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  return null;
}
