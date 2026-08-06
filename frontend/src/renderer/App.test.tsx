import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("оболочка ma-hi-ko", () => {
  it("выбирает модель в композере и открывает файл из панели среды", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByText("Чем помочь?")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Сообщение ma-hi-ko" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Sol" }));
    await user.click(await screen.findByRole("option", { name: /gpt-5.6-luna/ }));
    expect(screen.getByRole("button", { name: "Выбрать модель: GPT-5.6 Luna" })).toBeVisible();

    const navButton = screen.getByRole("button", { name: "Показать боковую панель" });
    expect(navButton).toHaveAttribute("aria-expanded", "false");
    await user.click(navButton);
    expect(screen.getByRole("complementary", { name: "Панель среды" })).toBeVisible();
    await user.click(screen.getByRole("textbox", { name: "Сообщение ma-hi-ko" }));
    expect(screen.queryByRole("complementary", { name: "Панель среды" })).not.toBeInTheDocument();
    await user.click(navButton);

    await user.click(screen.getByRole("treeitem", { name: "src" }));
    await user.click(screen.getByRole("treeitem", { name: "renderer" }));
    await user.click(screen.getByRole("treeitem", { name: "App.tsx" }));
    expect(await screen.findByRole("region", { name: "Файл src/renderer/App.tsx" })).toBeVisible();
    expect(screen.queryByRole("complementary", { name: "Панель среды" })).not.toBeInTheDocument();
    const inspectorButton = screen.getByRole("button", { name: "Показать сведения" });
    if (inspectorButton.getAttribute("aria-expanded") === "false") await user.click(inspectorButton);
    const inspector = screen.getByRole("complementary", { name: "Сведения" });
    expect(within(inspector).getByText("Файл")).toBeVisible();
    expect(within(inspector).getByText("src/renderer/App.tsx")).toBeVisible();
    expect(within(inspector).queryByRole("button", { name: /Настройки/i })).not.toBeInTheDocument();

    expect(inspectorButton).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("complementary", { name: "Сведения" })).not.toBeInTheDocument();
    expect(inspectorButton).toHaveAttribute("aria-expanded", "false");
    await user.click(inspectorButton);
    expect(screen.getByRole("complementary", { name: "Сведения" })).toBeVisible();
  });

  it("открывает русскоязычные TUI-настройки OMP", async () => {
    const user = userEvent.setup();
    render(<App />);

    const navButton = await screen.findByRole("button", { name: "Показать боковую панель" });
    if (navButton.getAttribute("aria-expanded") === "false") await user.click(navButton);
    await user.click(await screen.findByRole("button", { name: /Настройки OMP/ }));
    expect(screen.getByRole("dialog", { name: "Настройки OMP" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Вид" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Тёмная тема")).toBeVisible();
  });

  it("маршрутизирует поддерживаемые slash-команды в реальные экраны и состояния", async () => {
    const user = userEvent.setup();
    render(<App />);
    let input = await screen.findByRole("textbox", { name: "Сообщение ma-hi-ko" });

    await user.type(input, "/plugins{Enter}");
    expect(await screen.findByText("Установленные + каталог")).toBeVisible();
    await user.keyboard("{Escape}");

    input = await screen.findByRole("textbox", { name: "Сообщение ma-hi-ko" });
    await user.type(input, "/compact{Enter}");
    expect(screen.getByRole("button", { name: "Показать полный контекст" })).toHaveAttribute("aria-pressed", "true");

    input = screen.getByRole("textbox", { name: "Сообщение ma-hi-ko" });
    await user.type(input, "/context{Enter}");
    expect(await screen.findByRole("complementary", { name: "Сведения" })).toBeVisible();
  });
});
