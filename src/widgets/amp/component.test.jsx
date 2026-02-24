// @vitest-environment jsdom

import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "test-utils/render-with-providers";
import { expectBlockValue } from "test-utils/widget-assertions";

const { useWidgetAPI } = vi.hoisted(() => ({ useWidgetAPI: vi.fn() }));
vi.mock("utils/proxy/use-widget-api", () => ({ default: useWidgetAPI }));

import Component from "./component";

describe("widgets/amp/component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders summary placeholders while loading", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });

    const { container } = renderWithProviders(<Component service={{ widget: { type: "amp" } }} />, {
      settings: { hideErrors: false },
    });

    expect(container.querySelectorAll(".service-block")).toHaveLength(4);
    expect(screen.getByText("amp.running")).toBeInTheDocument();
    expect(screen.getByText("amp.total")).toBeInTheDocument();
    expect(screen.getByText("amp.cpu")).toBeInTheDocument();
    expect(screen.getByText("amp.ram")).toBeInTheDocument();
  });

  it("renders instance placeholders while loading", () => {
    useWidgetAPI.mockReturnValue({ data: undefined, error: undefined });

    const { container } = renderWithProviders(
      <Component service={{ widget: { type: "amp", instance: "11111111" } }} />,
      {
        settings: { hideErrors: false },
      },
    );

    expect(container.querySelectorAll(".service-block")).toHaveLength(4);
    expect(screen.getByText("amp.state")).toBeInTheDocument();
    expect(screen.getByText("amp.cpu")).toBeInTheDocument();
    expect(screen.getByText("amp.players")).toBeInTheDocument();
    expect(screen.getByText("amp.maxPlayers")).toBeInTheDocument();
  });

  it("renders summary values when loaded", () => {
    useWidgetAPI.mockReturnValue({
      data: {
        mode: "summary",
        summary: {
          runningInstances: 1,
          totalInstances: 3,
          ampCpuPercent: 5,
          ampRamUsedDisplay: "2.8 GiB",
        },
      },
      error: undefined,
    });

    const { container } = renderWithProviders(<Component service={{ widget: { type: "amp" } }} />, {
      settings: { hideErrors: false },
    });

    expectBlockValue(container, "amp.running", 1);
    expectBlockValue(container, "amp.total", 3);
    expectBlockValue(container, "amp.cpu", 5);
    expectBlockValue(container, "amp.ram", "2.8 GiB");
  });

  it("renders instance values when loaded", () => {
    useWidgetAPI.mockReturnValue({
      data: {
        mode: "instance",
        instance: {
          state: "Running",
          cpuPercent: 4,
          playersOnlineDisplay: "0",
          playersMaxDisplay: "4",
        },
      },
      error: undefined,
    });

    const { container } = renderWithProviders(
      <Component service={{ widget: { type: "amp", instance: "11111111" } }} />,
      {
        settings: { hideErrors: false },
      },
    );

    expectBlockValue(container, "amp.state", "Running");
    expectBlockValue(container, "amp.cpu", 4);
    expectBlockValue(container, "amp.players", 0);
    expectBlockValue(container, "amp.maxPlayers", 4);
  });

  it("renders container error when API call fails", () => {
    useWidgetAPI.mockReturnValue({
      data: undefined,
      error: { message: "AMP is unreachable" },
    });

    renderWithProviders(<Component service={{ widget: { type: "amp" } }} />, {
      settings: { hideErrors: false },
    });

    expect(screen.getByText("AMP is unreachable")).toBeInTheDocument();
  });
});
