import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  isDefaultModel,
  modelLabel,
  normalizeModelSelection,
  readCliModelMappings,
  readCodexCatalog,
  resolveModelArg,
  supportedModels,
} from '../../../src/agent/models.js';

const MAPPED_ENV = {
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5[1M]',
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'deepseek-v4.1-flash',
  ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION: 'OpenCode Go-Claude · deepseek-v4.1-flash · 1M',
  ANTHROPIC_DEFAULT_FABLE_MODEL: 'claude-fable-5[1M]',
  ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: 'glm-5.3-flash',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5[1M]',
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'hy4-flash-free',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
};

/**
 * `os.homedir()` honours $HOME on POSIX, so pointing HOME at a temp dir
 * isolates the tests from the developer's real ~/.claude/settings.json.
 */
describe('agent model catalog', () => {
  let home: string;
  let savedHome: string | undefined;

  const writeSettings = (env: Record<string, string> | undefined): void => {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify(env === undefined ? {} : { env }),
    );
  };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'models-test-'));
    savedHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = savedHome;
    rmSync(home, { recursive: true, force: true });
  });

  it('mirrors the Claude CLI /model list from the provider mapping, in CLI order', () => {
    writeSettings(MAPPED_ENV);
    const values = supportedModels('claude').map((m) => m.value);
    expect(values).toEqual([
      DEFAULT_MODEL,
      'deepseek-v4.1-flash',
      'glm-5.3-flash',
      'hy4-flash-free',
      'claude-haiku-5-5',
    ]);
    const deepseek = supportedModels('claude')[1];
    expect(deepseek?.desc).toBe('OpenCode Go-Claude · deepseek-v4.1-flash · 1M');
  });

  it('falls back to the static CLI aliases when no mapping exists', () => {
    writeSettings(undefined);
    const values = supportedModels('claude').map((m) => m.value);
    expect(values[0]).toBe(DEFAULT_MODEL);
    expect(values).toContain('opus');
    expect(values).toContain('opusplan');
  });

  it('reads mapped slots, using the model id when no display name is set', () => {
    writeSettings({ ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5' });
    expect(readCliModelMappings()).toEqual([
      { alias: 'sonnet', id: 'claude-sonnet-5', name: 'claude-sonnet-5', desc: '' },
    ]);
  });

  it('reads the Codex catalog from ~/.codex, separate from the Claude mapping', () => {
    writeSettings(MAPPED_ENV);
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(
      join(home, '.codex', 'cc-switch-model-catalog.json'),
      JSON.stringify({
        models: [
          { slug: 'codex-model-a', display_name: 'Codex Model A', description: 'Codex Model A' },
          { slug: 'codex-model-b', display_name: 'codex-model-b', description: 'Second model' },
        ],
      }),
    );
    expect(readCodexCatalog().map((m) => m.value)).toEqual(['codex-model-a', 'codex-model-b']);
    const codex = supportedModels('codex');
    expect(codex.map((m) => m.value)).toEqual([DEFAULT_MODEL, 'codex-model-a', 'codex-model-b']);
    expect(codex[2]?.desc).toBe('Second model');
    // Claude options never leak into the Codex list.
    expect(codex.map((m) => m.value)).not.toContain('deepseek-v4.1-flash');
  });

  it('falls back to the static Codex models when the catalog is missing', () => {
    writeSettings(undefined);
    expect(supportedModels('codex').map((m) => m.value)).toContain('gpt-5-codex');
  });

  it('offers a distinct catalog per agent kind, each led by the default sentinel', () => {
    writeSettings(MAPPED_ENV);
    const claude = supportedModels('claude');
    const codex = supportedModels('codex');
    expect(claude[0]?.value).toBe(DEFAULT_MODEL);
    expect(codex[0]?.value).toBe(DEFAULT_MODEL);
    expect(codex.map((m) => m.value)).toContain('gpt-5-codex');
    expect(claude.map((m) => m.value)).not.toContain('gpt-5-codex');
  });

  it('treats unset and the default sentinel as "use agent default"', () => {
    expect(isDefaultModel(undefined)).toBe(true);
    expect(isDefaultModel('')).toBe(true);
    expect(isDefaultModel(DEFAULT_MODEL)).toBe(true);
    expect(isDefaultModel('deepseek-v4.1-flash')).toBe(false);
  });

  it('coerces unknown / cross-agent / removed selections back to the default option', () => {
    writeSettings(MAPPED_ENV);
    expect(normalizeModelSelection('claude', 'deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash');
    // A Codex model left over after switching a profile to Claude is invalid.
    expect(normalizeModelSelection('claude', 'gpt-5-codex')).toBe(DEFAULT_MODEL);
    // A model dropped from the provider mapping is no longer offered.
    expect(normalizeModelSelection('claude', 'retired-model')).toBe(DEFAULT_MODEL);
    expect(normalizeModelSelection('claude', undefined)).toBe(DEFAULT_MODEL);
  });

  it('resolves the --model argument, omitting it for the default', () => {
    writeSettings(MAPPED_ENV);
    expect(resolveModelArg('claude', 'hy4-flash-free')).toBe('hy4-flash-free');
    expect(resolveModelArg('claude', DEFAULT_MODEL)).toBeUndefined();
    expect(resolveModelArg('claude', undefined)).toBeUndefined();
    // Cross-agent value → no flag rather than a broken model.
    expect(resolveModelArg('codex', 'deepseek-v4.1-flash')).toBeUndefined();
  });

  it('labels a stored value using the picker option text', () => {
    writeSettings(MAPPED_ENV);
    expect(modelLabel('claude', 'glm-5.3-flash')).toBe('glm-5.3-flash');
    expect(modelLabel('claude', DEFAULT_MODEL)).toContain('跟随默认');
  });
});
