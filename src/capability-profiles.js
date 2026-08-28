export const CAPABILITY_PROFILES = Object.freeze([
  Object.freeze({
    id: 'standard',
    sourceDirectory: 'standard',
    targetDirectory: 'skillopt-standard',
    displayName: 'SkillOpt 轻量标准模式',
    description: '完整原生工具能力，按需检索 Skill，并收紧指令、结果与外置预算。',
    transform: 'skillopt-lean',
    supportsSubagentFeatures: true,
  }),
  Object.freeze({
    id: 'code',
    sourceDirectory: 'code',
    targetDirectory: 'skillopt-code',
    displayName: 'SkillOpt 代码模式',
    description: '固定使用官方 Code Mode 工具面，并应用按需 Skill 与上下文预算。',
    transform: 'skillopt-lean',
    supportsSubagentFeatures: true,
  }),
  Object.freeze({
    id: 'minimal',
    sourceDirectory: 'minimal',
    targetDirectory: 'skillopt-minimal',
    displayName: 'SkillOpt 极简模式',
    description: '基于官方极简双工具预设，保留稳定的最小能力面和本地优化插件。',
    transform: 'minimal-copy',
    supportsSubagentFeatures: false,
  }),
]);

const BY_ID = new Map(CAPABILITY_PROFILES.map((profile) => [profile.id, profile]));

export function capabilityProfile(id) {
  const profile = BY_ID.get(String(id ?? ''));
  if (!profile) {
    throw new Error(`unknown capability profile ${JSON.stringify(id)}; expected ${CAPABILITY_PROFILES.map((entry) => entry.id).join(', ')}`);
  }
  return profile;
}
