import cache from "memory-cache";

import getServiceWidget from "utils/config/service-helpers";
import createLogger from "utils/logger";
import { httpProxy } from "utils/proxy/http";

import { computeSummary, normalizeInstances, resolveInstanceSelector } from "./normalize";

const proxyName = "ampProxyHandler";
const sessionCacheKey = `${proxyName}__session`;
const logger = createLogger(proxyName);

const DEFAULT_LOGIN_PATH = "/API/Core/Login";
const DEFAULT_INSTANCES_PATH = "/API/ADSModule/GetInstances";
const DEFAULT_REQUEST_TIMEOUT_MS = 10000;

class AmpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AmpError";
    this.code = code;
  }
}

function normalizeBaseUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}

function pathToUrl(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  return new URL(path.replace(/^\/+/, ""), `${baseUrl}/`).toString();
}

function toPositiveInt(value, fallback, min = 1000) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed) && parsed >= min) {
    return parsed;
  }
  return fallback;
}

function parseProxyData(data) {
  if (Buffer.isBuffer(data)) {
    const text = Buffer.from(data).toString("utf8");
    try {
      return JSON.parse(text);
    } catch (_error) {
      return text;
    }
  }
  return data;
}

function getPayloadHint(payload) {
  if (payload === null || payload === undefined) {
    return "empty payload";
  }

  if (typeof payload === "string") {
    const text = payload.trim();
    return text ? `text payload: ${text.slice(0, 120)}` : "empty text payload";
  }

  if (typeof payload === "object") {
    const message =
      typeof payload.Message === "string"
        ? payload.Message.trim()
        : typeof payload.message === "string"
          ? payload.message.trim()
          : "";
    const title =
      typeof payload.Title === "string"
        ? payload.Title.trim()
        : typeof payload.title === "string"
          ? payload.title.trim()
          : "";

    if (title || message) {
      return `error payload: ${[title, message].filter(Boolean).join(" - ").slice(0, 180)}`;
    }

    const keys = Object.keys(payload);
    return keys.length > 0 ? `object keys: ${keys.join(",")}` : "empty object payload";
  }

  return `payload type: ${typeof payload}`;
}

function sanitizeMessage(message, widget) {
  let output = String(message || "");
  if (widget?.username) {
    output = output.split(String(widget.username)).join("[REDACTED_USER]");
  }
  if (widget?.password) {
    output = output.split(String(widget.password)).join("[REDACTED_PASS]");
  }
  return output;
}

function extractSessionIdFromHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return null;
  }

  const setCookie = headers["set-cookie"] || headers["Set-Cookie"];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  for (const cookie of cookies) {
    const match = String(cookie).match(/SESSIONID=([^;]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

function extractSessionId(payload, responseHeaders) {
  const candidateKeys = ["SESSIONID", "sessionID", "sessionId", "sessionid", "SessionID"];
  const candidates = [payload, payload?.result, payload?.data].filter(Boolean);

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }

    if (candidate && typeof candidate === "object") {
      for (const key of candidateKeys) {
        const value = candidate[key];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }

      if (typeof candidate.raw === "string" && candidate.raw.trim()) {
        return candidate.raw.trim();
      }
    }
  }

  return extractSessionIdFromHeaders(responseHeaders);
}

function looksLikeAuthFailure(statusCode, payload) {
  if (statusCode === 401 || statusCode === 403) {
    return true;
  }

  const normalized = JSON.stringify(payload || {}).toLowerCase();
  if (!normalized) {
    return false;
  }

  const authHints = [
    "not authenticated",
    "not authorized",
    "unauthorized",
    "invalid session",
    "session expired",
    "login required",
    "forbidden",
  ];
  const failedHints = ['"success":false', '"status":false', '"result":false'];

  return authHints.some((hint) => normalized.includes(hint)) ||
    (failedHints.some((hint) => normalized.includes(hint)) && normalized.includes("session"));
}

function getServiceCacheKey(group, service, index) {
  return `${sessionCacheKey}.${group}.${service}.${index ?? 0}`;
}

async function postJson(url, body, extraHeaders, timeoutMs) {
  const [status, _contentType, data, responseHeaders] = await httpProxy(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.cubecoders-ampapi, application/json",
      "Content-Type": "application/json",
      "User-Agent": "homepage/amp-widget",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    timeout: timeoutMs,
  });

  return {
    status,
    payload: parseProxyData(data),
    responseHeaders,
  };
}

async function login(widget, loginUrl, timeoutMs, cacheKey) {
  const { status, payload, responseHeaders } = await postJson(
    loginUrl,
    {
      username: widget.username,
      password: widget.password,
      token: "",
      rememberMe: false,
    },
    {},
    timeoutMs,
  );

  if (status === 401 || status === 403) {
    throw new AmpError("auth_error", `AMP login rejected with HTTP ${status}`);
  }

  if (status < 200 || status >= 300) {
    throw new AmpError("amp_unreachable", `AMP login failed with HTTP ${status}`);
  }

  const sessionId = extractSessionId(payload, responseHeaders);
  if (!sessionId) {
    if (looksLikeAuthFailure(status, payload)) {
      throw new AmpError("auth_error", "AMP login failed (no valid session returned)");
    }
    throw new AmpError("amp_unreachable", `AMP login did not return SESSIONID (${getPayloadHint(payload)})`);
  }

  cache.put(cacheKey, sessionId);
  return sessionId;
}

async function fetchInstancesOnce(instancesUrl, sessionId, timeoutMs) {
  const { status, payload } = await postJson(
    instancesUrl,
    {},
    {
      Authorization: `Bearer ${sessionId}`,
    },
    timeoutMs,
  );

  if (looksLikeAuthFailure(status, payload)) {
    throw new AmpError("auth_error", "AMP session is invalid or expired");
  }

  if (status < 200 || status >= 300) {
    throw new AmpError("amp_unreachable", `AMP instance fetch failed with HTTP ${status}`);
  }

  return payload;
}

async function fetchInstancesWithRelogin(widget, req, cacheKey) {
  const baseUrl = normalizeBaseUrl(widget.url);
  const loginPath = String(widget.loginPath || DEFAULT_LOGIN_PATH).trim();
  const instancesPath = String(widget.instancesPath || DEFAULT_INSTANCES_PATH).trim();
  const requestTimeoutMs = toPositiveInt(widget.requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS);

  const loginUrl = pathToUrl(baseUrl, loginPath);
  const instancesUrl = pathToUrl(baseUrl, instancesPath);

  let sessionId = cache.get(cacheKey);
  if (!sessionId) {
    sessionId = await login(widget, loginUrl, requestTimeoutMs, cacheKey);
  }

  try {
    return await fetchInstancesOnce(instancesUrl, sessionId, requestTimeoutMs);
  } catch (error) {
    if (!(error instanceof AmpError) || error.code !== "auth_error") {
      throw error;
    }

    cache.del(cacheKey);
    logger.debug("AMP session rejected for %s/%s, retrying login.", req.query.group, req.query.service);

    const refreshedSessionId = await login(widget, loginUrl, requestTimeoutMs, cacheKey);

    try {
      return await fetchInstancesOnce(instancesUrl, refreshedSessionId, requestTimeoutMs);
    } catch (retryError) {
      if (retryError instanceof AmpError && retryError.code === "auth_error") {
        throw new AmpError("auth_error", "AMP authentication failed after re-login attempt");
      }
      throw retryError;
    }
  }
}

function invalidConfigResponse(res, message) {
  return res.status(400).json({ error: { message } });
}

export default async function ampProxyHandler(req, res) {
  const { group, service, index } = req.query;
  const endpoint = String(req.query.endpoint || "");

  if (!group || !service) {
    logger.debug("Invalid or missing service '%s' or group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  if (endpoint !== "stats") {
    return res.status(403).json({ error: "Unsupported service endpoint" });
  }

  const widget = await getServiceWidget(group, service, index);
  if (!widget || widget.type !== "amp") {
    logger.debug("Invalid or missing widget for service '%s' in group '%s'", service, group);
    return res.status(400).json({ error: "Invalid proxy service type" });
  }

  if (!String(widget.url || "").trim()) {
    return invalidConfigResponse(res, "Missing required AMP widget config: url");
  }
  if (!String(widget.username || "").trim()) {
    return invalidConfigResponse(res, "Missing required AMP widget config: username");
  }
  if (!String(widget.password || "").trim()) {
    return invalidConfigResponse(res, "Missing required AMP widget config: password");
  }

  const cacheKey = getServiceCacheKey(group, service, index);

  try {
    const ampPayload = await fetchInstancesWithRelogin(widget, req, cacheKey);
    const instances = normalizeInstances(ampPayload);
    const generatedAt = new Date().toISOString();

    const selector = typeof widget.instance === "string" ? widget.instance.trim() : widget.instance;
    if (selector) {
      const instance = resolveInstanceSelector(instances, selector);
      if (!instance) {
        return res.status(404).json({
          error: "instance_not_found",
          id: selector,
        });
      }

      return res.status(200).json({
        mode: "instance",
        health: "ok",
        generatedAt,
        instance,
      });
    }

    return res.status(200).json({
      mode: "summary",
      health: "ok",
      generatedAt,
      summary: computeSummary(instances),
    });
  } catch (error) {
    const ampError = error instanceof AmpError ? error : new AmpError("amp_unreachable", error.message || String(error));
    const health = ampError.code === "auth_error" ? "auth_error" : "amp_unreachable";
    const status = health === "auth_error" ? 401 : 502;

    return res.status(status).json({
      error: {
        message: sanitizeMessage(ampError.message, widget),
        code: health,
        health,
      },
    });
  }
}
