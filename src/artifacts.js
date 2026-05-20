import {
  containsAny,
  deepClone,
  id,
  now,
} from "./utils.js";

import {
  developmentPackageSchema,
  productPackageSchema,
  validationPackageSchema,
} from "./schemas.js";

export function normalizeProductArtifacts(source, fallback) {
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

export function normalizeDevelopmentPackage(source, fallback) {
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

export function normalizeValidationPackage(source, fallback) {
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

export function inferProfile(idea) {
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

export function buildArtifacts(idea, profile) {
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

export function buildDevelopmentPackage(artifacts) {
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

export function buildValidationPackage(artifacts) {
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

export function buildAgentPackage(artifacts) {
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

export function buildQualityReport(artifacts) {
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

export function migrateProjectArtifacts(project) {
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

export function buildPrd(artifacts) {
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

export function initialDecisionLogs(artifacts) {
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

export function makeTitle(idea, profile) {
  const trimmed = idea.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 24) return trimmed;
  return `${profile.productNoun} 기획안`;
}

export function summarizeArtifacts(artifacts) {
  return {
    targetUser: artifacts.analysis.targetUser,
    problem: artifacts.analysis.problem,
    mvpCount: artifacts.mvp.included.length,
    firstMetric: artifacts.metrics[0],
  };
}

export function inferChangedSections(previous, next) {
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
