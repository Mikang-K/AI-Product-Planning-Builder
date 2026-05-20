import {
  buildAgentPackage,
  buildArtifacts,
  buildDevelopmentPackage,
  buildPrd,
  buildQualityReport,
  buildValidationPackage,
  inferProfile,
  initialDecisionLogs,
  makeTitle,
  summarizeArtifacts,
} from "../artifacts.js";

import {
  containsAny,
  deepClone,
  id,
  now,
  prioritizeMetric,
} from "../utils.js";

export const PlannerEngine = {
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

