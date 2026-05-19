export function productPackageSchema() {
  return {
    type: "object",
    required: ["analysis", "questions", "assumptions", "mvp", "scenario", "metrics", "experiment", "prd"],
    properties: {
      analysis: { type: "object" },
      questions: { type: "array", minItems: 3, maxItems: 3 },
      assumptions: { type: "array", minItems: 3 },
      mvp: { type: "object", required: ["included", "excluded"] },
      scenario: { type: "object" },
      metrics: { type: "array", minItems: 3 },
      experiment: { type: "object" },
      prd: { type: "string" },
    },
  };
}

export function developmentPackageSchema() {
  return {
    type: "object",
    required: ["architecture", "dataModels", "apiSpec", "tasks", "pageStructure", "technicalRisks"],
    properties: {
      architecture: { type: "object" },
      dataModels: { type: "array", minItems: 2 },
      apiSpec: { type: "array", minItems: 2 },
      tasks: { type: "array", minItems: 4 },
      pageStructure: { type: "array" },
      technicalRisks: { type: "array" },
    },
  };
}

export function validationPackageSchema() {
  return {
    type: "object",
    required: ["prdScore", "summary", "mvpFit", "risks", "experimentReview", "launchChecklist", "recommendations"],
    properties: {
      prdScore: { type: "number", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      mvpFit: { type: "object" },
      risks: { type: "array", minItems: 2 },
      experimentReview: { type: "array" },
      launchChecklist: { type: "array", minItems: 3 },
      recommendations: { type: "array" },
    },
  };
}

export function assertMatchesSchema(value, schema, label) {
  const errors = validateSchemaValue(value, schema, label);
  if (errors.length) {
    throw new Error(`${label} 스키마 검증 실패: ${errors.slice(0, 3).join(", ")}`);
  }
}

export function validateSchemaValue(value, schema, path) {
  const errors = [];
  if (!schema) return errors;

  if (schema.type && !matchesSchemaType(value, schema.type)) {
    errors.push(`${path} 타입은 ${schema.type}이어야 합니다.`);
    return errors;
  }

  if (schema.type === "object") {
    if (Array.isArray(schema.required)) {
      schema.required.forEach((field) => {
        if (value?.[field] === undefined || value?.[field] === null || value?.[field] === "") {
          errors.push(`${path}.${field} 필드가 필요합니다.`);
        }
      });
    }
    Object.entries(schema.properties || {}).forEach(([field, childSchema]) => {
      if (value?.[field] !== undefined) {
        errors.push(...validateSchemaValue(value[field], childSchema, `${path}.${field}`));
      }
    });
  }

  if (schema.type === "array") {
    const length = Array.isArray(value) ? value.length : 0;
    if (schema.minItems !== undefined && length < schema.minItems) {
      errors.push(`${path} 항목이 ${schema.minItems}개 이상이어야 합니다.`);
    }
    if (schema.maxItems !== undefined && length > schema.maxItems) {
      errors.push(`${path} 항목이 ${schema.maxItems}개 이하여야 합니다.`);
    }
  }

  if (schema.type === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path} 값은 ${schema.minimum} 이상이어야 합니다.`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path} 값은 ${schema.maximum} 이하여야 합니다.`);
    }
  }

  return errors;
}

function matchesSchemaType(value, type) {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}
