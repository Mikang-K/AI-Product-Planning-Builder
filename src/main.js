import { LlmClient, isAllowedLlmEndpoint } from "./engines/llmClient.js";
import { LlmEngine } from "./engines/llmEngine.js";
import { PlannerEngine } from "./engines/plannerEngine.js";

import {
  addImportedProjectsToState,
  addProjectToState,
  clearProjects,
  deleteProjectFromState,
  duplicateProjectInState,
  renameProjectInState,
  selectProject,
  updateWorkItemStatus,
} from "./actions.js";

import {
  migrateProjectArtifacts,
} from "./artifacts.js";

import {
  applyAgentResultToAutomation,
  buildDevelopmentAgentBatch,
  buildDevelopmentAgentCliCommand,
  buildDevelopmentAgentInput,
  createAutomationRun,
  createReviewAutomationRun,
  getRunnableDevelopmentWorkItems,
} from "./automation.js";

import {
  buildCodexDevelopmentPackage,
  buildCodexPrompt,
  buildCodexReviewPackage,
  buildCodexReviewPrompt,
} from "./codexWorkflow.js";

import {
  buildCollaborationPackage,
  ensureProjectCollaboration,
  workItemStatusClass,
  workItemStatusLabel,
  workItemStatuses,
} from "./collaboration.js";

import {
  assertMatchesSchema,
  productPackageSchema,
} from "./schemas.js";

import {
  downloadJson,
  downloadText,
  normalizeImportedProjects,
  readPersistedState,
  writePersistedState,
} from "./storage.js";

import { renderProjectListHtml } from "./render/projectList.js";
import { renderTabsHtml } from "./render/tabs.js";
import { findingSeverity, formatFindingText } from "./findings.js";

import {
  escapeHtml,
  formatDate,
  id,
  now,
  slugify,
} from "./utils.js";

(function () {
  "use strict";

  const STORE_KEY = "ai-product-planning-agent:v1";
  const CODEX_RUN_POLL_MS = 2500;

  const tabs = [
    { id: "diagnosis", label: "진단" },
    { id: "questions", label: "질문" },
    { id: "assumptions", label: "가정" },
    { id: "mvp", label: "MVP" },
    { id: "scenario", label: "시나리오" },
    { id: "experiment", label: "실험" },
    { id: "prd", label: "PRD" },
    { id: "development", label: "개발" },
    { id: "validation", label: "검증" },
    { id: "agents", label: "에이전트" },
    { id: "quality", label: "품질" },
    { id: "logs", label: "로그" },
    { id: "history", label: "히스토리" },
  ];

  const progressSteps = [
    "아이디어 진단 중",
    "질문 생성 중",
    "핵심 가정 정리 중",
    "MVP 범위 설정 중",
    "시나리오 작성 중",
    "검증 실험 설계 중",
    "개발 패키지 구성 중",
    "PRD 작성 중",
  ];

  const state = {
    projects: [],
    activeProjectId: null,
    activeTab: "diagnosis",
    isGenerating: false,
    llmConfig: {
      enabled: false,
      endpoint: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      apiKey: "",
    },
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    loadState();
    bindEvents();
    render();
  }

  function cacheElements() {
    els.ideaInput = document.getElementById("ideaInput");
    els.generateButton = document.getElementById("generateButton");
    els.autoCodexAfterGenerateToggle = document.getElementById("autoCodexAfterGenerateToggle");
    els.useLlmToggle = document.getElementById("useLlmToggle");
    els.llmEndpointInput = document.getElementById("llmEndpointInput");
    els.llmModelInput = document.getElementById("llmModelInput");
    els.llmApiKeyInput = document.getElementById("llmApiKeyInput");
    els.testLlmButton = document.getElementById("testLlmButton");
    els.importProjectButton = document.getElementById("importProjectButton");
    els.importProjectInput = document.getElementById("importProjectInput");
    els.clearProjectsButton = document.getElementById("clearProjectsButton");
    els.projectList = document.getElementById("projectList");
    els.emptyState = document.getElementById("emptyState");
    els.projectWorkspace = document.getElementById("projectWorkspace");
    els.projectTitle = document.getElementById("projectTitle");
    els.projectDescription = document.getElementById("projectDescription");
    els.versionBadge = document.getElementById("versionBadge");
    els.exportPromptsButton = document.getElementById("exportPromptsButton");
    els.exportPrdButton = document.getElementById("exportPrdButton");
    els.exportButton = document.getElementById("exportButton");
    els.startCodexButton = document.getElementById("startCodexButton");
    els.progressPanel = document.getElementById("progressPanel");
    els.progressBar = document.getElementById("progressBar");
    els.progressLabel = document.getElementById("progressLabel");
    els.tabs = document.getElementById("tabs");
    els.tabContent = document.getElementById("tabContent");
    els.feedbackTemplate = document.getElementById("feedbackTemplate");
  }

  function bindEvents() {
    els.generateButton.addEventListener("click", handleGenerate);
    els.ideaInput.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        handleGenerate();
      }
    });

    els.importProjectButton.addEventListener("click", () => {
      els.importProjectInput.value = "";
      els.importProjectInput.click();
    });
    els.importProjectInput.addEventListener("change", handleImportProjectFile);

    els.clearProjectsButton.addEventListener("click", () => {
      if (!state.projects.length) return;
      clearProjects(state);
      saveState();
      render();
    });

    els.exportButton.addEventListener("click", exportActiveProject);
    els.exportPrdButton.addEventListener("click", exportActivePrd);
    els.exportPromptsButton.addEventListener("click", exportActivePromptPackage);
    els.startCodexButton.addEventListener("click", exportActiveCodexPrompt);
    [els.useLlmToggle, els.llmEndpointInput, els.llmModelInput, els.llmApiKeyInput].forEach((element) => {
      element.addEventListener("input", updateLlmConfigFromForm);
      element.addEventListener("change", updateLlmConfigFromForm);
    });
    els.testLlmButton.addEventListener("click", testLlmConnection);
  }

  async function handleGenerate() {
    const idea = els.ideaInput.value.trim();
    if (!idea || state.isGenerating) return;

    state.isGenerating = true;
    els.generateButton.disabled = true;
    els.progressPanel.classList.remove("hidden");

    try {
      const project = await createProjectWithSelectedEngine(idea);
      addProjectToState(state, project, {
        activeTab: els.autoCodexAfterGenerateToggle?.checked ? "agents" : "diagnosis",
      });
      els.ideaInput.value = "";
      saveState();
      render();
      if (els.autoCodexAfterGenerateToggle?.checked) {
        await exportNextCodexDevelopmentPrompt(project, { quiet: true });
      }
    } catch (error) {
      window.alert(`생성에 실패했습니다. ${error.message}`);
    } finally {
      state.isGenerating = false;
      els.generateButton.disabled = false;
      els.progressPanel.classList.add("hidden");
    }
  }

  async function createProjectWithSelectedEngine(idea) {
    if (state.llmConfig.enabled) {
      ensureLlmConfig(state.llmConfig);
      if (!isAllowedLlmEndpoint(state.llmConfig.endpoint)) {
        throw new Error("허용된 HTTPS LLM Endpoint만 사용할 수 있습니다.");
      }
      try {
        return await LlmEngine.createProject(idea, state.llmConfig, updateProgressByLabel);
      } catch (error) {
        updateProgressByLabel("LLM 실패, 로컬 엔진으로 전환 중", 0, 1);
        await wait(240);
        const project = PlannerEngine.createProject(idea);
        project.decisionLogs.unshift({
          id: id("decision"),
          decision: "LLM 호출 실패 후 로컬 엔진으로 폴백",
          reason: error.message,
          createdAt: now(),
        });
        return project;
      }
    }

    for (let index = 0; index < progressSteps.length; index += 1) {
      updateProgress(index);
      await wait(160);
    }
    return PlannerEngine.createProject(idea);
  }

  async function handleImportProjectFile(event) {
    const [file] = Array.from(event.target.files || []);
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const importedProjects = normalizeImportedProjects(parsed, state.projects, validateImportedProject);
      importedProjects.forEach(migrateProjectArtifacts);
      addImportedProjectsToState(state, importedProjects);
      saveState();
      render();
      window.alert(`${importedProjects.length}개 프로젝트를 가져왔습니다.`);
    } catch (error) {
      window.alert(`프로젝트 가져오기에 실패했습니다. ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function updateProgress(index) {
    const percentage = Math.round(((index + 1) / progressSteps.length) * 100);
    els.progressBar.style.width = `${percentage}%`;
    els.progressLabel.textContent = progressSteps[index];
  }

  function updateProgressByLabel(label, index, total) {
    const percentage = Math.round(((index + 1) / total) * 100);
    els.progressBar.style.width = `${percentage}%`;
    els.progressLabel.textContent = label;
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function renderLlmConfigForm() {
    if (!els.useLlmToggle) return;
    els.useLlmToggle.checked = Boolean(state.llmConfig.enabled);
    els.llmEndpointInput.value = state.llmConfig.endpoint || "";
    els.llmModelInput.value = state.llmConfig.model || "";
    els.llmApiKeyInput.value = state.llmConfig.apiKey || "";
  }

  function updateLlmConfigFromForm() {
    state.llmConfig = {
      enabled: els.useLlmToggle.checked,
      endpoint: els.llmEndpointInput.value.trim(),
      model: els.llmModelInput.value.trim(),
      apiKey: els.llmApiKeyInput.value.trim(),
    };
    saveState();
  }

  async function testLlmConnection() {
    updateLlmConfigFromForm();
    try {
      ensureLlmConfig(state.llmConfig);
      els.testLlmButton.disabled = true;
      els.testLlmButton.textContent = "테스트 중";
      await LlmClient.requestJson(state.llmConfig, [
        {
          role: "system",
          content: "Return only valid JSON.",
        },
        {
          role: "user",
          content: 'Return {"ok":true,"message":"connected"} as JSON.',
        },
      ]);
      window.alert("LLM API 연결에 성공했습니다.");
    } catch (error) {
      window.alert(`LLM API 연결에 실패했습니다. ${error.message}`);
    } finally {
      els.testLlmButton.disabled = false;
      els.testLlmButton.textContent = "연결 테스트";
    }
  }

  function ensureLlmConfig(config) {
    if (!config.endpoint) throw new Error("Endpoint를 입력해 주세요.");
    if (!config.model) throw new Error("Model을 입력해 주세요.");
    if (!config.apiKey) throw new Error("API Key를 입력해 주세요.");
  }

  function loadState() {
    try {
      const persisted = readPersistedState(window.localStorage, STORE_KEY);
      if (persisted) {
        state.projects = persisted.projects;
        state.projects.forEach(migrateProjectArtifacts);
        state.activeProjectId = persisted.activeProjectId || state.projects[0]?.id || null;
        state.activeTab = persisted.activeTab;
        state.llmConfig = {
          ...state.llmConfig,
          ...persisted.llmConfig,
          apiKey: "",
        };
      }
    } catch {
      clearProjects(state);
    }
    renderLlmConfigForm();
  }

  function saveState() {
    state.projects.forEach(ensureProjectCollaboration);
    writePersistedState(window.localStorage, STORE_KEY, state);
  }

  function render() {
    renderProjectList();
    renderWorkspace();
  }

  function renderProjectList() {
    els.projectList.innerHTML = renderProjectListHtml(state.projects, state.activeProjectId);
    if (!state.projects.length) return;

    els.projectList.querySelectorAll("[data-project-id]").forEach((button) => {
      button.addEventListener("click", () => {
        selectProject(state, button.dataset.projectId);
        saveState();
        render();
      });
    });
    els.projectList.querySelectorAll("[data-project-rename-id]").forEach((button) => {
      button.addEventListener("click", () => renameProject(button.dataset.projectRenameId));
    });
    els.projectList.querySelectorAll("[data-project-duplicate-id]").forEach((button) => {
      button.addEventListener("click", () => duplicateProject(button.dataset.projectDuplicateId));
    });
    els.projectList.querySelectorAll("[data-project-delete-id]").forEach((button) => {
      button.addEventListener("click", () => deleteProject(button.dataset.projectDeleteId));
    });
  }

  function renameProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const nextTitle = window.prompt("새 프로젝트 이름을 입력하세요.", project.title)?.trim();
    if (!nextTitle) return;
    renameProjectInState(state, projectId, nextTitle);
    saveState();
    render();
  }

  function duplicateProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    duplicateProjectInState(state, projectId);
    saveState();
    render();
  }

  function deleteProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    if (!window.confirm(`${project.title} 프로젝트를 삭제할까요?`)) return;
    deleteProjectFromState(state, projectId);
    saveState();
    render();
  }

  function renderWorkspace() {
    const project = getActiveProject();
    els.emptyState.classList.toggle("hidden", Boolean(project));
    els.projectWorkspace.classList.toggle("hidden", !project);
    if (!project) return;

    els.projectTitle.textContent = project.title;
    els.projectDescription.textContent = project.description;
    els.versionBadge.textContent = `v${project.currentVersion}`;
    renderTabs();
    renderTabContent(project);
  }

  function renderTabs() {
    els.tabs.innerHTML = renderTabsHtml(tabs, state.activeTab);

    els.tabs.querySelectorAll("[data-tab-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.tabId;
        saveState();
        renderWorkspace();
      });
    });
  }

  function renderTabContent(project) {
    const artifacts = project.artifacts;
    const renderers = {
      diagnosis: () => renderDiagnosis(artifacts),
      questions: () => renderQuestions(project, artifacts.questions),
      assumptions: () => renderAssumptions(artifacts.assumptions),
      mvp: () => renderMvp(artifacts.mvp),
      scenario: () => renderScenario(artifacts),
      experiment: () => renderExperiment(artifacts),
      prd: () => renderPrd(project, artifacts),
      development: () => renderDevelopment(artifacts.development),
      validation: () => renderValidation(artifacts.validation),
      agents: () => renderAgentPackage(project, artifacts.agentPackage),
      quality: () => renderQuality(artifacts.quality),
      logs: () => renderLogs(project),
      history: () => renderHistory(project),
    };

    const renderer = renderers[state.activeTab] || renderers.diagnosis;
    els.tabContent.innerHTML = renderer();
    attachFeedbackForm(project);
    attachQuestionAnswerForm(project);
    attachCollaborationBoard(project);
    attachVersionCompare(project);
  }

  function renderDiagnosis(artifacts) {
    const analysis = artifacts.analysis;
    return `
      <div class="content-grid">
        <section class="panel full">
          <h3>아이디어 진단 카드</h3>
          <dl class="kv-list">
            ${definition("제품 한 줄 설명", analysis.oneLineDescription)}
            ${definition("타깃 사용자", analysis.targetUser)}
            ${definition("해결하려는 문제", analysis.problem)}
            ${definition("핵심 가치 제안", analysis.valueProposition)}
            ${definition("차별화 포인트", analysis.differentiation)}
          </dl>
        </section>
        <section class="panel">
          <h3>시장 판단</h3>
          <dl class="kv-list">
            ${definition("기존 대안", analysis.existingAlternatives)}
            ${definition("예상 수익화 가능성", analysis.monetizationPotential)}
          </dl>
        </section>
        <section class="panel">
          <h3>구현 판단</h3>
          <dl class="kv-list">
            ${definition("구현 난이도", analysis.implementationDifficulty)}
            ${definition("가장 위험한 가정", analysis.riskiestAssumption)}
          </dl>
        </section>
      </div>
    `;
  }

  function renderQuestions(project, questions) {
    const savedAnswers = Array.isArray(project.questionAnswers) ? project.questionAnswers : [];
    return `
      <ul class="simple-list">
        ${questions
          .map(
            (item, index) => `
              <li>
                <strong>${index + 1}. ${escapeHtml(item.question)}</strong>
                <p>${escapeHtml(item.reason)}</p>
              </li>
            `,
          )
          .join("")}
      </ul>
      <form id="questionAnswerForm" class="question-answer-form">
        <h3>질문별 답변</h3>
        <div class="question-answer-list">
          ${questions
            .map(
              (item, index) => `
                <label>
                  <span>${index + 1}. ${escapeHtml(item.question)}</span>
                  <textarea
                    name="questionAnswer-${index}"
                    rows="3"
                    placeholder="이 질문에 대한 답변을 입력하세요."
                  >${escapeHtml(savedAnswers[index] || "")}</textarea>
                </label>
              `,
            )
            .join("")}
        </div>
        <button class="primary-button" type="submit">답변 반영</button>
      </form>
      ${feedbackFormHtml()}
    `;
  }

  function renderAssumptions(assumptions) {
    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>가정</th>
              <th>중요도</th>
              <th>불확실성</th>
              <th>검증 난이도</th>
              <th>검증 방법</th>
            </tr>
          </thead>
          <tbody>
            ${assumptions
              .map(
                (item) => `
                  <tr>
                    <td>${escapeHtml(item.content)}</td>
                    <td>${pill(item.importance)}</td>
                    <td>${pill(item.uncertainty)}</td>
                    <td>${pill(item.validationDifficulty)}</td>
                    <td>${escapeHtml(item.validationMethod)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderMvp(mvp) {
    return `
      <div class="content-grid">
        <section class="panel">
          <h3>MVP에 포함할 기능</h3>
          <ul class="simple-list">
            ${mvp.included
              .map(
                (feature) => `
                  <li>
                    <span class="status-pill included">포함</span>
                    <h3>${escapeHtml(feature.name)}</h3>
                    <p>${escapeHtml(feature.description)}</p>
                    <p>${escapeHtml(feature.reason)}</p>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </section>
        <section class="panel">
          <h3>MVP에서 제외할 기능</h3>
          <ul class="simple-list">
            ${mvp.excluded
              .map(
                (feature) => `
                  <li>
                    <span class="status-pill excluded">제외</span>
                    <h3>${escapeHtml(feature.name)}</h3>
                    <p>${escapeHtml(feature.reason)}</p>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </section>
      </div>
    `;
  }

  function renderScenario(artifacts) {
    return `
      <div class="content-grid">
        <section class="panel full">
          <h3>사용자 시나리오</h3>
          <dl class="kv-list">
            ${definition("사용자 배경", artifacts.scenario.userBackground)}
            ${definition("문제 상황", artifacts.scenario.problemSituation)}
            ${definition("제품 사용 계기", artifacts.scenario.trigger)}
            ${definition("핵심 사용 흐름", artifacts.scenario.flow)}
            ${definition("기대되는 변화", artifacts.scenario.expectedChange)}
            ${definition("이탈 가능 지점", artifacts.scenario.dropOffRisk)}
          </dl>
        </section>
      </div>
    `;
  }

  function renderExperiment(artifacts) {
    return `
      <div class="content-grid">
        <section class="panel">
          <h3>성공 지표</h3>
          <ul class="metric-list">
            ${artifacts.metrics.map((metric) => `<li>${escapeHtml(metric)}</li>`).join("")}
          </ul>
        </section>
        <section class="panel">
          <h3>검증 실험 계획</h3>
          <dl class="kv-list">
            ${definition("검증할 가정", artifacts.experiment.hypothesis)}
            ${definition("실험 방법", artifacts.experiment.method)}
            ${definition("대상 사용자", artifacts.experiment.targetUser)}
            ${definition("기간", artifacts.experiment.duration)}
            ${definition("성공 기준", artifacts.experiment.successCriteria)}
            ${definition("실패 기준", artifacts.experiment.failureCriteria)}
            ${definition("다음 액션", artifacts.experiment.nextAction)}
          </dl>
        </section>
      </div>
    `;
  }

  function renderPrd(project, artifacts) {
    return `
      <article class="markdown-body">${escapeHtml(artifacts.prd)}</article>
      ${feedbackFormHtml()}
    `;
  }

  function renderDevelopment(development) {
    return `
      <div class="content-grid">
        <section class="panel full">
          <h3>기술 설계 요약</h3>
          <dl class="kv-list">
            ${definition("권장 구조", development.architecture.summary)}
            ${definition("프론트엔드", development.architecture.frontend)}
            ${definition("백엔드", development.architecture.backend)}
            ${definition("저장소", development.architecture.storage)}
            ${definition("AI 계층", development.architecture.aiLayer)}
          </dl>
        </section>
        <section class="panel">
          <h3>데이터 모델</h3>
          <ul class="simple-list">
            ${development.dataModels
              .map((model) => `<li><strong>${escapeHtml(model.name)}</strong><p>${escapeHtml(model.fields.join(", "))}</p></li>`)
              .join("")}
          </ul>
        </section>
        <section class="panel">
          <h3>API 명세</h3>
          <ul class="simple-list">
            ${development.apiSpec
              .map((api) => `<li><strong>${escapeHtml(api.method)} ${escapeHtml(api.path)}</strong><p>${escapeHtml(api.description)}</p></li>`)
              .join("")}
          </ul>
        </section>
        <section class="panel full">
          <h3>개발 태스크 보드</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>태스크</th>
                  <th>우선순위</th>
                  <th>난이도</th>
                  <th>근거</th>
                </tr>
              </thead>
              <tbody>
                ${development.tasks
                  .map(
                    (task) => `
                      <tr>
                        <td>${escapeHtml(task.title)}</td>
                        <td>${pill(task.priority)}</td>
                        <td>${escapeHtml(task.difficulty)}</td>
                        <td>${escapeHtml(task.reason)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h3>페이지 구조</h3>
          <ul class="simple-list">
            ${development.pageStructure.map((page) => `<li>${escapeHtml(page)}</li>`).join("")}
          </ul>
        </section>
        <section class="panel">
          <h3>기술 리스크</h3>
          <ul class="simple-list">
            ${development.technicalRisks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}
          </ul>
        </section>
      </div>
    `;
  }

  function renderValidation(validation) {
    return `
      <div class="content-grid">
        <section class="panel">
          <h3>PRD 품질 점수</h3>
          <dl class="kv-list">
            ${definition("종합 점수", `${validation.prdScore}/100`)}
            ${definition("판단", validation.summary)}
          </dl>
        </section>
        <section class="panel">
          <h3>MVP 적정성</h3>
          <dl class="kv-list">
            ${definition("평가", validation.mvpFit.status)}
            ${definition("이유", validation.mvpFit.reason)}
          </dl>
        </section>
        <section class="panel full">
          <h3>리스크 분석</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>리스크</th>
                  <th>심각도</th>
                  <th>대응</th>
                </tr>
              </thead>
              <tbody>
                ${validation.risks
                  .map(
                    (risk) => `
                      <tr>
                        <td>${escapeHtml(risk.title)}</td>
                        <td>${pill(risk.severity)}</td>
                        <td>${escapeHtml(risk.mitigation)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h3>실험 설계 리뷰</h3>
          <ul class="simple-list">
            ${validation.experimentReview.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
        <section class="panel">
          <h3>출시 전 체크리스트</h3>
          <ul class="simple-list">
            ${validation.launchChecklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
        <section class="panel full">
          <h3>개선 권고안</h3>
          <ul class="simple-list">
            ${validation.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>
      </div>
      ${feedbackFormHtml()}
    `;
  }

  function renderAgentPackage(project, agentPackage) {
    const collaboration = ensureProjectCollaboration(project);
    return `
      <div class="content-grid">
        <section class="panel full">
          <h3>에이전트 실행 패키지</h3>
          <dl class="kv-list">
            ${definition("목적", agentPackage.summary)}
            ${definition("권장 실행 순서", agentPackage.executionOrder.join(" → "))}
            ${definition("핸드오프 규칙", agentPackage.handoffRule)}
          </dl>
        </section>
        ${agentPackage.agents
          .map(
            (agent) => `
              <section class="panel agent-card">
                <div class="agent-card-head">
                  <div>
                    <h3>${escapeHtml(agent.name)}</h3>
                    <p>${escapeHtml(agent.role)}</p>
                  </div>
                  <span class="version-badge">${escapeHtml(agent.outputKey)}</span>
                </div>
                <details>
                  <summary>시스템 프롬프트</summary>
                  <pre class="code-block">${escapeHtml(agent.systemPrompt)}</pre>
                </details>
                <details>
                  <summary>사용자 프롬프트 템플릿</summary>
                  <pre class="code-block">${escapeHtml(agent.userPrompt)}</pre>
                </details>
                <details>
                  <summary>출력 스키마</summary>
                  <pre class="code-block">${escapeHtml(JSON.stringify(agent.outputSchema, null, 2))}</pre>
                </details>
              </section>
            `,
          )
          .join("")}
        <section class="panel full">
          <h3>오케스트레이션 메모</h3>
          <ul class="simple-list">
            ${agentPackage.orchestrationNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
          </ul>
        </section>
        ${renderCollaborationBoard(collaboration)}
      </div>
    `;
  }

  function renderCollaborationBoard(collaboration) {
    const developerItems = collaboration.workItems.filter((item) => item.agentRole === "developer");
    const reviewerItems = collaboration.workItems.filter((item) => item.agentRole === "reviewer");
    const validatorItems = collaboration.workItems.filter((item) => item.agentRole === "validator");
    const automationRuns = Array.isArray(collaboration.automationRuns) ? collaboration.automationRuns : [];
    const reviewAutomationRuns = Array.isArray(collaboration.reviewAutomationRuns) ? collaboration.reviewAutomationRuns : [];
    return `
      <section class="panel full collaboration-board">
        <div class="collaboration-head">
          <div>
            <h3>Agent Collaboration Board</h3>
            <p>Development and validation agents can use these work items as handoff packages.</p>
          </div>
          <div class="collaboration-actions">
            <div class="action-group">
              <span>Export</span>
              <button id="exportCollaborationButton" class="secondary-button" type="button">Full</button>
              <button id="exportDeveloperPackageButton" class="secondary-button" type="button">Dev</button>
              <button id="exportReviewerPackageButton" class="secondary-button" type="button">Review</button>
              <button id="exportValidatorPackageButton" class="secondary-button" type="button">Validation</button>
            </div>
            <div class="action-group">
              <span>Develop</span>
              <button id="runAllDeveloperAgentButton" class="secondary-button" type="button">Run Ready Dev</button>
              <button id="importAgentResultButton" class="secondary-button" type="button">Import Result</button>
            </div>
            <input id="agentResultInput" class="hidden" type="file" accept="application/json,.json" />
          </div>
        </div>
        ${renderDevelopmentAutomationGuide()}
        ${renderWorkItemGroup("Development Work Items", developerItems)}
        ${renderWorkItemGroup("Code Review Work Items", reviewerItems)}
        ${renderWorkItemGroup("Validation Work Items", validatorItems)}
        ${renderAutomationRuns(automationRuns)}
        ${renderReviewAutomationRuns(reviewAutomationRuns)}
        ${renderAgentRuns(collaboration.agentRuns)}
      </section>
    `;
  }

  function renderDevelopmentAutomationGuide() {
    return `
      <details class="automation-guide">
        <summary>Development Agent CLI</summary>
        <pre class="code-block">${escapeHtml(buildDevelopmentAgentCliCommand("package.json", "work-item.json", "result.json"))}</pre>
      </details>
    `;
  }

  function renderWorkItemGroup(title, items) {
    return `
      <div class="work-item-group">
        <h4>${escapeHtml(title)}</h4>
        <div class="work-item-grid">
          ${items.map(renderWorkItemCard).join("")}
        </div>
      </div>
    `;
  }

  function renderWorkItemCard(item) {
    return `
      <article class="work-item-card">
        <div class="work-item-card-head">
          <div>
            <span class="status-pill ${workItemStatusClass(item.status)}">${escapeHtml(workItemStatusLabel(item.status))}</span>
            <h5>${escapeHtml(item.title)}</h5>
          </div>
          <select data-work-item-status-id="${escapeHtml(item.id)}" aria-label="Work item status">
            ${workItemStatuses()
              .map((status) => `<option value="${escapeHtml(status)}" ${status === item.status ? "selected" : ""}>${escapeHtml(workItemStatusLabel(status))}</option>`)
              .join("")}
          </select>
        </div>
        <p>${escapeHtml(item.description)}</p>
        <dl class="mini-kv-list">
          <dt>Role</dt>
          <dd>${escapeHtml(item.agentRole)}</dd>
          <dt>Priority</dt>
          <dd>${escapeHtml(item.priority)}</dd>
          <dt>Source</dt>
          <dd>${escapeHtml(item.source)}</dd>
        </dl>
        <details>
          <summary>Acceptance Criteria</summary>
          <ul class="simple-list compact">
            ${item.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}
          </ul>
        </details>
        <details>
          <summary>Expected Output</summary>
          <pre class="code-block">${escapeHtml(JSON.stringify(item.expectedOutput, null, 2))}</pre>
        </details>
        <div class="work-item-actions">
          <div class="action-group compact">
            <span>Item</span>
            <button class="secondary-button" type="button" data-work-item-export-id="${escapeHtml(item.id)}">Export</button>
          </div>
          ${
            item.agentRole === "developer" && ["ready", "exported", "needs_revision"].includes(item.status)
              ? `
                <div class="action-group compact">
                  <span>Agent</span>
                  <button class="secondary-button" type="button" data-work-item-run-id="${escapeHtml(item.id)}">Package</button>
                </div>
                <div class="action-group compact codex">
                  <span>Codex</span>
                  <button class="secondary-button" type="button" data-work-item-codex-package-id="${escapeHtml(item.id)}">Package</button>
                  <button class="primary-button" type="button" data-work-item-codex-prompt-id="${escapeHtml(item.id)}">Prompt</button>
                </div>
              `
              : ""
          }
          ${
            item.agentRole === "reviewer" && ["ready", "exported", "needs_revision"].includes(item.status)
              ? `
                <div class="action-group compact codex">
                  <span>Review</span>
                  <button class="secondary-button" type="button" data-work-item-review-package-id="${escapeHtml(item.id)}">Package</button>
                  <button class="primary-button" type="button" data-work-item-review-prompt-id="${escapeHtml(item.id)}">Prompt</button>
                </div>
              `
              : ""
          }
        </div>
      </article>
    `;
  }

  function renderAutomationRuns(automationRuns) {
    if (!automationRuns.length) {
      return `<p class="project-description">No development automation runs yet.</p>`;
    }
    return `
      <div class="work-item-group">
        <h4>Development Automation Runs</h4>
        <ul class="simple-list">
          ${automationRuns
            .map(
              (run) => `
                <li>
                  <span class="status-pill ${automationRunStatusClass(run.status)}">${escapeHtml(run.status)}</span>
                  <strong>${escapeHtml(run.id)}</strong>
                  <p>${escapeHtml((run.workItemIds || []).join(", "))}</p>
                  ${run.error ? `<p>${escapeHtml(run.error)}</p>` : ""}
                  <span>${escapeHtml(formatDate(run.completedAt || run.startedAt || run.createdAt))}</span>
                </li>
              `,
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function renderReviewAutomationRuns(reviewAutomationRuns) {
    if (!reviewAutomationRuns.length) {
      return `<p class="project-description">No code review automation runs yet.</p>`;
    }
    return `
      <div class="work-item-group">
        <h4>Code Review Automation Runs</h4>
        <ul class="simple-list">
          ${reviewAutomationRuns
            .map(
              (run) => `
                <li>
                  <span class="status-pill ${automationRunStatusClass(run.status)}">${escapeHtml(run.status)}</span>
                  <strong>${escapeHtml(run.id)}</strong>
                  <p>${escapeHtml((run.workItemIds || []).join(", "))}</p>
                  ${run.error ? `<p>${escapeHtml(run.error)}</p>` : ""}
                  <span>${escapeHtml(formatDate(run.completedAt || run.startedAt || run.createdAt))}</span>
                </li>
              `,
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function automationRunStatusClass(status) {
    if (status === "completed") return "included";
    if (status === "failed" || status === "cancelled") return "excluded";
    return "medium";
  }

  function renderAgentRuns(agentRuns) {
    if (!agentRuns.length) {
      return `<p class="project-description">No imported agent results yet.</p>`;
    }
    return `
      <div class="work-item-group">
        <h4>Imported Agent Results</h4>
        <ul class="simple-list">
          ${agentRuns
            .map(
              (run) => `
                <li>
                  <span class="status-pill ${workItemStatusClass(run.status)}">${escapeHtml(workItemStatusLabel(run.status))}</span>
                  <strong>${escapeHtml(run.agentRole)} / ${escapeHtml(run.workItemId)}</strong>
                  ${renderAgentRunFindings(run.findings)}
                  ${renderCodexEvidence(run.codexEvidence)}
                  <span>${escapeHtml(formatDate(run.importedAt))}</span>
                </li>
              `,
            )
            .join("")}
        </ul>
      </div>
    `;
  }

  function renderAgentRunFindings(findings) {
    const normalized = Array.isArray(findings) ? findings : [];
    if (!normalized.length) return "";
    return `
      <ul class="finding-list">
        ${normalized.map(renderFindingItem).join("")}
      </ul>
    `;
  }

  function renderFindingItem(finding) {
    const severity = findingSeverity(finding);
    if (typeof finding === "string") {
      return `
        <li class="finding-item">
          <span class="severity-pill ${escapeHtml(severity)}">${escapeHtml(severity)}</span>
          <p>${escapeHtml(finding)}</p>
        </li>
      `;
    }

    const location = [finding.file, finding.line ? `:${finding.line}` : ""].filter(Boolean).join("");
    return `
      <li class="finding-item">
        <div class="finding-head">
          <span class="severity-pill ${escapeHtml(severity)}">${escapeHtml(severity)}</span>
          ${location ? `<code>${escapeHtml(location)}</code>` : ""}
        </div>
        <strong>${escapeHtml(finding.title || "Review finding")}</strong>
        ${finding.description ? `<p>${escapeHtml(finding.description)}</p>` : ""}
        ${
          finding.recommendation
            ? `<p class="finding-recommendation"><span>Recommendation</span>${escapeHtml(finding.recommendation)}</p>`
            : ""
        }
      </li>
    `;
  }

  function renderCodexEvidence(codexEvidence) {
    if (!codexEvidence) return "";
    const commands = Array.isArray(codexEvidence.commands) ? codexEvidence.commands : [];
    const notes = Array.isArray(codexEvidence.notes) ? codexEvidence.notes : [];
    if (!commands.length && !notes.length) return "";
    return `
      <details>
        <summary>Codex Evidence</summary>
        <pre class="code-block">${escapeHtml(JSON.stringify({ commands, notes }, null, 2))}</pre>
      </details>
    `;
  }

  function renderQuality(quality) {
    return `
      <div class="content-grid">
        <section class="panel">
          <h3>산출물 품질 게이트</h3>
          <dl class="kv-list">
            ${definition("상태", quality.status)}
            ${definition("점수", `${quality.score}/100`)}
            ${definition("요약", quality.summary)}
          </dl>
        </section>
        <section class="panel">
          <h3>스키마 검증</h3>
          <ul class="simple-list">
            ${quality.schemaChecks
              .map(
                (check) => `
                  <li>
                    <span class="status-pill ${check.passed ? "included" : "excluded"}">${check.passed ? "통과" : "점검"}</span>
                    <strong>${escapeHtml(check.name)}</strong>
                    <p>${escapeHtml(check.detail)}</p>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </section>
        <section class="panel full">
          <h3>필드 검증 결과</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>영역</th>
                  <th>검사 항목</th>
                  <th>결과</th>
                  <th>설명</th>
                </tr>
              </thead>
              <tbody>
                ${quality.fieldChecks
                  .map(
                    (check) => `
                      <tr>
                        <td>${escapeHtml(check.group)}</td>
                        <td>${escapeHtml(check.label)}</td>
                        <td>${check.passed ? "통과" : "점검 필요"}</td>
                        <td>${escapeHtml(check.message)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <h3>누락/보강 필요</h3>
          <ul class="simple-list">
            ${quality.issues.length ? quality.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("") : "<li>필수 산출물 누락은 발견되지 않았습니다.</li>"}
          </ul>
        </section>
        <section class="panel">
          <h3>다음 개선 액션</h3>
          <ul class="simple-list">
            ${quality.nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}
          </ul>
        </section>
      </div>
    `;
  }

  function renderLogs(project) {
    return `
      <div class="content-grid">
        <section class="panel">
          <h3>결정 로그</h3>
          <div class="simple-list">
            ${project.decisionLogs.map(renderLogItem).join("")}
          </div>
        </section>
        <section class="panel">
          <h3>변경 로그</h3>
          <div class="simple-list">
            ${project.changeLogs.length ? project.changeLogs.map(renderChangeItem).join("") : "<p>아직 변경 이력이 없습니다.</p>"}
          </div>
        </section>
      </div>
      ${feedbackFormHtml()}
    `;
  }

  function renderHistory(project) {
    const latestVersion = project.versions[0]?.version;
    const previousVersion = project.versions[1]?.version || latestVersion;
    return `
      <section class="panel history-compare">
        <h3>버전 비교</h3>
        <div class="compare-controls">
          <label>
            기준 버전
            <select id="baseVersionSelect">
              ${project.versions
                .map(
                  (version) => `
                    <option value="${escapeHtml(version.version)}" ${version.version === previousVersion ? "selected" : ""}>v${escapeHtml(version.version)}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
          <label>
            비교 버전
            <select id="targetVersionSelect">
              ${project.versions
                .map(
                  (version) => `
                    <option value="${escapeHtml(version.version)}" ${version.version === latestVersion ? "selected" : ""}>v${escapeHtml(version.version)}</option>
                  `,
                )
                .join("")}
            </select>
          </label>
        </div>
        <div id="versionDiffPanel">
          ${renderVersionDiff(project, previousVersion, latestVersion)}
        </div>
      </section>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>버전</th>
              <th>생성 시각</th>
              <th>반영 입력</th>
              <th>수정 섹션</th>
            </tr>
          </thead>
          <tbody>
            ${project.versions
              .map(
                (version) => `
                  <tr>
                    <td>v${version.version}</td>
                    <td>${escapeHtml(formatDate(version.createdAt))}</td>
                    <td>${escapeHtml(version.feedback || "초기 생성")}</td>
                    <td>${escapeHtml(version.changedSections.join(", "))}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderVersionDiff(project, baseVersionNumber, targetVersionNumber) {
    const baseVersion = project.versions.find((version) => version.version === Number(baseVersionNumber));
    const targetVersion = project.versions.find((version) => version.version === Number(targetVersionNumber));
    if (!baseVersion || !targetVersion) {
      return `<p>비교할 버전을 선택할 수 없습니다.</p>`;
    }

    const rows = buildVersionDiffRows(baseVersion.artifacts, targetVersion.artifacts);
    return `
      <div class="diff-grid">
        ${rows
          .map(
            (row) => `
              <div class="diff-row ${row.changed ? "changed" : ""}">
                <strong>${escapeHtml(row.label)}</strong>
                <div>
                  <span>v${baseVersion.version}</span>
                  <p>${escapeHtml(row.before)}</p>
                </div>
                <div>
                  <span>v${targetVersion.version}</span>
                  <p>${escapeHtml(row.after)}</p>
                </div>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function attachFeedbackForm(project) {
    const form = document.getElementById("feedbackForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = document.getElementById("feedbackInput");
      const feedback = input.value.trim();
      if (!feedback) return;
      try {
        els.progressPanel.classList.remove("hidden");
        await applyProjectFeedback(project, feedback);
      } catch (error) {
        window.alert(`업데이트에 실패했습니다. ${error.message}`);
      } finally {
        els.progressPanel.classList.add("hidden");
      }
    });
  }

  function attachQuestionAnswerForm(project) {
    const form = document.getElementById("questionAnswerForm");
    if (!form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const questions = project.artifacts.questions || [];
      const answers = questions.map((_, index) => {
        const field = form.elements[`questionAnswer-${index}`];
        return String(field?.value || "").trim();
      });
      const answeredItems = questions
        .map((question, index) => ({ question: question.question, answer: answers[index] }))
        .filter((item) => item.answer);
      if (!answeredItems.length) return;

      const feedback = [
        "정보 보완 질문에 대한 사용자 답변을 반영해 주세요.",
        ...answeredItems.map((item, index) => `${index + 1}. 질문: ${item.question}\n답변: ${item.answer}`),
      ].join("\n\n");

      try {
        els.progressPanel.classList.remove("hidden");
        project.questionAnswers = answers;
        await applyProjectFeedback(project, feedback);
      } catch (error) {
        window.alert(`답변 반영에 실패했습니다. ${error.message}`);
      } finally {
        els.progressPanel.classList.add("hidden");
      }
    });
  }

  async function applyProjectFeedback(project, feedback) {
    if (state.llmConfig.enabled) {
      ensureLlmConfig(state.llmConfig);
      if (!isAllowedLlmEndpoint(state.llmConfig.endpoint)) {
        throw new Error("허용된 HTTPS LLM Endpoint만 사용할 수 있습니다.");
      }
      try {
        await LlmEngine.applyFeedback(project, feedback, state.llmConfig, updateProgressByLabel);
      } catch (error) {
        updateProgressByLabel("LLM 실패, 로컬 업데이트로 전환 중", 0, 1);
        await wait(240);
        PlannerEngine.applyFeedback(project, feedback);
        project.decisionLogs.unshift({
          id: id("decision"),
          decision: "LLM 피드백 호출 실패 후 로컬 업데이트로 폴백",
          reason: error.message,
          createdAt: now(),
        });
      }
    } else {
      PlannerEngine.applyFeedback(project, feedback);
    }
    project.updatedAt = now();
    saveState();
    render();
  }

  function attachCollaborationBoard(project) {
    const collaboration = ensureProjectCollaboration(project);
    const exportFullButton = document.getElementById("exportCollaborationButton");
    const exportDeveloperButton = document.getElementById("exportDeveloperPackageButton");
    const exportReviewerButton = document.getElementById("exportReviewerPackageButton");
    const exportValidatorButton = document.getElementById("exportValidatorPackageButton");
    const runAllDeveloperButton = document.getElementById("runAllDeveloperAgentButton");
    const importResultButton = document.getElementById("importAgentResultButton");
    const importResultInput = document.getElementById("agentResultInput");

    exportFullButton?.addEventListener("click", () => exportCollaborationPackage(project, "full"));
    exportDeveloperButton?.addEventListener("click", () => exportCollaborationPackage(project, "developer"));
    exportReviewerButton?.addEventListener("click", () => exportCollaborationPackage(project, "reviewer"));
    exportValidatorButton?.addEventListener("click", () => exportCollaborationPackage(project, "validator"));
    runAllDeveloperButton?.addEventListener("click", () => exportAllRunnableDevelopmentAgentInputs(project));
    importResultButton?.addEventListener("click", () => {
      importResultInput.value = "";
      importResultInput.click();
    });
    importResultInput?.addEventListener("change", (event) => handleAgentResultImport(project, event));

    document.querySelectorAll("[data-work-item-status-id]").forEach((select) => {
      select.addEventListener("change", () => {
        const item = updateWorkItemStatus(project, select.dataset.workItemStatusId, select.value);
        if (!item) return;
        saveState();
        renderWorkspace();
      });
    });

    document.querySelectorAll("[data-work-item-export-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const item = collaboration.workItems.find((workItem) => workItem.id === button.dataset.workItemExportId);
        if (!item) return;
        downloadJson(item, `${slugify(project.title)}-${item.id}.json`);
      });
    });

    document.querySelectorAll("[data-work-item-run-id]").forEach((button) => {
      button.addEventListener("click", () => {
        exportDevelopmentAgentInput(project, button.dataset.workItemRunId);
      });
    });

    document.querySelectorAll("[data-work-item-codex-package-id]").forEach((button) => {
      button.addEventListener("click", () => {
        exportCodexDevelopmentPackage(project, button.dataset.workItemCodexPackageId, "package");
      });
    });

    document.querySelectorAll("[data-work-item-codex-prompt-id]").forEach((button) => {
      button.addEventListener("click", () => {
        exportCodexDevelopmentPackage(project, button.dataset.workItemCodexPromptId, "prompt");
      });
    });

    document.querySelectorAll("[data-work-item-review-package-id]").forEach((button) => {
      button.addEventListener("click", () => {
        exportCodexReviewPackage(project, button.dataset.workItemReviewPackageId, "package");
      });
    });

    document.querySelectorAll("[data-work-item-review-prompt-id]").forEach((button) => {
      button.addEventListener("click", () => {
        exportCodexReviewPackage(project, button.dataset.workItemReviewPromptId, "prompt");
      });
    });
  }

  async function handleAgentResultImport(project, event) {
    const [file] = Array.from(event.target.files || []);
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const results = Array.isArray(parsed) ? parsed : [parsed];
      results.forEach((result) => importAgentResult(project, result));
      saveState();
      render();
      window.alert(`${results.length}개 에이전트 결과를 가져왔습니다.`);
    } catch (error) {
      window.alert(`에이전트 결과 가져오기에 실패했습니다. ${error.message}`);
    } finally {
      event.target.value = "";
    }
  }

  function importAgentResult(project, result) {
    applyAgentResultToAutomation(project, result);
    ensureProjectCollaboration(project);
  }

  function attachVersionCompare(project) {
    const baseSelect = document.getElementById("baseVersionSelect");
    const targetSelect = document.getElementById("targetVersionSelect");
    const diffPanel = document.getElementById("versionDiffPanel");
    if (!baseSelect || !targetSelect || !diffPanel) return;

    const updateDiff = () => {
      diffPanel.innerHTML = renderVersionDiff(project, baseSelect.value, targetSelect.value);
    };
    baseSelect.addEventListener("change", updateDiff);
    targetSelect.addEventListener("change", updateDiff);
  }

  function feedbackFormHtml() {
    return els.feedbackTemplate.innerHTML;
  }

  function exportActiveProject() {
    const project = getActiveProject();
    if (!project) return;
    downloadJson(project, `${slugify(project.title)}.json`);
  }

  function exportActivePrd() {
    const project = getActiveProject();
    if (!project) return;
    downloadText(project.artifacts.prd, `${slugify(project.title)}-prd.md`, "text/markdown");
  }

  function exportActivePromptPackage() {
    const project = getActiveProject();
    if (!project) return;
    downloadJson(project.artifacts.agentPackage, `${slugify(project.title)}-agent-prompts.json`);
  }

  async function exportActiveCodexPrompt() {
    const project = getActiveProject();
    if (!project) return;
    await exportNextCodexDevelopmentPrompt(project);
  }

  function exportCollaborationPackage(project, role) {
    const collaborationPackage = buildCollaborationPackage(project);
    const packageByRole =
      role === "full"
        ? collaborationPackage
        : {
            ...collaborationPackage,
            workItems: collaborationPackage.workItems.filter((item) => item.agentRole === role),
          };
    downloadJson(packageByRole, `${slugify(project.title)}-${role}-collaboration-package.json`);
  }

  function exportDevelopmentAgentInput(project, workItemId) {
    const collaboration = ensureProjectCollaboration(project);
    const workItem = collaboration.workItems.find((item) => item.id === workItemId);
    if (!workItem) return;
    try {
      const run = createAutomationRun(project, workItem.id);
      const input = buildDevelopmentAgentInput(project, workItem, run);
      const baseName = `${slugify(project.title)}-${workItem.id}`;
      downloadJson(input.collaborationPackage, `${baseName}-package.json`);
      downloadJson(input.workItem, `${baseName}-work-item.json`);
      downloadJson(input, `${baseName}-development-agent-input.json`);
      saveState();
      renderWorkspace();
      window.alert(`개발 에이전트 입력 패키지를 생성했습니다.\n\n${buildDevelopmentAgentCliCommand(`${baseName}-package.json`, `${baseName}-work-item.json`, `${baseName}-result.json`)}`);
    } catch (error) {
      window.alert(`개발 에이전트 입력 생성에 실패했습니다. ${error.message}`);
    }
  }

  function exportAllRunnableDevelopmentAgentInputs(project) {
    try {
      const workItems = getRunnableDevelopmentWorkItems(project);
      if (!workItems.length) {
        window.alert("실행 가능한 개발 work item이 없습니다.");
        return;
      }
      const run = createAutomationRun(project, workItems.map((item) => item.id));
      const batch = buildDevelopmentAgentBatch(project, workItems, run);
      downloadJson(batch, `${slugify(project.title)}-development-agent-batch.json`);
      saveState();
      renderWorkspace();
      window.alert(`${workItems.length}개 개발 work item의 자동화 패키지를 생성했습니다.`);
    } catch (error) {
      window.alert(`개발 에이전트 일괄 입력 생성에 실패했습니다. ${error.message}`);
    }
  }

  async function exportNextCodexDevelopmentPrompt(project, options = {}) {
    const [workItem] = getRunnableDevelopmentWorkItems(project);
    if (!workItem) {
      if (!options.quiet) {
        window.alert("Codex로 넘길 실행 가능한 개발 work item이 없습니다.");
      }
      return false;
    }
    return exportCodexDevelopmentPackage(project, workItem.id, "prompt", options);
  }

  async function exportCodexDevelopmentPackage(project, workItemId, outputType, options = {}) {
    const collaboration = ensureProjectCollaboration(project);
    const workItem = collaboration.workItems.find((item) => item.id === workItemId);
    if (!workItem) return false;
    try {
      const run = createAutomationRun(project, workItem.id, {
        status: outputType === "prompt" ? "running" : "queued",
        workItemStatus: outputType === "prompt" ? "in_review" : "exported",
      });
      const codexPackage = buildCodexDevelopmentPackage(project, workItem, {
        scope: workItem.acceptanceCriteria,
        requiredTests: ["node --test"],
      });
      codexPackage.automationRun = {
        id: run.id,
        projectId: run.projectId,
        workItemIds: [...run.workItemIds],
      };
      const baseName = `${slugify(project.title)}-${workItem.id}-codex`;
      if (outputType === "prompt") {
        const prompt = buildCodexPrompt(codexPackage);
        const started = await tryStartCodexRunner(project, codexPackage, prompt, options);
        if (!started) {
          downloadText(prompt, `${baseName}-prompt.md`, "text/markdown");
        }
      } else {
        downloadJson(codexPackage, `${baseName}-package.json`);
      }
      saveState();
      renderWorkspace();
      if (!options.quiet) {
        window.alert(outputType === "prompt" ? "Codex 작업을 시작했거나 프롬프트를 생성했습니다." : "Codex 개발 패키지를 생성했습니다.");
      }
      return true;
    } catch (error) {
      if (!options.quiet) {
        window.alert(`Codex 개발 패키지 생성에 실패했습니다. ${error.message}`);
      }
      return false;
    }
  }

  async function exportCodexReviewPackage(project, workItemId, outputType, options = {}) {
    const collaboration = ensureProjectCollaboration(project);
    const workItem = collaboration.workItems.find((item) => item.id === workItemId);
    if (!workItem) return false;
    try {
      const run = createReviewAutomationRun(project, workItem.id, {
        status: outputType === "prompt" ? "running" : "queued",
        workItemStatus: outputType === "prompt" ? "in_review" : "exported",
      });
      const codexPackage = buildCodexReviewPackage(project, workItem, {
        requiredCommands: ["node --test"],
      });
      codexPackage.automationRun = {
        id: run.id,
        projectId: run.projectId,
        workItemIds: [...run.workItemIds],
      };
      const baseName = `${slugify(project.title)}-${workItem.id}-codex-review`;
      if (outputType === "prompt") {
        const prompt = buildCodexReviewPrompt(codexPackage);
        const started = await tryStartCodexRunner(project, codexPackage, prompt, options);
        if (!started) {
          downloadText(prompt, `${baseName}-prompt.md`, "text/markdown");
        }
      } else {
        downloadJson(codexPackage, `${baseName}-package.json`);
      }
      saveState();
      renderWorkspace();
      if (!options.quiet) {
        window.alert(outputType === "prompt" ? "Codex 리뷰 작업을 시작했거나 프롬프트를 생성했습니다." : "Codex 리뷰 패키지를 생성했습니다.");
      }
      return true;
    } catch (error) {
      if (!options.quiet) {
        window.alert(`Codex 리뷰 패키지 생성에 실패했습니다. ${error.message}`);
      }
      return false;
    }
  }

  async function tryStartCodexRunner(project, codexPackage, prompt, options = {}) {
    try {
      const health = await fetchJsonWithTimeout("/api/runner/health", {}, 900);
      if (!health?.ok) return false;
      const response = await fetchJsonWithTimeout(
        "/api/codex-runs",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId: codexPackage.projectId,
            workItemId: codexPackage.workItem.id,
            codexPackage,
            prompt,
          }),
        },
        3000,
      );
      pollCodexRun(project, response.id);
      if (!options.quiet) {
        window.alert(`Codex 실행을 Runner에 요청했습니다.\nRun: ${response.id}`);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function pollCodexRun(project, runId) {
    if (!runId) return;
    try {
      const status = await fetchJsonWithTimeout(`/api/codex-runs/${encodeURIComponent(runId)}`, {}, 3000);
      if (status.status === "running") {
        window.setTimeout(() => pollCodexRun(project, runId), CODEX_RUN_POLL_MS);
        return;
      }
      const result = await fetchJsonWithTimeout(`/api/codex-runs/${encodeURIComponent(runId)}/result`, {}, 3000);
      importAgentResult(project, result);
      saveState();
      render();
      window.alert(status.status === "completed" ? "Codex 실행 결과를 반영했습니다." : "Codex 실행이 차단되어 결과를 반영했습니다.");
    } catch (error) {
      window.alert(`Codex 실행 상태 확인에 실패했습니다. ${error.message}`);
    }
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 3000) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function getActiveProject() {
    return state.projects.find((project) => project.id === state.activeProjectId) || null;
  }

  function validateImportedProject(project) {
    assertMatchesSchema(project.artifacts, productPackageSchema(), "Product Package");
  }

  function buildVersionDiffRows(baseArtifacts, targetArtifacts) {
    const rows = [
      {
        label: "타깃 사용자",
        before: baseArtifacts.analysis?.targetUser,
        after: targetArtifacts.analysis?.targetUser,
      },
      {
        label: "문제 정의",
        before: baseArtifacts.analysis?.problem,
        after: targetArtifacts.analysis?.problem,
      },
      {
        label: "차별화 포인트",
        before: baseArtifacts.analysis?.differentiation,
        after: targetArtifacts.analysis?.differentiation,
      },
      {
        label: "첫 번째 성공 지표",
        before: baseArtifacts.metrics?.[0],
        after: targetArtifacts.metrics?.[0],
      },
      {
        label: "MVP 포함 기능 수",
        before: `${baseArtifacts.mvp?.included?.length || 0}개`,
        after: `${targetArtifacts.mvp?.included?.length || 0}개`,
      },
      {
        label: "품질 점수",
        before: `${baseArtifacts.quality?.score || "-"}점`,
        after: `${targetArtifacts.quality?.score || "-"}점`,
      },
    ];

    return rows.map((row) => ({
      ...row,
      before: row.before || "없음",
      after: row.after || "없음",
      changed: String(row.before || "") !== String(row.after || ""),
    }));
  }

  function definition(term, description) {
    return `
      <div>
        <dt>${escapeHtml(term)}</dt>
        <dd>${escapeHtml(description)}</dd>
      </div>
    `;
  }

  function renderLogItem(item) {
    return `
      <div class="log-item">
        <strong>${escapeHtml(item.decision)}</strong>
        <p>${escapeHtml(item.reason)}</p>
        <time>${escapeHtml(formatDate(item.createdAt))}</time>
      </div>
    `;
  }

  function renderChangeItem(item) {
    return `
      <div class="log-item">
        <strong>${escapeHtml(item.changedSection)}</strong>
        <p>${escapeHtml(item.reason)}</p>
        <time>${escapeHtml(formatDate(item.createdAt))}</time>
      </div>
    `;
  }

  function pill(value) {
    const normalized = String(value).toLowerCase();
    const className = normalized.includes("높음")
      ? "high"
      : normalized.includes("중간")
        ? "medium"
        : "risk";
    return `<span class="priority-pill ${className}">${escapeHtml(value)}</span>`;
  }


})();
