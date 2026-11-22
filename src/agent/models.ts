import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentKind } from '../config/profile-schema';

/**
 * Sentinel selection meaning "don't pass `--model`; let the agent CLI /
 * account decide". Kept as a real option value (rather than empty string)
 * because Feishu's `select_static` requires `initial_option` to match one of
 * the option `value`s exactly and rejects an empty string.
 */
export const DEFAULT_MODEL = 'default';

export interface ModelOption {
  /**
   * Stored in `preferences.model` and forwarded to the agent's `--model`
   * flag. `DEFAULT_MODEL` is special-cased to omit the flag entirely.
   */
  value: string;
  /** Human-facing label shown in the `/config` picker and `/model` card. */
  label: string;
  /** Optional one-line description (e.g. the provider behind the model). */
  desc?: string;
}

/** One Claude Code model slot as configured by the provider switcher. */
export interface CliModelMapping {
  /** Claude Code alias this slot answers to: opus / fable / sonnet / haiku. */
  alias: string;
  /** Underlying model id, e.g. `claude-opus-5[1M]`. */
  id: string;
  /** Display name the CLI `/model` list shows, e.g. `deepseek-v4.1-flash`. */
  name: string;
  desc: string;
}

/**
 * Order matches the Claude Code `/model` picker so the bridge card lists
 * models in the same sequence the user sees in the terminal.
 */
const CLAUDE_SLOTS: ReadonlyArray<readonly [alias: string, envKey: string]> = [
  ['opus', 'OPUS'],
  ['fable', 'FABLE'],
  ['sonnet', 'SONNET'],
  ['haiku', 'HAIKU'],
];

/**
 * Used only when `~/.claude/settings.json` carries no provider mapping (plain
 * Anthropic account). These aliases are resolved by the Claude CLI itself.
 */
const CLAUDE_FALLBACK_MODELS: ModelOption[] = [
  { value: DEFAULT_MODEL, label: '跟随默认（不指定）' },
  { value: 'fable', label: 'Fable（最新）' },
  { value: 'opus', label: 'Opus（最新）' },
  { value: 'sonnet', label: 'Sonnet（最新）' },
  { value: 'haiku', label: 'Haiku（最新）' },
  { value: 'opusplan', label: 'Opus Plan（规划用 Opus，执行用 Sonnet）' },
];

/**
 * Used only when the Codex model catalog written by the provider switcher is
 * missing. Forwarded to `codex exec --model`.
 */
const CODEX_FALLBACK_MODELS: ModelOption[] = [
  { value: DEFAULT_MODEL, label: '跟随默认（不指定）' },
  { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
  { value: 'gpt-5', label: 'GPT-5' },
  { value: 'o3', label: 'o3' },
];

/**
 * Read the model slots the Claude CLI shows in `/model`. These come from the
 * `ANTHROPIC_DEFAULT_<SLOT>_MODEL[_NAME|_DESCRIPTION]` env block that the
 * provider switcher (e.g. CC Switch) writes into `~/.claude/settings.json`.
 * Read on every call so a provider switch takes effect without a restart.
 */
export function readCliModelMappings(): CliModelMapping[] {
  try {
    const settings = JSON.parse(
      readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8'),
    ) as { env?: Record<string, string> };
    const env = settings.env ?? {};
    const out: CliModelMapping[] = [];
    for (const [alias, key] of CLAUDE_SLOTS) {
      const id = env[`ANTHROPIC_DEFAULT_${key}_MODEL`];
      if (!id) continue;
      out.push({
        alias,
        id,
        name: env[`ANTHROPIC_DEFAULT_${key}_MODEL_NAME`] || id,
        desc: env[`ANTHROPIC_DEFAULT_${key}_MODEL_DESCRIPTION`] || '',
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Claude picker options. Mirrors the CLI `/model` list: the mapped display
 * names (which the provider proxy accepts as `--model` values) after a
 * "follow default" entry. Falls back to the static aliases when no mapping
 * exists.
 */
function claudeModels(): ModelOption[] {
  const mapped = readCliModelMappings();
  if (mapped.length === 0) return CLAUDE_FALLBACK_MODELS;
  const seen = new Set<string>([DEFAULT_MODEL]);
  const out: ModelOption[] = [{ value: DEFAULT_MODEL, label: '跟随默认（不指定）' }];
  for (const m of mapped) {
    if (seen.has(m.name)) continue;
    seen.add(m.name);
    out.push({ value: m.name, label: m.name, ...(m.desc ? { desc: m.desc } : {}) });
  }
  return out;
}

/** The model picker options for a profile's agent kind. */
export function supportedModels(agentKind: AgentKind): ModelOption[] {
  return agentKind === 'codex' ? codexModels() : claudeModels();
}

/**
 * Read the Codex model catalog written by the provider switcher
 * (`~/.codex/cc-switch-model-catalog.json`, shape `{ models: [{ slug,
 * display_name, description }] }`). Codex and Claude mappings are separate:
 * this never reads the Claude settings file.
 */
export function readCodexCatalog(): ModelOption[] {
  try {
    const catalog = JSON.parse(
      readFileSync(join(homedir(), '.codex', 'cc-switch-model-catalog.json'), 'utf8'),
    ) as { models?: Array<{ slug?: string; display_name?: string; description?: string }> };
    const seen = new Set<string>([DEFAULT_MODEL]);
    const out: ModelOption[] = [];
    for (const m of catalog.models ?? []) {
      const value = m.slug;
      if (!value || seen.has(value)) continue;
      seen.add(value);
      const label = m.display_name || value;
      const desc = m.description && m.description !== label ? m.description : '';
      out.push({ value, label, ...(desc ? { desc } : {}) });
    }
    return out;
  } catch {
    return [];
  }
}

function codexModels(): ModelOption[] {
  const catalog = readCodexCatalog();
  if (catalog.length === 0) return CODEX_FALLBACK_MODELS;
  return [{ value: DEFAULT_MODEL, label: '跟随默认（不指定）' }, ...catalog];
}

/** True when the selection means "use the agent default" (no `--model`). */
export function isDefaultModel(value: string | undefined): boolean {
  return !value || value === DEFAULT_MODEL;
}

/**
 * Coerce a stored model preference into a value guaranteed to be one of the
 * current agent's picker options — Feishu's `select_static` requires
 * `initial_option` to match an option value exactly. Unknown / cross-agent
 * values (e.g. a Claude alias left over after switching a profile to Codex,
 * or a provider model that was removed from settings) fall back to
 * {@link DEFAULT_MODEL}.
 */
export function normalizeModelSelection(
  agentKind: AgentKind,
  value: string | undefined,
): string {
  if (isDefaultModel(value)) return DEFAULT_MODEL;
  return supportedModels(agentKind).some((m) => m.value === value)
    ? (value as string)
    : DEFAULT_MODEL;
}

/**
 * Resolve the concrete model string to hand the agent, or `undefined` to omit
 * the `--model` flag. Cross-agent / unknown values are treated as "default".
 */
export function resolveModelArg(
  agentKind: AgentKind,
  value: string | undefined,
): string | undefined {
  const normalized = normalizeModelSelection(agentKind, value);
  return normalized === DEFAULT_MODEL ? undefined : normalized;
}

/** Picker label for a stored value, for display in the saved-config card. */
export function modelLabel(agentKind: AgentKind, value: string | undefined): string {
  const normalized = normalizeModelSelection(agentKind, value);
  return supportedModels(agentKind).find((m) => m.value === normalized)?.label ?? normalized;
}
