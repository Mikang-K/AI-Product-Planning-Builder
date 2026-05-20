import { escapeHtml, formatDate } from "../utils.js";

export function renderProjectListHtml(projects, activeProjectId) {
  if (!projects.length) {
    return `<p class="project-description">아직 생성된 프로젝트가 없습니다.</p>`;
  }

  return projects
    .map(
      (project) => `
        <div
          class="project-item ${project.id === activeProjectId ? "active" : ""}"
        >
          <button class="project-select" type="button" data-project-id="${escapeHtml(project.id)}">
            <strong>${escapeHtml(project.title)}</strong>
            <span>${escapeHtml(formatDate(project.updatedAt))}</span>
          </button>
          <div class="project-actions">
            <button class="project-action" type="button" data-project-rename-id="${escapeHtml(project.id)}">이름</button>
            <button class="project-action" type="button" data-project-duplicate-id="${escapeHtml(project.id)}">복제</button>
            <button class="project-action danger" type="button" data-project-delete-id="${escapeHtml(project.id)}">삭제</button>
          </div>
        </div>
      `,
    )
    .join("");
}
