import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../../shared/contracts";
import { ProjectsPage } from "./Pages";

describe("ProjectsPage", () => {
  it("shows the observed project root and opens real file entries", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    const onOpenFile = vi.fn();
    render(
      <ProjectsPage
        settings={{ ...defaultSettings, projectPath: "/workspace/mahiko" }}
        files={[
          { path: "src", name: "src", kind: "directory", depth: 0 },
          { path: "src/main.ts", name: "main.ts", kind: "file", depth: 1 },
          { path: "README.md", name: "README.md", kind: "file", depth: 0 },
        ]}
        onChoose={onChoose}
        onOpenFile={onOpenFile}
      />,
    );

    expect(screen.getAllByText("/workspace/mahiko").length).toBeGreaterThan(0);
    expect(screen.getByText("3 элемента · 2 файла")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Открыть README.md" }));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
    await user.click(screen.getByRole("button", { name: "Сменить папку" }));
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
