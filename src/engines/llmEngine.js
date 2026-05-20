import {
  buildAgentPackage,
  buildArtifacts,
  buildDevelopmentPackage,
  buildPrd,
  buildQualityReport,
  buildValidationPackage,
  inferChangedSections,
  inferProfile,
  initialDecisionLogs,
  makeTitle,
  normalizeDevelopmentPackage,
  normalizeProductArtifacts,
  normalizeValidationPackage,
  summarizeArtifacts,
} from "../artifacts.js";

import {
  assertMatchesSchema,
  developmentPackageSchema,
  productPackageSchema,
  validationPackageSchema,
} from "../schemas.js";

import {
  deepClone,
  id,
  now,
} from "../utils.js";

import { LlmClient } from "./llmClient.js";

export const LlmEngine = {
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

