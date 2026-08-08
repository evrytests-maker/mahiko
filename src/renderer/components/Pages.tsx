import type { JSX, ReactNode } from "react";
import type { AppSettings, ProjectFileEntry } from "../../shared/contracts";

export function ProjectsPage({ settings, files, onChoose, onOpenFile }: { settings: AppSettings | null; files: ProjectFileEntry[]; onChoose(): void; onOpenFile(path: string): void }): JSX.Element {
  const path = settings?.projectPath ?? "";
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? "Проект не выбран";
  const fileCount = files.filter((entry) => entry.kind === "file").length;
  return (
    <PageFrame title="Проект">
      <div className="projects-demo-toolbar">
        <div>
          <span className="accent">▣</span>
          <strong>{name}</strong>
          <small>{path || "Выберите рабочую папку"}</small>
        </div>
        <button type="button" className="text-action" aria-label="Сменить папку" onClick={onChoose}>{path ? "Сменить папку…" : "Открыть папку…"}</button>
      </div>
      <section className="project-live-browser" aria-label="Состояние проекта">
        <header>
          <div><strong>Текущий корень</strong><span>{path || "—"}</span></div>
          <em>наблюдаемое состояние</em>
        </header>
        <div className="project-live-summary">
          <strong>{files.length} {files.length === 1 ? "элемент" : "элемента"} · {fileCount} {fileCount === 1 ? "файл" : "файла"}</strong>
          <span>Ветка и история чатов не показываются: OMP RPC 17.2.9 не предоставляет эти данные.</span>
        </div>
        <nav className="project-live-files" aria-label="Файлы выбранного проекта">
          {files.map((entry) => entry.kind === "file"
            ? <button type="button" key={entry.path} aria-label={`Открыть ${entry.path}`} style={{ paddingLeft: 9 + entry.depth * 14 }} onClick={() => onOpenFile(entry.path)}><span>◇</span><span>{entry.path}</span></button>
            : <div key={entry.path} className="project-live-directory" style={{ paddingLeft: 9 + entry.depth * 14 }}><span>▱</span><span>{entry.path}</span></div>)}
          {!files.length ? <p className="dim">{path ? "В папке нет доступных текстовых файлов." : "Сначала выберите рабочую папку."}</p> : null}
        </nav>
      </section>
    </PageFrame>
  );
}

export function PageFrame({ title, help, children, className = "" }: { title: string; help?: string; children: ReactNode; className?: string }): JSX.Element {
  return (
    <section className={`terminal-frame page-frame ${className}`}>
      <h1 className="frame-title">{title}</h1>
      <div className="page-content">{children}</div>
      {help ? <div className="overlay-help">{help}</div> : null}
    </section>
  );
}
