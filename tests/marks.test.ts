import { describe, it, expect } from "vitest";
import {
  renderStatusIcon,
  createChevronElement,
  createProjectLink,
  createTeamRow,
  compareLastEvent,
  injectFinishedProjects,
  type MarkedProject,
} from "../src/features/profile/cards/marks";

describe("renderStatusIcon", () => {
  it("sets green class and renders check SVG for validated", () => {
    const c = document.createElement("div");
    renderStatusIcon(c, true);
    expect(c.className).toBe("text-green-500");
    expect(c.querySelector("svg")).toBeTruthy();
  });

  it("sets red class and renders X SVG for failed", () => {
    const c = document.createElement("div");
    renderStatusIcon(c, false);
    expect(c.className).toBe("text-red-500");
    expect(c.querySelector("svg")).toBeTruthy();
  });
});

describe("createChevronElement", () => {
  it("returns an SVG element with correct attributes", () => {
    const el = createChevronElement();
    expect(el.tagName.toLowerCase()).toBe("svg");
    expect(el.getAttribute("width")).toBe("18");
    expect(el.getAttribute("height")).toBe("18");
    expect(el.getAttribute("viewBox")).toBe("0 0 640 640");
    expect(el.classList.contains("lucide-chevron-down")).toBe(true);
  });

  it("contains a path child", () => {
    const el = createChevronElement();
    const path = el.querySelector("path");
    expect(path).toBeTruthy();
  });
});

describe("createProjectLink", () => {
  const mockProject = {
    projects_user_id: 12345,
    project_name: "ft_printf",
    project_slug: "ft_printf",
    final_mark: 100,
    last_event_date: "2024-01-15T10:00:00Z",
    is_validated: true,
    occurrence: 1,
    teams: [
      {
        last_event_date: "",
        final_mark: 100,
        is_validated: true,
        occurrence: 1,
      },
    ],
  };

  it("returns an anchor with correct href and text", () => {
    const link = createProjectLink(mockProject);
    expect(link.tagName).toBe("A");
    expect(link.href).toContain("ft_printf/projects_users/12345");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noreferrer");
    expect(link.textContent).toBe("ft_printf");
  });

  it("includes occurrence number when multiple teams", () => {
    const multi = { ...mockProject, teams: [{}, {}] as any, occurrence: 3 };
    const link = createProjectLink(multi);
    expect(link.textContent).toBe("ft_printf #3");
  });
});

describe("createTeamRow", () => {
  const mockProject = {
    projects_user_id: 1,
    project_name: "ft_printf",
    project_slug: "ft_printf",
    final_mark: 100,
    last_event_date: "2024-01-15",
    is_validated: true,
    occurrence: 1,
    teams: [] as any[],
  };
  const mockTeam = {
    occurrence: 2,
    last_event_date: "2024-01-20T10:00:00Z",
    final_mark: 85,
    is_validated: false,
  };

  it("returns a row with project occurrence label", () => {
    const row = createTeamRow(mockProject, mockTeam);
    expect(row.querySelector("span")?.textContent).toBe("ft_printf #2");
  });

  it("renders X icon for non-validated team", () => {
    const row = createTeamRow(mockProject, mockTeam);
    expect(row.querySelector("svg")).toBeTruthy();
  });
});

describe("marks sort order (PROFILE_MARKS_SORT_ORDER)", () => {
  const project = (name: string, date: string): MarkedProject => ({
    projects_user_id: name.length,
    project_name: name,
    project_slug: name,
    final_mark: 100,
    last_event_date: date,
    is_validated: true,
    occurrence: 0,
    teams: [],
  });
  const marks = [
    project("libft", "2024-01-15T10:00:00Z"),
    project("get_next_line", "2024-03-02T10:00:00Z"),
    project("ft_printf", "2024-02-10T10:00:00Z"),
  ];

  it("compareLastEvent orders both ways", () => {
    const dates = marks.map((m) => m.last_event_date);
    expect([...dates].sort(compareLastEvent("newest_first"))).toEqual([
      "2024-03-02T10:00:00Z",
      "2024-02-10T10:00:00Z",
      "2024-01-15T10:00:00Z",
    ]);
    expect([...dates].sort(compareLastEvent("oldest_first"))).toEqual([
      "2024-01-15T10:00:00Z",
      "2024-02-10T10:00:00Z",
      "2024-03-02T10:00:00Z",
    ]);
  });

  const mountCard = () => {
    const card = document.createElement("div");
    const inner = document.createElement("div");
    inner.className = "flex flex-col w-full h-full";
    card.appendChild(inner);
    document.body.appendChild(card);
    return card;
  };
  const rowNames = () =>
    [...document.querySelectorAll<HTMLElement>("#ft-marks-injected a")].map(
      (a) => a.textContent,
    );

  it("injectFinishedProjects follows the order it is given", () => {
    const card = mountCard();
    injectFinishedProjects(card, marks, "oldest_first");
    expect(rowNames()).toEqual(["libft", "ft_printf", "get_next_line"]);
    injectFinishedProjects(card, marks, "newest_first");
    expect(rowNames()).toEqual(["get_next_line", "ft_printf", "libft"]);
    // the default stays what every user had before the setting worked
    injectFinishedProjects(card, marks);
    expect(rowNames()).toEqual(["get_next_line", "ft_printf", "libft"]);
    card.remove();
  });
});
