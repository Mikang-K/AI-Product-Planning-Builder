import { escapeHtml } from "../utils.js";

export function renderTabsHtml(tabs, activeTab) {
  return tabs
    .map(
      (tab) => `
        <button
          class="tab-button ${tab.id === activeTab ? "active" : ""}"
          type="button"
          data-tab-id="${escapeHtml(tab.id)}"
        >
          ${escapeHtml(tab.label)}
        </button>
      `,
    )
    .join("");
}
