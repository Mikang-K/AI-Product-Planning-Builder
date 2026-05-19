import {
  applyAgentResultToAutomation,
  buildDevelopmentAgentBatch,
  buildDevelopmentAgentCliCommand,
  buildDevelopmentAgentInput,
  createAutomationRun,
  getRunnableDevelopmentWorkItems,
} from "./automation.js";

import {
  buildCodexDevelopmentPackage,
  buildCodexPrompt,
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
  developmentPackageSchema,
  productPackageSchema,
  validationPackageSchema,
} from "./schemas.js";

import {
  downloadJson,
  downloadText,
  normalizeImportedProjects,
  readPersistedState,
  writePersistedState,
} from "./storage.js";

import {
  containsAny,
  deepClone,
  escapeHtml,
  formatDate,
  id,
  now,
  prioritizeMetric,
  slugify,
} from "./utils.js";

(function () {
  "use strict";

  const STORE_KEY = "ai-product-planning-agent:v1";
  const ALLOWED_LLM_ENDPOINTS = new Set(["https://api.openai.com/v1/chat/completions"]);
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
    { id: "history", label: "이력" },
  ];

  const progressSteps = [
    "아이디어 분석 중",
    "질문 생성 중",
    "핵심 가정 정리 중",
    "MVP 축소 중",
    "실험 설계 중",
    "개발 태스크 분해 중",
    "검증 리스크 점검 중",
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
      state.projects = [];
      state.activeProjectId = null;
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
      state.projects.unshift(project);
      state.activeProjectId = project.id;
      state.activeTab = els.autoCodexAfterGenerateToggle?.checked ? "agents" : "diagnosis";
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
      state.projects = [...importedProjects, ...state.projects];
      state.activeProjectId = importedProjects[0].id;
      state.activeTab = "diagnosis";
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

  function isAllowedLlmEndpoint(endpoint) {
    try {
      const url = new URL(endpoint);
      url.hash = "";
      url.search = "";
      return url.protocol === "https:" && ALLOWED_LLM_ENDPOINTS.has(url.toString());
    } catch {
      return false;
    }
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
      state.projects = [];
      state.activeProjectId = null;
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
    if (!state.projects.length) {
      els.projectList.innerHTML = `<p class="project-description">아직 생성된 프로젝트가 없습니다.</p>`;
      return;
    }

    els.projectList.innerHTML = state.projects
      .map(
        (project) => `
          <div
            class="project-item ${project.id === state.activeProjectId ? "active" : ""}"
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

    els.projectList.querySelectorAll("[data-project-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeProjectId = button.dataset.projectId;
        state.activeTab = "diagnosis";
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
    project.title = nextTitle;
    project.updatedAt = now();
    saveState();
    render();
  }

  function duplicateProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    const copy = deepClone(project);
    const createdAt = now();
    copy.id = id("project");
    copy.title = `${project.title} 복사본`;
    copy.createdAt = createdAt;
    copy.updatedAt = createdAt;
    copy.decisionLogs = [
      {
        id: id("decision"),
        decision: "프로젝트 복제",
        reason: `${project.title}에서 새 프로젝트를 만들었습니다.`,
        createdAt,
      },
      ...(Array.isArray(copy.decisionLogs) ? copy.decisionLogs : []),
    ];
    state.projects.unshift(copy);
    state.activeProjectId = copy.id;
    saveState();
    render();
  }

  function deleteProject(projectId) {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) return;
    if (!window.confirm(`${project.title} 프로젝트를 삭제할까요?`)) return;
    state.projects = state.projects.filter((item) => item.id !== projectId);
    if (state.activeProjectId === projectId) {
      state.activeProjectId = state.projects[0]?.id || null;
      state.activeTab = "diagnosis";
    }
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
    els.tabs.innerHTML = tabs
      .map(
        (tab) => `
          <button
            class="tab-button ${tab.id === state.activeTab ? "active" : ""}"
            type="button"
            data-tab-id="${escapeHtml(tab.id)}"
          >
            ${tab.label}
          </button>
        `,
      )
      .join("");

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
    const validatorItems = collaboration.workItems.filter((item) => item.agentRole === "validator");
    const automationRuns = Array.isArray(collaboration.automationRuns) ? collaboration.automationRuns : [];
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
        ${renderWorkItemGroup("Validation Work Items", validatorItems)}
        ${renderAutomationRuns(automationRuns)}
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
                  <p>${escapeHtml((run.findings || []).join(" "))}</p>
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
    const exportValidatorButton = document.getElementById("exportValidatorPackageButton");
    const runAllDeveloperButton = document.getElementById("runAllDeveloperAgentButton");
    const importResultButton = document.getElementById("importAgentResultButton");
    const importResultInput = document.getElementById("agentResultInput");

    exportFullButton?.addEventListener("click", () => exportCollaborationPackage(project, "full"));
    exportDeveloperButton?.addEventListener("click", () => exportCollaborationPackage(project, "developer"));
    exportValidatorButton?.addEventListener("click", () => exportCollaborationPackage(project, "validator"));
    runAllDeveloperButton?.addEventListener("click", () => exportAllRunnableDevelopmentAgentInputs(project));
    importResultButton?.addEventListener("click", () => {
      importResultInput.value = "";
      importResultInput.click();
    });
    importResultInput?.addEventListener("change", (event) => handleAgentResultImport(project, event));

    document.querySelectorAll("[data-work-item-status-id]").forEach((select) => {
      select.addEventListener("change", () => {
        const item = collaboration.workItems.find((workItem) => workItem.id === select.dataset.workItemStatusId);
        if (!item) return;
        item.status = select.value;
        item.updatedAt = now();
        collaboration.updatedAt = now();
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

  function migrateProjectArtifacts(project) {
    if (!project?.artifacts) return;
    project.artifacts.development ||= buildDevelopmentPackage(project.artifacts);
    project.artifacts.validation ||= buildValidationPackage(project.artifacts);
    project.artifacts.agentPackage ||= buildAgentPackage(project.artifacts);
    project.artifacts.prd = buildPrd(project.artifacts);
    project.artifacts.agentPackage = buildAgentPackage(project.artifacts);
    project.artifacts.quality = buildQualityReport(project.artifacts);
    if (Array.isArray(project.versions)) {
      project.versions.forEach((version) => {
        if (!version.artifacts) return;
        version.artifacts.development ||= buildDevelopmentPackage(version.artifacts);
        version.artifacts.validation ||= buildValidationPackage(version.artifacts);
        version.artifacts.agentPackage ||= buildAgentPackage(version.artifacts);
        version.artifacts.prd ||= buildPrd(version.artifacts);
        version.artifacts.agentPackage = buildAgentPackage(version.artifacts);
        version.artifacts.quality = buildQualityReport(version.artifacts);
      });
    }
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

  const PlannerEngine = {
    createProject(idea) {
      const createdAt = now();
      const profile = inferProfile(idea);
      const artifacts = buildArtifacts(idea, profile);
      const project = {
        id: id("project"),
        title: makeTitle(idea, profile),
        description: idea,
        createdAt,
        updatedAt: createdAt,
        currentVersion: 1,
        artifacts,
        decisionLogs: initialDecisionLogs(artifacts),
        changeLogs: [],
        versions: [
          {
            version: 1,
            createdAt,
            feedback: "",
            changedSections: [
              "아이디어 진단",
              "질문",
              "가정",
              "MVP",
              "시나리오",
              "실험",
              "개발 패키지",
              "검증 리포트",
              "에이전트 패키지",
              "품질 리포트",
              "PRD",
            ],
            artifacts: deepClone(artifacts),
          },
        ],
      };
      return project;
    },

    applyFeedback(project, feedback) {
      const previous = deepClone(project.artifacts);
      const next = deepClone(project.artifacts);
      const changedSections = [];

      if (containsAny(feedback, ["직장인", "회사원", "퇴근"])) {
        next.analysis.targetUser = "시간 제약이 큰 직장인 사용자";
        next.scenario.userBackground =
          "평일에는 업무 일정이 빡빡하지만 퇴근 후 작은 진전을 만들고 싶은 직장인이다.";
        next.experiment.targetUser = "직장인 타깃 커뮤니티와 업무 생산성 관심 사용자";
        changedSections.push("타깃 사용자", "사용자 시나리오", "검증 실험 대상");
      } else if (containsAny(feedback, ["학생", "대학생", "수험생"])) {
        next.analysis.targetUser = "학습 목표가 명확하지만 실행 관리가 필요한 학생 사용자";
        next.scenario.userBackground =
          "시험이나 과제 일정에 맞춰 계획을 세워야 하지만 꾸준히 지키기 어려운 학생이다.";
        next.experiment.targetUser = "학생 커뮤니티와 시험 준비 사용자";
        changedSections.push("타깃 사용자", "사용자 시나리오", "검증 실험 대상");
      }

      if (containsAny(feedback, ["실행", "지속", "완료", "습관"])) {
        next.analysis.problem = "계획을 세우는 것보다 실제로 지속하고 조정하는 과정이 어렵다.";
        next.analysis.differentiation = "초기 계획 생성보다 실패 후 복구와 계획 조정에 집중한다.";
        next.assumptions[0].content =
          "사용자는 완벽한 계획보다 실패 후 다시 이어갈 수 있는 조정 경험에 더 큰 가치를 느낀다.";
        next.metrics = prioritizeMetric(next.metrics, "계획 완료율");
        changedSections.push("문제 정의", "차별화 포인트", "핵심 가정", "성공 지표");
      }

      if (containsAny(feedback, ["유료", "구독", "결제"])) {
        next.analysis.monetizationPotential =
          "초기에는 무료 사용으로 핵심 가치 검증을 우선하고, 반복 사용이 확인되면 월 구독 또는 프리미엄 기능으로 확장한다.";
        changedSections.push("수익화 가능성");
      }

      if (containsAny(feedback, ["커뮤니티", "친구", "랭킹"])) {
        next.mvp.excluded = next.mvp.excluded.map((feature) =>
          ["커뮤니티", "친구 추가", "랭킹"].some((word) => feature.name.includes(word))
            ? {
                ...feature,
                reason:
                  "사용자 요청으로 후보 기능에는 남기되, MVP에서는 핵심 가정 검증 이후로 미룬다.",
              }
            : feature,
        );
        changedSections.push("제외 기능");
      }

      if (!changedSections.length) {
        next.questions[0].question = "이번 변경에서 가장 중요하게 반영해야 하는 제품 판단은 무엇인가요?";
        next.questions[0].reason =
          "입력 내용이 넓게 해석될 수 있어, 다음 업데이트에서 영향 범위를 더 정확히 좁히기 위함입니다.";
        changedSections.push("정보 보완 질문");
      }

      next.development = buildDevelopmentPackage(next);
      next.validation = buildValidationPackage(next);
      next.prd = buildPrd(next);
      next.agentPackage = buildAgentPackage(next);
      next.quality = buildQualityReport(next);
      project.artifacts = next;
      project.currentVersion += 1;

      const createdAt = now();
      const uniqueChangedSections = [...new Set([...changedSections, "PRD"])];
      project.changeLogs.unshift({
        id: id("change"),
        changedSection: uniqueChangedSections.join(", "),
        before: summarizeArtifacts(previous),
        after: summarizeArtifacts(next),
        reason: feedback,
        createdAt,
      });
      project.decisionLogs.unshift({
        id: id("decision"),
        decision: `사용자 피드백을 v${project.currentVersion}에 반영`,
        reason: uniqueChangedSections.join(", "),
        createdAt,
      });
      project.versions.unshift({
        version: project.currentVersion,
        createdAt,
        feedback,
        changedSections: uniqueChangedSections,
        artifacts: deepClone(next),
      });
    },
  };

  const LlmClient = {
    async requestJson(config, messages) {
      if (!isAllowedLlmEndpoint(config.endpoint)) {
        throw new Error("허용된 HTTPS LLM Endpoint만 사용할 수 있습니다.");
      }

      const payload = {
        model: config.model,
        messages,
        temperature: 1.0,
        response_format: { type: "json_object" },
      };

      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${responseText.slice(0, 220)}`);
      }

      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error("API 응답이 JSON이 아닙니다.");
      }

      const content = data.choices?.[0]?.message?.content || data.output_text || data.content;
      if (!content) {
        throw new Error("API 응답에서 message content를 찾지 못했습니다.");
      }

      return parseJsonContent(content);
    },
  };

  const LlmEngine = {
    async createProject(idea, config, updateProgress) {
      const createdAt = now();
      const profile = inferProfile(idea);
      const fallback = buildArtifacts(idea, profile);
      const steps = [
        "기획자 에이전트 호출 중",
        "개발 에이전트 호출 중",
        "검증 에이전트 호출 중",
        "산출물 정규화 중",
      ];

      updateProgress(steps[0], 0, steps.length);
      const productResponse = await LlmClient.requestJson(config, plannerMessages(idea, profile));
      const productPackage = productResponse.productPackage || productResponse;
      assertMatchesSchema(productPackage, productPackageSchema(), "Product Package");
      const artifacts = normalizeProductArtifacts(productPackage, fallback);

      updateProgress(steps[1], 1, steps.length);
      const developmentResponse = await LlmClient.requestJson(config, developerMessages(artifacts));
      const developmentPackage = developmentResponse.developmentPackage || developmentResponse;
      assertMatchesSchema(developmentPackage, developmentPackageSchema(), "Development Package");
      artifacts.development = normalizeDevelopmentPackage(
        developmentPackage,
        buildDevelopmentPackage(artifacts),
      );

      updateProgress(steps[2], 2, steps.length);
      const validationResponse = await LlmClient.requestJson(config, validatorMessages(artifacts));
      const validationPackage = validationResponse.validationPackage || validationResponse;
      assertMatchesSchema(validationPackage, validationPackageSchema(), "Validation Package");
      artifacts.validation = normalizeValidationPackage(
        validationPackage,
        buildValidationPackage(artifacts),
      );

      updateProgress(steps[3], 3, steps.length);
      artifacts.prd = typeof artifacts.prd === "string" && artifacts.prd.trim() ? artifacts.prd : buildPrd(artifacts);
      artifacts.agentPackage = buildAgentPackage(artifacts);
      artifacts.quality = buildQualityReport(artifacts);

      return {
        id: id("project"),
        title: makeTitle(idea, profile),
        description: idea,
        createdAt,
        updatedAt: createdAt,
        currentVersion: 1,
        artifacts,
        decisionLogs: [
          {
            id: id("decision"),
            decision: "LLM API로 초기 산출물 생성",
            reason: `${config.model} 모델을 사용해 기획자, 개발, 검증 에이전트 산출물을 생성했다.`,
            createdAt,
          },
          ...initialDecisionLogs(artifacts),
        ],
        changeLogs: [],
        versions: [
          {
            version: 1,
            createdAt,
            feedback: "",
            changedSections: [
              "아이디어 진단",
              "질문",
              "가정",
              "MVP",
              "시나리오",
              "실험",
              "개발 패키지",
              "검증 리포트",
              "에이전트 패키지",
              "품질 리포트",
              "PRD",
            ],
            artifacts: deepClone(artifacts),
          },
        ],
      };
    },

    async applyFeedback(project, feedback, config, updateProgress) {
      const previous = deepClone(project.artifacts);
      const steps = [
        "LLM 피드백 반영 중",
        "개발 패키지 재생성 중",
        "검증 리포트 재생성 중",
        "버전 저장 중",
      ];

      updateProgress(steps[0], 0, steps.length);
      const productResponse = await LlmClient.requestJson(config, updatePlannerMessages(project.artifacts, feedback));
      const productPackage = productResponse.productPackage || productResponse;
      assertMatchesSchema(productPackage, productPackageSchema(), "Product Package");
      const next = normalizeProductArtifacts(productPackage, project.artifacts);

      updateProgress(steps[1], 1, steps.length);
      const developmentResponse = await LlmClient.requestJson(config, developerMessages(next));
      const developmentPackage = developmentResponse.developmentPackage || developmentResponse;
      assertMatchesSchema(developmentPackage, developmentPackageSchema(), "Development Package");
      next.development = normalizeDevelopmentPackage(
        developmentPackage,
        buildDevelopmentPackage(next),
      );

      updateProgress(steps[2], 2, steps.length);
      const validationResponse = await LlmClient.requestJson(config, validatorMessages(next));
      const validationPackage = validationResponse.validationPackage || validationResponse;
      assertMatchesSchema(validationPackage, validationPackageSchema(), "Validation Package");
      next.validation = normalizeValidationPackage(
        validationPackage,
        buildValidationPackage(next),
      );

      updateProgress(steps[3], 3, steps.length);
      next.prd = typeof next.prd === "string" && next.prd.trim() ? next.prd : buildPrd(next);
      next.agentPackage = buildAgentPackage(next);
      next.quality = buildQualityReport(next);

      project.artifacts = next;
      project.currentVersion += 1;
      const createdAt = now();
      const changedSections = inferChangedSections(previous, next);
      project.changeLogs.unshift({
        id: id("change"),
        changedSection: changedSections.join(", "),
        before: summarizeArtifacts(previous),
        after: summarizeArtifacts(next),
        reason: feedback,
        createdAt,
      });
      project.decisionLogs.unshift({
        id: id("decision"),
        decision: `LLM 피드백을 v${project.currentVersion}에 반영`,
        reason: changedSections.join(", "),
        createdAt,
      });
      project.versions.unshift({
        version: project.currentVersion,
        createdAt,
        feedback,
        changedSections,
        artifacts: deepClone(next),
      });
    },
  };

  function plannerMessages(idea, profile) {
    return [
      {
        role: "system",
        content:
          "당신은 제품 기획자 에이전트입니다. 사용자의 아이디어를 구조화된 Product Package JSON으로만 반환하세요. 설명 문장, 마크다운, 코드블록 없이 JSON만 반환합니다.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Create Product Package",
            idea,
            inferredContext: profile,
            outputContract: {
              analysis: {
                oneLineDescription: "string",
                targetUser: "string",
                problem: "string",
                existingAlternatives: "string",
                solution: "string",
                valueProposition: "string",
                differentiation: "string",
                monetizationPotential: "string",
                implementationDifficulty: "string",
                riskiestAssumption: "string",
              },
              questions: [{ question: "string", reason: "string" }],
              assumptions: [
                {
                  content: "string",
                  importance: "높음|중간|낮음",
                  uncertainty: "높음|중간|낮음",
                  validationDifficulty: "높음|중간|낮음",
                  validationMethod: "string",
                },
              ],
              mvp: {
                included: [{ name: "string", description: "string", priority: "must_have", reason: "string" }],
                excluded: [{ name: "string", reason: "string" }],
              },
              scenario: {
                userBackground: "string",
                problemSituation: "string",
                trigger: "string",
                flow: "string",
                expectedChange: "string",
                dropOffRisk: "string",
              },
              metrics: ["string"],
              experiment: {
                hypothesis: "string",
                method: "string",
                targetUser: "string",
                duration: "string",
                successCriteria: "string",
                failureCriteria: "string",
                nextAction: "string",
              },
              prd: "string markdown",
            },
            constraints: [
              "questions must have exactly 3 items",
              "mvp.included must have 3 to 5 items",
              "assumptions must include high importance and high uncertainty items",
              "return Korean content",
            ],
          },
          null,
          2,
        ),
      },
    ];
  }

  function developerMessages(artifacts) {
    return [
      {
        role: "system",
        content:
          "당신은 개발 에이전트입니다. Product Package를 구현 가능한 Development Package JSON으로만 반환하세요. 설명 문장 없이 JSON만 반환합니다.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Create Development Package",
            productPackage: {
              analysis: artifacts.analysis,
              mvp: artifacts.mvp,
              experiment: artifacts.experiment,
              prd: artifacts.prd,
            },
            outputSchema: developmentPackageSchema(),
            requiredShape: {
              architecture: {
                summary: "string",
                frontend: "string",
                backend: "string",
                storage: "string",
                aiLayer: "string",
              },
              dataModels: [{ name: "string", fields: ["string"] }],
              apiSpec: [{ method: "GET|POST|PATCH|DELETE", path: "string", description: "string" }],
              tasks: [{ title: "string", priority: "높음|중간|낮음", difficulty: "높음|중간|낮음", reason: "string" }],
              pageStructure: ["string"],
              technicalRisks: ["string"],
            },
          },
          null,
          2,
        ),
      },
    ];
  }

  function updatePlannerMessages(currentArtifacts, feedback) {
    return [
      {
        role: "system",
        content:
          "당신은 제품 기획자 에이전트입니다. 기존 Product Package에 사용자 피드백을 반영해 전체 Product Package JSON만 반환하세요. 변경 영향이 있는 섹션을 일관되게 갱신하세요.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Update Product Package",
            feedback,
            currentProductPackage: {
              analysis: currentArtifacts.analysis,
              questions: currentArtifacts.questions,
              assumptions: currentArtifacts.assumptions,
              mvp: currentArtifacts.mvp,
              scenario: currentArtifacts.scenario,
              metrics: currentArtifacts.metrics,
              experiment: currentArtifacts.experiment,
              prd: currentArtifacts.prd,
            },
            outputSchema: productPackageSchema(),
            constraints: [
              "return Korean content",
              "questions must have exactly 3 items",
              "mvp.included must have 3 to 5 items",
              "update PRD to match changed sections",
            ],
          },
          null,
          2,
        ),
      },
    ];
  }

  function validatorMessages(artifacts) {
    return [
      {
        role: "system",
        content:
          "당신은 검증 에이전트입니다. 제품 기획과 개발 산출물을 냉정하게 검토하고 Validation Package JSON으로만 반환하세요. 설명 문장 없이 JSON만 반환합니다.",
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Create Validation Package",
            productPackage: {
              analysis: artifacts.analysis,
              assumptions: artifacts.assumptions,
              mvp: artifacts.mvp,
              experiment: artifacts.experiment,
            },
            developmentPackage: artifacts.development,
            outputSchema: validationPackageSchema(),
            requiredShape: {
              prdScore: "number 0-100",
              summary: "string",
              mvpFit: { status: "string", reason: "string" },
              risks: [{ title: "string", severity: "높음|중간|낮음", mitigation: "string" }],
              experimentReview: ["string"],
              launchChecklist: ["string"],
              recommendations: ["string"],
            },
          },
          null,
          2,
        ),
      },
    ];
  }

  function parseJsonContent(content) {
    if (typeof content === "object") return content;
    const trimmed = String(content).trim();
    const withoutFence = trimmed
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```$/i, "")
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch {
      const start = withoutFence.indexOf("{");
      const end = withoutFence.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error("message content를 JSON으로 파싱하지 못했습니다.");
    }
  }

  function normalizeProductArtifacts(source, fallback) {
    const normalized = deepClone(fallback);
    const analysis = source.analysis || {};
    normalized.analysis = {
      ...normalized.analysis,
      ...pickStringFields(analysis, Object.keys(normalized.analysis)),
    };
    normalized.questions = normalizeQuestions(source.questions, normalized.questions);
    normalized.assumptions = normalizeAssumptions(source.assumptions, normalized.assumptions);
    normalized.mvp = normalizeMvp(source.mvp, normalized.mvp);
    normalized.scenario = {
      ...normalized.scenario,
      ...pickStringFields(source.scenario || {}, Object.keys(normalized.scenario)),
    };
    normalized.metrics = normalizeStringArray(source.metrics, normalized.metrics, 3);
    normalized.experiment = {
      ...normalized.experiment,
      ...pickStringFields(source.experiment || {}, Object.keys(normalized.experiment)),
    };
    normalized.prd = typeof source.prd === "string" ? source.prd : buildPrd(normalized);
    normalized.development = null;
    normalized.validation = null;
    normalized.agentPackage = null;
    normalized.quality = null;
    return normalized;
  }

  function normalizeDevelopmentPackage(source, fallback) {
    const normalized = deepClone(fallback);
    normalized.architecture = {
      ...normalized.architecture,
      ...pickStringFields(source.architecture || {}, Object.keys(normalized.architecture)),
    };
    normalized.dataModels = normalizeNamedFieldList(source.dataModels, normalized.dataModels);
    normalized.apiSpec = normalizeApiSpec(source.apiSpec, normalized.apiSpec);
    normalized.tasks = normalizeTasks(source.tasks, normalized.tasks);
    normalized.pageStructure = normalizeStringArray(source.pageStructure, normalized.pageStructure, 1);
    normalized.technicalRisks = normalizeStringArray(source.technicalRisks, normalized.technicalRisks, 1);
    return normalized;
  }

  function normalizeValidationPackage(source, fallback) {
    const normalized = deepClone(fallback);
    normalized.prdScore = Number.isFinite(Number(source.prdScore)) ? Math.max(0, Math.min(100, Number(source.prdScore))) : normalized.prdScore;
    normalized.summary = typeof source.summary === "string" ? source.summary : normalized.summary;
    normalized.mvpFit = {
      ...normalized.mvpFit,
      ...pickStringFields(source.mvpFit || {}, Object.keys(normalized.mvpFit)),
    };
    normalized.risks = normalizeRisks(source.risks, normalized.risks);
    normalized.experimentReview = normalizeStringArray(source.experimentReview, normalized.experimentReview, 1);
    normalized.launchChecklist = normalizeStringArray(source.launchChecklist, normalized.launchChecklist, 3);
    normalized.recommendations = normalizeStringArray(source.recommendations, normalized.recommendations, 1);
    return normalized;
  }

  function pickStringFields(source, fields) {
    return fields.reduce((result, field) => {
      if (typeof source[field] === "string" && source[field].trim()) {
        result[field] = source[field].trim();
      }
      return result;
    }, {});
  }

  function normalizeStringArray(value, fallback, minLength) {
    const list = Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()) : [];
    return list.length >= minLength ? list.map((item) => item.trim()) : fallback;
  }

  function normalizeQuestions(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            question: String(item?.question || "").trim(),
            reason: String(item?.reason || "").trim(),
          }))
          .filter((item) => item.question && item.reason)
      : [];
    return list.length === 3 ? list : fallback;
  }

  function normalizeAssumptions(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            content: String(item?.content || item?.assumption || "").trim(),
            importance: normalizeLevel(item?.importance),
            uncertainty: normalizeLevel(item?.uncertainty),
            validationDifficulty: normalizeLevel(item?.validationDifficulty || item?.validation_difficulty),
            validationMethod: String(item?.validationMethod || item?.validation_method || "").trim(),
          }))
          .filter((item) => item.content && item.validationMethod)
      : [];
    return list.length >= 3 ? list : fallback;
  }

  function normalizeMvp(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const included = Array.isArray(value.included)
      ? value.included
          .map((item) => ({
            name: String(item?.name || "").trim(),
            description: String(item?.description || "").trim(),
            priority: String(item?.priority || "must_have").trim(),
            reason: String(item?.reason || "").trim(),
          }))
          .filter((item) => item.name && item.description && item.reason)
      : [];
    const excluded = Array.isArray(value.excluded)
      ? value.excluded
          .map((item) => ({
            name: String(item?.name || "").trim(),
            reason: String(item?.reason || "").trim(),
          }))
          .filter((item) => item.name && item.reason)
      : [];
    return included.length >= 3 && included.length <= 5 && excluded.length ? { included, excluded } : fallback;
  }

  function normalizeNamedFieldList(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            name: String(item?.name || "").trim(),
            fields: Array.isArray(item?.fields) ? item.fields.map(String) : [],
          }))
          .filter((item) => item.name && item.fields.length)
      : [];
    return list.length ? list : fallback;
  }

  function normalizeApiSpec(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            method: String(item?.method || "GET").trim().toUpperCase(),
            path: String(item?.path || "").trim(),
            description: String(item?.description || "").trim(),
          }))
          .filter((item) => item.path && item.description)
      : [];
    return list.length >= 2 ? list : fallback;
  }

  function normalizeTasks(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            title: String(item?.title || "").trim(),
            priority: normalizeLevel(item?.priority),
            difficulty: normalizeLevel(item?.difficulty),
            reason: String(item?.reason || "").trim(),
          }))
          .filter((item) => item.title && item.reason)
      : [];
    return list.length >= 4 ? list : fallback;
  }

  function normalizeRisks(value, fallback) {
    const list = Array.isArray(value)
      ? value
          .map((item) => ({
            title: String(item?.title || "").trim(),
            severity: normalizeLevel(item?.severity),
            mitigation: String(item?.mitigation || "").trim(),
          }))
          .filter((item) => item.title && item.mitigation)
      : [];
    return list.length >= 2 ? list : fallback;
  }

  function normalizeLevel(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("high") || text.includes("높")) return "높음";
    if (text.includes("low") || text.includes("낮")) return "낮음";
    return "중간";
  }

  function inferProfile(idea) {
    const profiles = [
      {
        key: "study",
        keywords: ["공부", "학습", "스터디", "시험", "토익", "교육"],
        productNoun: "학습 플래너",
        targetUser: "혼자 목표를 관리해야 하는 학습자",
        problem: "계획을 세워도 실행을 지속하기 어렵다.",
        existingAlternatives: "캘린더, 노션 템플릿, 스터디 앱, 종이 플래너",
        solution: "목표와 제약을 바탕으로 실행 가능한 계획을 만들고 상황에 맞게 조정한다.",
        value: "실패해도 다시 이어갈 수 있는 개인화 계획 경험",
        differentiation: "계획 생성보다 계획 조정과 지속에 집중한다.",
        action: "계획을 생성하고 완료 여부에 따라 자동으로 조정한다",
      },
      {
        key: "productivity",
        keywords: ["업무", "생산성", "할 일", "태스크", "일정", "프로젝트"],
        productNoun: "생산성 도구",
        targetUser: "여러 업무를 동시에 관리하는 개인 작업자",
        problem: "해야 할 일은 많지만 우선순위와 실행 순서가 흐려진다.",
        existingAlternatives: "투두 앱, 캘린더, 업무 관리 보드, 메모 앱",
        solution: "목표, 마감일, 에너지를 반영해 오늘 실행할 일을 정리한다.",
        value: "복잡한 일을 당장 실행 가능한 단위로 줄여주는 작업 흐름",
        differentiation: "업무를 더 추가하기보다 줄이고 정렬하는 데 집중한다.",
        action: "업무를 실행 가능한 단위로 재구성한다",
      },
      {
        key: "commerce",
        keywords: ["쇼핑", "구매", "커머스", "가격", "리뷰", "상품"],
        productNoun: "구매 의사결정 도구",
        targetUser: "구매 전 비교 시간이 긴 소비자",
        problem: "정보가 많아도 자신에게 맞는 선택인지 판단하기 어렵다.",
        existingAlternatives: "가격 비교 서비스, 리뷰 사이트, 쇼핑몰 검색",
        solution: "조건과 우선순위를 바탕으로 후보를 줄이고 선택 이유를 설명한다.",
        value: "구매 실패 가능성을 낮추는 개인화 비교 경험",
        differentiation: "상품 추천보다 선택 기준과 제외 이유를 명확히 보여준다.",
        action: "후보를 비교하고 선택 근거를 정리한다",
      },
      {
        key: "health",
        keywords: ["운동", "건강", "식단", "다이어트", "수면", "습관"],
        productNoun: "건강 루틴 코치",
        targetUser: "건강 목표는 있지만 루틴을 지속하기 어려운 사용자",
        problem: "무리한 계획 때문에 초기에 포기하거나 다시 시작하지 못한다.",
        existingAlternatives: "운동 앱, 식단 앱, 습관 추적 앱, 헬스 콘텐츠",
        solution: "현재 상태에 맞춰 작은 루틴을 제안하고 실패 시 강도를 낮춘다.",
        value: "부담 없이 다시 시작할 수 있는 건강 루틴 관리",
        differentiation: "성과 압박보다 재시작 가능성에 집중한다.",
        action: "루틴을 제안하고 사용자의 실행 상태에 맞춰 조정한다",
      },
    ];

    const matched =
      profiles.find((profile) => containsAny(idea, profile.keywords)) ||
      {
        key: "generic",
        productNoun: "AI 제품 기획안",
        targetUser: "명확한 문제를 빠르게 검증하고 싶은 초기 사용자",
        problem: "아이디어는 있지만 제품 범위와 검증 순서를 정하기 어렵다.",
        existingAlternatives: "메모, 문서 템플릿, 일반 LLM 상담, 스프레드시트",
        solution: "아이디어를 구조화하고 핵심 가정과 MVP 범위를 제안한다.",
        value: "아이디어를 실행 가능한 제품 검증 계획으로 바꾸는 경험",
        differentiation: "답변이 아니라 기획 프로세스와 산출물을 제공한다.",
        action: "아이디어를 구조화된 실행 계획으로 변환한다",
      };

    if (containsAny(idea, ["직장인", "회사원", "퇴근"])) {
      matched.targetUser = `시간 제약이 큰 직장인 ${matched.targetUser}`;
    }

    return matched;
  }

  function buildArtifacts(idea, profile) {
    const analysis = {
      oneLineDescription: `${profile.targetUser}를 위한 ${profile.productNoun}`,
      targetUser: profile.targetUser,
      problem: profile.problem,
      existingAlternatives: profile.existingAlternatives,
      solution: profile.solution,
      valueProposition: profile.value,
      differentiation: profile.differentiation,
      monetizationPotential:
        "초기에는 무료 MVP로 사용 의향을 검증하고, 반복 사용 또는 고급 자동화가 확인되면 구독형 모델을 검토한다.",
      implementationDifficulty:
        "중간. 입력 구조화, 산출물 생성, 변경 이력 관리는 작게 시작할 수 있지만 품질 안정화에는 반복 평가가 필요하다.",
      riskiestAssumption: "사용자가 생성된 결과를 실제 다음 행동으로 이어갈 만큼 신뢰할 것이다.",
    };

    const questions = [
      {
        question: "가장 먼저 만족시켜야 할 핵심 사용자는 누구인가요?",
        reason: "타깃이 좁아질수록 MVP 기능, 메시지, 검증 채널이 선명해집니다.",
      },
      {
        question: "사용자는 현재 이 문제를 어떤 방식으로 해결하고 있나요?",
        reason: "기존 대안과 비교해야 차별화 포인트와 전환 이유를 판단할 수 있습니다.",
      },
      {
        question: "사용자가 가장 자주 실패하거나 포기하는 순간은 언제인가요?",
        reason: "제품이 반드시 해결해야 하는 핵심 순간을 찾기 위한 질문입니다.",
      },
    ];

    const assumptions = [
      {
        content: "사용자는 AI가 만든 결과를 실제 행동 계획으로 사용할 만큼 신뢰한다.",
        importance: "높음",
        uncertainty: "높음",
        validationDifficulty: "중간",
        validationMethod: "랜딩페이지 신청 테스트와 샘플 결과물 평가",
      },
      {
        content: "사용자는 직접 처음부터 정리하는 것보다 구조화된 초안을 선호한다.",
        importance: "높음",
        uncertainty: "중간",
        validationDifficulty: "낮음",
        validationMethod: "사용자 인터뷰와 클릭 프로토타입 테스트",
      },
      {
        content: "MVP의 핵심 가치는 많은 기능보다 범위 축소와 다음 액션 제안에서 나온다.",
        importance: "높음",
        uncertainty: "높음",
        validationDifficulty: "중간",
        validationMethod: "초기 사용자 5명 과업 수행 관찰",
      },
      {
        content: "사용자는 결과가 변경된 이유를 볼 때 산출물을 더 신뢰한다.",
        importance: "중간",
        uncertainty: "중간",
        validationDifficulty: "낮음",
        validationMethod: "결정 로그 노출 여부 A/B 테스트",
      },
    ];

    const mvp = {
      included: [
        {
          name: "아이디어 입력",
          description: "사용자가 한 줄 또는 짧은 문장으로 제품 아이디어를 입력한다.",
          priority: "must_have",
          reason: "전체 기획 프로세스의 시작점이며 가장 낮은 진입 장벽이다.",
        },
        {
          name: "아이디어 구조화",
          description: "타깃, 문제, 해결책, 가치 제안, 차별점을 제품 기획 요소로 분해한다.",
          priority: "must_have",
          reason: "단순 답변과 구분되는 핵심 산출물이다.",
        },
        {
          name: "MVP 범위 축소",
          description: "핵심 검증에 필요한 기능만 남기고 제외 이유를 기록한다.",
          priority: "must_have",
          reason: "초기 사용자가 가장 어려워하는 범위 조정을 직접 해결한다.",
        },
        {
          name: "검증 실험 및 PRD 생성",
          description: "가장 위험한 가정을 검증할 실험과 PRD 초안을 생성한다.",
          priority: "must_have",
          reason: "아이디어를 다음 행동 가능한 문서로 전환한다.",
        },
      ],
      excluded: [
        {
          name: "팀 협업",
          reason: "초기 핵심 가정 검증에는 단일 사용자 흐름이 더 중요하다.",
        },
        {
          name: "결제",
          reason: "반복 사용과 가치 인지가 확인된 뒤 검토하는 편이 적절하다.",
        },
        {
          name: "커뮤니티",
          reason: "네트워크 효과 기능은 초기 검증 비용이 높고 핵심 문제와 거리가 있다.",
        },
        {
          name: "복잡한 통계 대시보드",
          reason: "MVP에서는 산출물 생성과 업데이트 품질 검증이 우선이다.",
        },
      ],
    };

    const scenario = {
      userBackground: `${profile.targetUser}는 ${profile.problem}`,
      problemSituation: `기존에는 ${profile.existingAlternatives}에 의존하지만, 결과가 흩어지고 다음 행동으로 이어지지 않는다.`,
      trigger: `사용자는 "${idea}"라는 아이디어를 입력하고 첫 기획 산출물을 요청한다.`,
      flow: `에이전트는 아이디어를 구조화하고, 정보 가치가 높은 질문 3개를 제시한 뒤, 핵심 가정과 MVP 범위를 정리한다. 이어서 검증 실험과 PRD 초안을 생성한다.`,
      expectedChange: "사용자는 무엇을 만들지보다 무엇을 먼저 검증해야 하는지 명확히 알게 된다.",
      dropOffRisk: "산출물이 추상적이거나 제외 이유가 약하면 사용자는 일반 LLM 답변과 차이를 느끼지 못할 수 있다.",
    };

    const metrics = [
      "아이디어 입력 후 PRD 생성 완료율",
      "생성된 질문에 대한 사용자 답변률",
      "MVP 제외 기능 이유 확인률",
      "검증 실험 저장 또는 복사율",
      "PRD 업데이트 재사용률",
    ];

    const experiment = {
      hypothesis: "사용자는 한 줄 아이디어만으로 생성된 구조화 기획 산출물에 가치를 느낀다.",
      method: "클릭 가능한 MVP를 제공하고, PRD 생성 후 검증 실험 저장 또는 피드백 입력 행동을 측정한다.",
      targetUser: profile.targetUser,
      duration: "3일",
      successCriteria: "방문자 100명 중 20명 이상이 PRD를 생성하고, 8명 이상이 피드백 업데이트를 시도한다.",
      failureCriteria: "PRD 생성 완료율 10% 미만 또는 피드백 업데이트 시도 3명 미만",
      nextAction: "성공 시 LLM 기반 품질 개선과 프로젝트 저장 기능을 강화하고, 실패 시 타깃과 첫 화면 메시지를 재정의한다.",
    };

    const artifacts = {
      analysis,
      questions,
      assumptions,
      mvp,
      scenario,
      metrics,
      experiment,
      development: null,
      validation: null,
      agentPackage: null,
      quality: null,
      prd: "",
    };
    artifacts.development = buildDevelopmentPackage(artifacts);
    artifacts.validation = buildValidationPackage(artifacts);
    artifacts.prd = buildPrd(artifacts);
    artifacts.agentPackage = buildAgentPackage(artifacts);
    artifacts.quality = buildQualityReport(artifacts);
    return artifacts;
  }

  function buildDevelopmentPackage(artifacts) {
    const featureTasks = artifacts.mvp.included.map((feature, index) => ({
      title: `${feature.name} 구현`,
      priority: index < 2 ? "높음" : "중간",
      difficulty: index < 2 ? "중간" : "낮음",
      reason: feature.reason,
    }));

    return {
      architecture: {
        summary: "정적 UI에서 시작하되, 에이전트 엔진과 저장소를 분리해 API/DB 전환이 쉬운 구조로 설계한다.",
        frontend: "탭 기반 산출물 뷰, 프로젝트 목록, 피드백 입력, export 액션으로 구성한다.",
        backend: "초기에는 브라우저 로컬 엔진으로 동작하고, 이후 /api/projects, /api/generate, /api/feedback 엔드포인트로 분리한다.",
        storage: "MVP는 localStorage를 사용하고, 확장 시 Project, Artifact, Version, DecisionLog 테이블로 이전한다.",
        aiLayer: "PlannerEngine 인터페이스를 LLM 어댑터로 교체할 수 있게 유지한다.",
      },
      dataModels: [
        {
          name: "Project",
          fields: ["id", "title", "description", "createdAt", "updatedAt", "currentVersion"],
        },
        {
          name: "Artifact",
          fields: ["projectId", "analysis", "questions", "assumptions", "mvp", "scenario", "experiment", "prd"],
        },
        {
          name: "Version",
          fields: ["projectId", "version", "feedback", "changedSections", "artifacts", "createdAt"],
        },
        {
          name: "DecisionLog",
          fields: ["projectId", "decision", "reason", "createdAt"],
        },
      ],
      apiSpec: [
        {
          method: "POST",
          path: "/api/projects",
          description: "아이디어를 입력받아 프로젝트와 초기 기획 산출물을 생성한다.",
        },
        {
          method: "GET",
          path: "/api/projects/:id",
          description: "프로젝트의 최신 산출물과 버전 이력을 조회한다.",
        },
        {
          method: "POST",
          path: "/api/projects/:id/feedback",
          description: "사용자 피드백을 반영해 관련 산출물과 PRD 버전을 갱신한다.",
        },
        {
          method: "GET",
          path: "/api/projects/:id/export",
          description: "PRD 또는 전체 Product Package를 다운로드한다.",
        },
      ],
      tasks: [
        ...featureTasks,
        {
          title: "산출물 스키마 검증",
          priority: "높음",
          difficulty: "중간",
          reason: "LLM 연동 시 누락 필드와 잘못된 타입을 막기 위한 기반 작업이다.",
        },
        {
          title: "버전 비교 UI",
          priority: "중간",
          difficulty: "중간",
          reason: "사용자가 어떤 산출물이 변경됐는지 신뢰할 수 있어야 한다.",
        },
        {
          title: "Markdown/PDF export",
          priority: "중간",
          difficulty: "낮음",
          reason: "생성된 PRD를 외부 문서 작업으로 이어가기 쉽게 만든다.",
        },
      ],
      pageStructure: [
        "홈/프로젝트 생성",
        "프로젝트 산출물 상세",
        "PRD 문서 뷰",
        "버전 이력",
        "개발 패키지",
        "검증 리포트",
      ],
      technicalRisks: [
        "LLM 응답이 스키마를 벗어나면 UI 렌더링이 깨질 수 있다.",
        "산출물 버전이 커질수록 localStorage 용량 한계에 도달할 수 있다.",
        "PRD 업데이트가 부분 수정처럼 보이지 않으면 사용자가 변경 이유를 신뢰하기 어렵다.",
      ],
    };
  }

  function buildValidationPackage(artifacts) {
    const highRiskAssumptions = artifacts.assumptions.filter(
      (item) => item.importance === "높음" && item.uncertainty === "높음",
    );
    const mvpCount = artifacts.mvp.included.length;
    const hasExperimentCriteria =
      artifacts.experiment.successCriteria.length > 0 && artifacts.experiment.failureCriteria.length > 0;
    const score =
      62 +
      Math.min(12, artifacts.questions.length * 3) +
      (mvpCount >= 3 && mvpCount <= 5 ? 10 : 0) +
      (highRiskAssumptions.length ? 8 : 0) +
      (hasExperimentCriteria ? 8 : 0);

    return {
      prdScore: Math.min(score, 100),
      summary:
        "핵심 산출물은 연결되어 있으나, 실제 사용자 모집 채널과 샘플 결과물 품질 검증을 더 구체화해야 한다.",
      mvpFit: {
        status: mvpCount >= 3 && mvpCount <= 5 ? "적정" : "조정 필요",
        reason:
          mvpCount >= 3 && mvpCount <= 5
            ? "필수 기능이 3~5개 범위에 있어 초기 검증에 적합하다."
            : "MVP 기능 수가 많거나 적어 핵심 가치 검증이 흐려질 수 있다.",
      },
      risks: [
        {
          title: "타깃 사용자 정의가 넓어질 위험",
          severity: "중간",
          mitigation: "첫 실험은 하나의 세그먼트와 하나의 문제 상황으로 제한한다.",
        },
        {
          title: "AI 산출물 신뢰 부족",
          severity: "높음",
          mitigation: "샘플 PRD를 먼저 보여주고 사용자가 직접 수정한 비율을 측정한다.",
        },
        {
          title: "검증 실험이 신청률에만 치우칠 위험",
          severity: "중간",
          mitigation: "신청뿐 아니라 산출물 저장, 공유, 피드백 입력 같은 후속 행동을 함께 본다.",
        },
      ],
      experimentReview: [
        "성공 기준과 실패 기준이 숫자로 정의되어 있어 MVP 판단에 사용할 수 있다.",
        "실험 대상 모집 채널을 더 구체화하면 실행 가능성이 높아진다.",
        "생성된 PRD 품질에 대한 정성 피드백 문항을 함께 붙이는 것이 좋다.",
      ],
      launchChecklist: [
        "샘플 아이디어 5개 이상으로 산출물 품질 확인",
        "MVP 제외 기능의 이유가 모든 프로젝트에서 생성되는지 확인",
        "피드백 입력 후 변경 로그와 PRD 버전이 함께 갱신되는지 확인",
        "PRD export 결과가 외부 문서로 바로 사용 가능한지 확인",
      ],
      recommendations: [
        "다음 버전에서는 LLM 응답을 JSON Schema로 검증하는 계층을 추가한다.",
        "기획자 에이전트가 만든 핵심 가정을 검증 에이전트가 재정렬하는 루프를 만든다.",
        "개발 에이전트 산출물은 PRD의 MVP 기능을 직접 참조하도록 유지한다.",
      ],
    };
  }

  function buildAgentPackage(artifacts) {
    const productContext = {
      oneLineDescription: artifacts.analysis.oneLineDescription,
      targetUser: artifacts.analysis.targetUser,
      problem: artifacts.analysis.problem,
      valueProposition: artifacts.analysis.valueProposition,
      mvpFeatures: artifacts.mvp.included.map((feature) => feature.name),
      riskiestAssumption: artifacts.analysis.riskiestAssumption,
    };

    return {
      summary: "현재 산출물을 실제 LLM 기반 멀티 에이전트로 전환하기 위한 프롬프트와 출력 스키마 패키지입니다.",
      executionOrder: ["planner", "validator", "developer", "validator"],
      handoffRule:
        "각 에이전트는 이전 에이전트의 structured JSON을 입력으로 받고, 판단 이유와 수정 대상 섹션을 반드시 함께 반환합니다.",
      productContext,
      agents: [
        {
          id: "planner",
          name: "기획자 에이전트",
          role: "아이디어를 구조화하고 MVP, 실험 계획, PRD 초안을 생성한다.",
          outputKey: "productPackage",
          systemPrompt:
            "당신은 초기 제품 기획을 수행하는 시니어 PM 에이전트입니다. 사용자의 아이디어를 단순 조언이 아니라 구조화된 제품 산출물로 변환하세요. 기능을 많이 추가하지 말고 핵심 가정을 검증할 수 있는 MVP로 줄이세요. 모든 결정에는 이유를 남기고, 출력은 지정된 JSON 스키마를 따라야 합니다.",
          userPrompt: `제품 아이디어와 현재 맥락을 바탕으로 Product Package를 생성하세요.

제품 맥락:
${JSON.stringify(productContext, null, 2)}

반드시 포함할 산출물:
- 아이디어 진단
- 정보 보완 질문 3개
- 핵심 가정 보드
- MVP 포함/제외 기능
- 사용자 시나리오
- 성공 지표
- 검증 실험 계획
- PRD 초안`,
          outputSchema: productPackageSchema(),
        },
        {
          id: "developer",
          name: "개발 에이전트",
          role: "PRD를 기반으로 구현 가능한 기술 설계와 개발 태스크를 생성한다.",
          outputKey: "developmentPackage",
          systemPrompt:
            "당신은 제품 MVP를 구현 가능한 개발 계획으로 바꾸는 시니어 소프트웨어 아키텍트입니다. 과한 기술 선택을 피하고, MVP 검증에 필요한 최소 구조를 우선하세요. API, 데이터 모델, 태스크는 실제 개발자가 바로 착수할 수 있을 만큼 구체적으로 작성하세요.",
          userPrompt: `다음 Product Package를 기반으로 Development Package를 생성하세요.

PRD:
${artifacts.prd}

MVP 기능:
${artifacts.mvp.included.map((feature) => `- ${feature.name}: ${feature.description}`).join("\n")}

반드시 구현 가능성, 기술 리스크, 우선순위별 태스크를 포함하세요.`,
          outputSchema: developmentPackageSchema(),
        },
        {
          id: "validator",
          name: "검증 에이전트",
          role: "기획과 개발 산출물의 논리, 리스크, 실험 타당성을 평가한다.",
          outputKey: "validationPackage",
          systemPrompt:
            "당신은 초기 제품 산출물을 검증하는 냉정한 제품 리뷰어입니다. 좋은 점보다 위험한 가정, 불명확한 타깃, 과한 MVP 범위, 실행 불가능한 실험을 먼저 찾으세요. 단순 비판이 아니라 수정 가능한 권고안을 함께 반환하세요.",
          userPrompt: `다음 Product Package와 Development Package를 검토하세요.

핵심 가정:
${artifacts.assumptions.map((item) => `- ${item.content} / 중요도: ${item.importance} / 불확실성: ${item.uncertainty}`).join("\n")}

검증 실험:
${JSON.stringify(artifacts.experiment, null, 2)}

개발 태스크:
${artifacts.development.tasks.map((task) => `- ${task.title}: ${task.reason}`).join("\n")}

리스크, MVP 적정성, 실험 설계 타당성, 출시 전 체크리스트를 평가하세요.`,
          outputSchema: validationPackageSchema(),
        },
      ],
      orchestrationNotes: [
        "Planner 출력은 Validator가 먼저 검토한 뒤 PRD 수정 후보를 반환합니다.",
        "Developer는 승인된 MVP 범위만 개발 태스크로 분해합니다.",
        "Validator는 개발 범위가 제품 목표와 어긋나는지 다시 점검합니다.",
        "품질 게이트가 통과하지 못하면 사용자 보완 질문 또는 재생성 단계로 되돌립니다.",
      ],
    };
  }

  function buildQualityReport(artifacts) {
    const fieldChecks = [
      checkField("Product", "제품 한 줄 설명", artifacts.analysis?.oneLineDescription),
      checkField("Product", "타깃 사용자", artifacts.analysis?.targetUser),
      checkField("Product", "문제 정의", artifacts.analysis?.problem),
      checkField("Product", "핵심 가치 제안", artifacts.analysis?.valueProposition),
      checkArray("Product", "정보 보완 질문 3개", artifacts.questions, 3, 3),
      checkArray("Product", "핵심 가정 3개 이상", artifacts.assumptions, 3),
      checkArray("Product", "MVP 포함 기능 3~5개", artifacts.mvp?.included, 3, 5),
      checkArray("Product", "MVP 제외 기능 1개 이상", artifacts.mvp?.excluded, 1),
      checkField("Product", "사용자 시나리오", artifacts.scenario?.flow),
      checkArray("Product", "성공 지표 3개 이상", artifacts.metrics, 3),
      checkField("Product", "실험 성공 기준", artifacts.experiment?.successCriteria),
      checkField("Product", "실험 실패 기준", artifacts.experiment?.failureCriteria),
      checkField("Product", "PRD 본문", artifacts.prd),
      checkArray("Development", "개발 태스크 4개 이상", artifacts.development?.tasks, 4),
      checkArray("Development", "API 명세 2개 이상", artifacts.development?.apiSpec, 2),
      checkArray("Validation", "리스크 분석 2개 이상", artifacts.validation?.risks, 2),
      checkArray("Validation", "출시 전 체크리스트 3개 이상", artifacts.validation?.launchChecklist, 3),
      checkArray("Agent", "에이전트 3개", artifacts.agentPackage?.agents, 3, 3),
      checkField("Agent", "핸드오프 규칙", artifacts.agentPackage?.handoffRule),
    ];

    const schemaChecks = [
      {
        name: "Product Package",
        passed: fieldChecks.filter((check) => check.group === "Product").every((check) => check.passed),
        detail: "진단, 질문, 가정, MVP, 시나리오, 실험, PRD 필수 구조를 확인합니다.",
      },
      {
        name: "Development Package",
        passed: fieldChecks.filter((check) => check.group === "Development").every((check) => check.passed),
        detail: "개발 태스크와 API 명세가 구현 계획으로 이어질 만큼 구성됐는지 확인합니다.",
      },
      {
        name: "Validation Package",
        passed: fieldChecks.filter((check) => check.group === "Validation").every((check) => check.passed),
        detail: "리스크, 체크리스트, 개선 권고가 출시 전 검토에 충분한지 확인합니다.",
      },
      {
        name: "Agent Package",
        passed: fieldChecks.filter((check) => check.group === "Agent").every((check) => check.passed),
        detail: "기획자, 개발, 검증 에이전트의 프롬프트와 핸드오프 규칙을 확인합니다.",
      },
    ];

    const passedCount = fieldChecks.filter((check) => check.passed).length;
    const score = Math.round((passedCount / fieldChecks.length) * 100);
    const issues = fieldChecks
      .filter((check) => !check.passed)
      .map((check) => `${check.group} / ${check.label}: ${check.message}`);

    return {
      status: score >= 90 ? "통과" : score >= 75 ? "보강 권장" : "점검 필요",
      score,
      summary:
        score >= 90
          ? "핵심 산출물 구조가 안정적이며 다음 단계 구현에 사용할 수 있습니다."
          : "주요 산출물은 생성됐지만 일부 항목을 보강하면 후속 에이전트 연동 안정성이 높아집니다.",
      schemaChecks,
      fieldChecks,
      issues,
      nextActions: [
        "LLM 연동 전 이 검증 결과를 API 응답 게이트로 사용합니다.",
        "점검 필요 항목이 있으면 재생성 또는 사용자 보완 질문으로 연결합니다.",
        "버전 비교에서 핵심 필드 변화가 의도한 변경인지 확인합니다.",
      ],
    };
  }

  function checkField(group, label, value) {
    const passed = typeof value === "string" && value.trim().length >= 6;
    return {
      group,
      label,
      passed,
      message: passed ? "필수 텍스트가 채워져 있습니다." : "의미 있는 텍스트가 필요합니다.",
    };
  }

  function checkArray(group, label, value, minLength, maxLength = Infinity) {
    const length = Array.isArray(value) ? value.length : 0;
    const passed = length >= minLength && length <= maxLength;
    const rangeText = maxLength === Infinity ? `${minLength}개 이상` : `${minLength}~${maxLength}개`;
    return {
      group,
      label,
      passed,
      message: passed ? `${length}개 항목이 있습니다.` : `${rangeText} 항목이 필요하지만 현재 ${length}개입니다.`,
    };
  }

  function buildPrd(artifacts) {
    const { analysis, mvp, scenario, metrics, assumptions, experiment } = artifacts;
    return `# PRD

## 1. 제품 개요
${analysis.oneLineDescription}

## 2. 문제 정의
${analysis.problem}

## 3. 타깃 사용자
${analysis.targetUser}

## 4. 핵심 가치 제안
${analysis.valueProposition}

## 5. 사용자 시나리오
${scenario.userBackground}

${scenario.flow}

기대 변화: ${scenario.expectedChange}

## 6. MVP 범위
${mvp.included.map((feature, index) => `${index + 1}. ${feature.name}: ${feature.description}`).join("\n")}

## 7. 기능 요구사항
${mvp.included.map((feature) => `- ${feature.name}: ${feature.reason}`).join("\n")}

## 8. 제외할 기능
${mvp.excluded.map((feature) => `- ${feature.name}: ${feature.reason}`).join("\n")}

## 9. 성공 지표
${metrics.map((metric) => `- ${metric}`).join("\n")}

## 10. 핵심 가정
${assumptions.map((item) => `- ${item.content} (${item.importance}, ${item.uncertainty})`).join("\n")}

## 11. 검증 실험 계획
검증할 가정: ${experiment.hypothesis}

실험 방법: ${experiment.method}

대상 사용자: ${experiment.targetUser}

기간: ${experiment.duration}

성공 기준: ${experiment.successCriteria}

실패 기준: ${experiment.failureCriteria}

다음 액션: ${experiment.nextAction}

## 12. 리스크
- 생성 결과가 너무 일반적이면 사용자는 실질적인 기획 산출물로 느끼지 못할 수 있다.
- 타깃 사용자가 넓으면 MVP 범위가 다시 커질 수 있다.
- 검증 실험이 실제 모집 채널과 연결되지 않으면 다음 행동으로 이어지기 어렵다.

## 13. 향후 확장 방향
- 개발 에이전트를 추가해 기술 설계서, API 명세, 개발 태스크를 생성한다.
- 검증 에이전트를 추가해 기획 논리, MVP 범위, 실험 설계의 품질을 점검한다.
- 세 에이전트가 피드백 루프를 형성해 최종 Product Package를 자동 완성한다.`;
  }

  function initialDecisionLogs(artifacts) {
    const createdAt = now();
    return [
      {
        id: id("decision"),
        decision: "개발/검증 에이전트 산출물을 함께 생성",
        reason: "PRD 이후의 구현 가능성 검토와 기획 품질 점검을 한 흐름에서 볼 수 있게 했다.",
        createdAt,
      },
      {
        id: id("decision"),
        decision: "MVP 기능을 4개로 제한",
        reason: "핵심 가정 검증에 직접 필요한 기능만 남겨 초기 구현 범위를 줄였다.",
        createdAt,
      },
      {
        id: id("decision"),
        decision: "가장 위험한 가정을 실험 계획의 중심에 배치",
        reason: artifacts.analysis.riskiestAssumption,
        createdAt,
      },
      {
        id: id("decision"),
        decision: "커뮤니티와 결제는 MVP에서 제외",
        reason: "반복 사용과 가치 인지가 확인된 뒤 추가해도 되는 확장 기능이다.",
        createdAt,
      },
    ];
  }

  function makeTitle(idea, profile) {
    const trimmed = idea.trim().replace(/\s+/g, " ");
    if (trimmed.length <= 24) return trimmed;
    return `${profile.productNoun} 기획안`;
  }

  function summarizeArtifacts(artifacts) {
    return {
      targetUser: artifacts.analysis.targetUser,
      problem: artifacts.analysis.problem,
      mvpCount: artifacts.mvp.included.length,
      firstMetric: artifacts.metrics[0],
    };
  }

  function inferChangedSections(previous, next) {
    const sections = [];
    if (previous.analysis.targetUser !== next.analysis.targetUser) sections.push("타깃 사용자");
    if (previous.analysis.problem !== next.analysis.problem) sections.push("문제 정의");
    if (previous.analysis.differentiation !== next.analysis.differentiation) sections.push("차별화 포인트");
    if (JSON.stringify(previous.assumptions) !== JSON.stringify(next.assumptions)) sections.push("핵심 가정");
    if (JSON.stringify(previous.mvp) !== JSON.stringify(next.mvp)) sections.push("MVP");
    if (JSON.stringify(previous.scenario) !== JSON.stringify(next.scenario)) sections.push("사용자 시나리오");
    if (JSON.stringify(previous.metrics) !== JSON.stringify(next.metrics)) sections.push("성공 지표");
    if (JSON.stringify(previous.experiment) !== JSON.stringify(next.experiment)) sections.push("검증 실험");
    if (JSON.stringify(previous.development) !== JSON.stringify(next.development)) sections.push("개발 패키지");
    if (JSON.stringify(previous.validation) !== JSON.stringify(next.validation)) sections.push("검증 리포트");
    sections.push("PRD", "에이전트 패키지", "품질 리포트");
    return [...new Set(sections)];
  }
})();
