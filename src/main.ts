import { invoke } from "@tauri-apps/api/core";
import logoUrl from "./assets/rss.ico";
import "./styles.css";

type Locale = "ru" | "en";

type LaunchTarget = {
  id: string;
  label: string;
  fileName: string;
};

type ToolEntry = {
  id: string;
  title: string;
  hasTargets: boolean;
  requiresChoice: boolean;
  targets: LaunchTarget[];
};

type State = {
  locale: Locale;
  loading: boolean;
  tools: ToolEntry[];
  modalToolId: string | null;
  error: string;
  busyKey: string | null;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

const translations = {
  ru: {
    open: "Открыть",
    loading: "Загрузка...",
    empty: "Нет программ",
    folderOpen: "Открыть папку",
    launchFailed: "Не удалось открыть",
    folderFailed: "Не удалось открыть папку",
    loadFailed: "Не удалось загрузить программы",
    close: "Закрыть",
  },
  en: {
    open: "Open",
    loading: "Loading...",
    empty: "No tools",
    folderOpen: "Open folder",
    launchFailed: "Unable to open",
    folderFailed: "Unable to open folder",
    loadFailed: "Unable to load tools",
    close: "Close",
  },
} satisfies Record<Locale, Record<string, string>>;

const state: State = {
  locale: detectLocale(),
  loading: true,
  tools: [],
  modalToolId: null,
  error: "",
  busyKey: null,
};

const explorerIcon = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.75 6.25a2.25 2.25 0 0 1 2.25-2.25h3.58l1.34 1.58h7.08a2.25 2.25 0 0 1 2.25 2.25v.59h-1.55v-.59a.7.7 0 0 0-.7-.7H10.2L8.86 5.55H6a.7.7 0 0 0-.7.7v11.5c0 .39.31.7.7.7h4.12V20H6a2.25 2.25 0 0 1-2.25-2.25V6.25Zm8.65 5.2h5.85a1.8 1.8 0 0 1 1.8 1.8v4.9a1.8 1.8 0 0 1-1.8 1.8h-3.2l-2.65 2.62V11.45Zm1.55 2.1v5.26l2.44-2.41h2.1v-3.35h-4.54Z"/>
  </svg>
`;

void refreshTools();

window.addEventListener("focus", () => {
  void refreshTools(false);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refreshTools(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.modalToolId) {
    state.modalToolId = null;
    render();
  }
});

app.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const actionTarget = target.closest<HTMLElement>("[data-action]");

  if (!actionTarget) {
    if (target.classList.contains("overlay")) {
      state.modalToolId = null;
      render();
    }
    return;
  }

  const action = actionTarget.dataset.action;
  const toolId = actionTarget.dataset.toolId;
  const targetId = actionTarget.dataset.targetId;

  if (action === "close-modal") {
    state.modalToolId = null;
    render();
    return;
  }

  if (!toolId) {
    return;
  }

  const tool = state.tools.find((item) => item.id === toolId);
  if (!tool) {
    return;
  }

  if (action === "open-folder") {
    void openFolder(tool);
    return;
  }

  if (action === "open-tool") {
    if (tool.requiresChoice) {
      state.modalToolId = tool.id;
      render();
      return;
    }

    const launchTarget = tool.targets[0];
    if (launchTarget) {
      void launchTool(tool, launchTarget.id);
    }
    return;
  }

  if (action === "open-target" && targetId) {
    void launchTool(tool, targetId);
  }
});

function detectLocale(): Locale {
  const saved = window.localStorage.getItem("rss-collector.locale");
  if (saved === "ru" || saved === "en") {
    return saved;
  }

  return navigator.language.toLowerCase().startsWith("ru") ? "ru" : "en";
}

function t(key: keyof (typeof translations)["ru"]): string {
  return translations[state.locale][key];
}

async function refreshTools(showLoader = true): Promise<void> {
  if (showLoader) {
    state.loading = true;
  }
  render();

  try {
    state.tools = await invoke<ToolEntry[]>("list_tools");
    state.error = "";
  } catch (error) {
    state.error = formatError(t("loadFailed"), error);
  } finally {
    state.loading = false;
    render();
  }
}

async function openFolder(tool: ToolEntry): Promise<void> {
  const busyKey = `folder:${tool.id}`;
  state.busyKey = busyKey;
  render();

  try {
    await invoke("open_tool_folder", { toolId: tool.id });
    state.error = "";
  } catch (error) {
    state.error = formatError(t("folderFailed"), error);
  } finally {
    state.busyKey = null;
    render();
  }
}

async function launchTool(tool: ToolEntry, targetId: string): Promise<void> {
  const busyKey = `launch:${tool.id}:${targetId}`;
  state.busyKey = busyKey;
  render();

  try {
    await invoke("launch_tool", { toolId: tool.id, targetId });
    state.error = "";
    state.modalToolId = null;
  } catch (error) {
    state.error = formatError(t("launchFailed"), error);
  } finally {
    state.busyKey = null;
    render();
  }
}

function render(): void {
  const modalTool = state.tools.find((tool) => tool.id === state.modalToolId) ?? null;
  document.body.classList.toggle("has-modal", modalTool !== null);

  app.innerHTML = `
    <main class="app-shell">
      <div class="app-frame">
        <header class="app-header">
          <div class="brand">
            <div class="brand__mark">
              <img class="brand__logo" src="${logoUrl}" alt="RSS-Collector" />
            </div>
            <h1 class="brand__title">RSS-Collector</h1>
          </div>
        </header>
        ${
          state.error
            ? `<div class="status-line status-line--error">${escapeHtml(state.error)}</div>`
            : ""
        }
        ${
          state.loading
            ? `<div class="status-line">${t("loading")}</div>`
            : state.tools.length === 0
              ? `<div class="status-line">${t("empty")}</div>`
              : `<section class="tool-grid">${state.tools.map(renderCard).join("")}</section>`
        }
        ${modalTool ? renderModal(modalTool) : ""}
      </div>
    </main>
  `;
}

function renderCard(tool: ToolEntry): string {
  const folderBusy = state.busyKey === `folder:${tool.id}`;
  const launchBusy = tool.targets.some((target) => state.busyKey === `launch:${tool.id}:${target.id}`);
  const disabled = !tool.hasTargets;

  return `
    <article class="tool-card">
      <div class="tool-card__body">
        <div class="tool-card__name">
          <h2 class="tool-card__title">${escapeHtml(tool.title)}</h2>
        </div>
        <div class="tool-card__actions">
          <button
            class="icon-button"
            title="${t("folderOpen")}"
            aria-label="${t("folderOpen")}"
            data-action="open-folder"
            data-tool-id="${escapeHtml(tool.id)}"
            ${folderBusy ? "disabled" : ""}
          >
            ${explorerIcon}
          </button>
          <button
            class="primary-button"
            data-action="open-tool"
            data-tool-id="${escapeHtml(tool.id)}"
            ${disabled || launchBusy ? "disabled" : ""}
          >
            ${t("open")}
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderModal(tool: ToolEntry): string {
  return `
    <section class="overlay">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header">
          <h3 id="modal-title">${escapeHtml(tool.title)}</h3>
          <button class="close-button" data-action="close-modal" aria-label="${t("close")}">×</button>
        </div>
        <div class="target-grid">
          ${tool.targets
            .map((target) => {
              const busy = state.busyKey === `launch:${tool.id}:${target.id}`;
              return `
                <button
                  class="target-button"
                  data-action="open-target"
                  data-tool-id="${escapeHtml(tool.id)}"
                  data-target-id="${escapeHtml(target.id)}"
                  ${busy ? "disabled" : ""}
                >
                  ${escapeHtml(target.label)}
                </button>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function formatError(prefix: string, error: unknown): string {
  if (error instanceof Error && error.message) {
    return `${prefix}: ${error.message}`;
  }

  if (typeof error === "string" && error.trim()) {
    return `${prefix}: ${error}`;
  }

  return prefix;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
