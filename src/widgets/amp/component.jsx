import Block from "components/services/widget/block";
import Container from "components/services/widget/container";
import { useTranslation } from "next-i18next";

import useWidgetAPI from "utils/proxy/use-widget-api";

const DEFAULT_REFRESH_INTERVAL = 60000;
const MAX_ALLOWED_FIELDS = 4;

function normalizeRefreshInterval(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(parsed) && parsed >= 1000) {
    return parsed;
  }
  return DEFAULT_REFRESH_INTERVAL;
}

function asNumberOrDash(t, value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return t("common.number", { value });
}

function asPercentOrDash(t, value) {
  if (value === null || value === undefined) {
    return "-";
  }
  return t("common.percent", { value, maximumFractionDigits: 1 });
}

export default function Component({ service }) {
  const { t } = useTranslation();
  const { widget } = service;

  const hasInstanceSelector = Boolean(String(widget.instance || "").trim());
  if (!widget.fields?.length) {
    widget.fields = hasInstanceSelector ? ["state", "cpu", "players", "maxPlayers"] : ["running", "total", "cpu", "ram"];
  }
  if (widget.fields?.length > MAX_ALLOWED_FIELDS) {
    widget.fields = widget.fields.slice(0, MAX_ALLOWED_FIELDS);
  }

  const { data, error } = useWidgetAPI(widget, "stats", {
    refreshInterval: normalizeRefreshInterval(widget.refreshInterval),
  });

  if (error) {
    return <Container service={service} error={error} />;
  }

  if (!data) {
    if (hasInstanceSelector) {
      return (
        <Container service={service}>
          <Block label="amp.state" />
          <Block label="amp.cpu" />
          <Block label="amp.players" />
          <Block label="amp.maxPlayers" />
        </Container>
      );
    }

    return (
      <Container service={service}>
        <Block label="amp.running" />
        <Block label="amp.total" />
        <Block label="amp.cpu" />
        <Block label="amp.ram" />
      </Container>
    );
  }

  if (data.mode === "instance") {
    const instance = data.instance || {};

    const playersValue =
      instance.playersOnlineDisplay ??
      (instance.playersOnline === null || instance.playersOnline === undefined
        ? "-"
        : t("common.number", { value: instance.playersOnline }));
    const maxPlayersValue =
      instance.playersMaxDisplay ??
      (instance.playersMax === null || instance.playersMax === undefined ? "-" : t("common.number", { value: instance.playersMax }));

    return (
      <Container service={service}>
        <Block label="amp.state" value={instance.state || "-"} />
        <Block label="amp.cpu" value={asPercentOrDash(t, instance.cpuPercent)} />
        <Block label="amp.players" value={playersValue} />
        <Block label="amp.maxPlayers" value={maxPlayersValue} />
      </Container>
    );
  }

  const summary = data.summary || {};
  const ramValue =
    summary.ampRamUsedDisplay ??
    (summary.ampRamPercent === null || summary.ampRamPercent === undefined ? "-" : asPercentOrDash(t, summary.ampRamPercent));

  return (
    <Container service={service}>
      <Block label="amp.running" value={asNumberOrDash(t, summary.runningInstances)} />
      <Block label="amp.total" value={asNumberOrDash(t, summary.totalInstances)} />
      <Block label="amp.cpu" value={asPercentOrDash(t, summary.ampCpuPercent)} />
      <Block label="amp.ram" value={ramValue} />
    </Container>
  );
}
