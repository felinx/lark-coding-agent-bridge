import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedMessage } from '@larksuite/channel';
import { ActiveRuns } from '../../../src/bot/active-runs.js';
import { ProcessPool } from '../../../src/bot/process-pool.js';
import { tryHandleCommand, type CommandContext, type Controls } from '../../../src/commands/index.js';
import { createDefaultProfileConfig, type ProfileConfig } from '../../../src/config/profile-schema.js';
import { RunExecutor } from '../../../src/runtime/run-executor.js';
import { SessionStore } from '../../../src/session/store.js';
import { WorkspaceStore } from '../../../src/workspace/store.js';
import { FakeAgentAdapter, type FakeAgentEvents, type FakeAgentRun } from '../../helpers/fake-agent.js';
import { createFakeChannel, type FakeChannel } from '../../helpers/fake-channel.js';
import { createTmpProfile, type TmpProfile } from '../../helpers/tmp-profile.js';

interface Harness {
  tmp: TmpProfile;
  channel: FakeChannel;
  sessions: SessionStore;
  activeRuns: ActiveRuns;
  pool: ProcessPool;
  agent: FakeAgentAdapter;
  run(content: string): Promise<boolean>;
}

const cleanups: Array<() => Promise<void>> = [];

describe('/compact', () => {
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  });

  it('runs the /compact prompt against the pinned session in its own cwd', async () => {
    const h = await createHarness();
    const cwd = await realpath(h.tmp.workspace);
    h.sessions.set('chat-1', 'sess-1', cwd);

    await expect(h.run('/compact')).resolves.toBe(true);

    expect(h.agent.runOptions).toHaveLength(1);
    const opts = h.agent.runOptions[0]!;
    expect(opts.prompt).toBe('/compact');
    expect(opts.sessionId).toBe('sess-1');
    expect(opts.cwd).toBe(cwd);
    expect(lastMarkdown(h.channel)).toContain('已压缩');
    expect(markdowns(h.channel).join('\n')).toContain('正在压缩');
  });

  it('reports what the CLI said when there is not enough history to compact', async () => {
    const h = await createHarness({
      events: [[{ type: 'text', delta: 'Not enough messages to compact.' }, { type: 'done', terminationReason: 'normal' }]],
    });
    h.sessions.set('chat-1', 'sess-1', await realpath(h.tmp.workspace));

    await expect(h.run('/compact')).resolves.toBe(true);

    expect(lastMarkdown(h.channel)).toContain('Not enough messages to compact.');
  });

  it('refuses to compact while another run is active in this chat', async () => {
    const h = await createHarness();
    h.sessions.set('chat-1', 'sess-1', await realpath(h.tmp.workspace));
    const running = h.agent.run({ runId: 'run-active', prompt: 'busy' }) as FakeAgentRun;
    h.activeRuns.register('chat-1', running);

    await expect(h.run('/compact')).resolves.toBe(true);

    expect(h.agent.runOptions).toHaveLength(1);
    expect(h.agent.runOptions[0]!.prompt).toBe('busy');
    expect(lastMarkdown(h.channel)).toContain('还有任务在跑');
  });

  it('refuses when the session was created in a different working directory', async () => {
    const h = await createHarness();
    h.sessions.set('chat-1', 'sess-1', '/somewhere/else');

    await expect(h.run('/compact')).resolves.toBe(true);

    expect(h.agent.runOptions).toHaveLength(0);
    expect(lastMarkdown(h.channel)).toContain('另一个目录');
  });

  it('is unavailable on the Codex agent', async () => {
    const h = await createHarness({ agentKind: 'codex' });
    h.sessions.set('chat-1', 'sess-1', await realpath(h.tmp.workspace));

    await expect(h.run('/compact')).resolves.toBe(true);

    expect(h.agent.runOptions).toHaveLength(0);
    expect(lastMarkdown(h.channel)).toContain('暂不支持');
  });
});

async function createHarness(
  options: { agentKind?: 'claude' | 'codex'; events?: FakeAgentEvents } = {},
): Promise<Harness> {
  const tmp = await createTmpProfile('compact-command-');
  const channel = createFakeChannel();
  const sessions = new SessionStore(join(tmp.profile, 'sessions.json'));
  const workspaces = new WorkspaceStore(join(tmp.profile, 'workspaces.json'));
  const activeRuns = new ActiveRuns();
  const pool = new ProcessPool(() => 2);
  const agent = new FakeAgentAdapter(
    options.events ? { events: options.events } : {},
  );
  const profileConfig = appConfig(options.agentKind ?? 'claude', tmp.workspace);
  const controls = {
    profile: options.agentKind ?? 'claude',
    profileConfig,
    botOwnerId: 'ou-owner',
    ownerRefreshState: 'ok',
    ownerRefreshedAt: 1_700_000_000_000,
    async refreshOwner() {},
    restart: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
    configPath: join(tmp.profile, 'config.json'),
    cfg: profileConfig,
    processId: 'proc-1',
  } satisfies Controls;

  workspaces.setCwd('chat-1', tmp.workspace);
  const executor = new RunExecutor({
    agent,
    pool,
    activeRuns,
    createRunId: () => 'compact-run-1',
    now: () => 1_700_000_000_000,
    postDoneExitGraceMs: 10,
  });

  const run = (content: string): Promise<boolean> =>
    tryHandleCommand({
      channel: channel as unknown as CommandContext['channel'],
      msg: message(content),
      scope: 'chat-1',
      chatMode: 'p2p',
      sessions,
      workspaces,
      agent,
      activeRuns,
      processPool: pool,
      runExecutor: executor,
      controls,
    });

  cleanups.push(async () => {
    await Promise.all([sessions.flush(), workspaces.flush()]);
    await tmp.cleanup();
  });

  return { tmp, channel, sessions, activeRuns, pool, agent, run };
}

function appConfig(agentKind: 'claude' | 'codex', workspace: string): ProfileConfig {
  const config = createDefaultProfileConfig({
    agentKind,
    accounts: { app: { id: 'app-id', secret: 'secret', tenant: 'feishu' } },
    access: { admins: ['ou-admin'] },
    ...(agentKind === 'codex' ? { codex: { binaryPath: 'codex' } } : {}),
  });
  config.workspaces.default = workspace;
  return config;
}

function message(content: string): NormalizedMessage {
  return {
    messageId: `om-${content.replace(/\W+/g, '-').slice(0, 20)}`,
    chatId: 'chat-1',
    chatType: 'p2p',
    senderId: 'ou-admin',
    senderName: 'Admin',
    content,
    resources: [],
    mentionedBot: false,
  } as unknown as NormalizedMessage;
}

function lastMarkdown(channel: FakeChannel): string {
  return markdowns(channel).at(-1) ?? '';
}

function markdowns(channel: FakeChannel): string[] {
  return channel.sent
    .map((entry) => entry.content as Record<string, unknown> | undefined)
    .map((content) => content?.markdown ?? content?.text)
    .filter((value): value is string => typeof value === 'string');
}
