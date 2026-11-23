import type { ModelOption } from '../agent/models';

interface ButtonSpec {
  text: string;
  value: Record<string, unknown>;
  style?: 'primary' | 'danger' | 'default';
}

function button(spec: ButtonSpec): object {
  return {
    tag: 'button',
    text: { tag: 'plain_text', content: spec.text },
    type: spec.style ?? 'default',
    value: spec.value,
  };
}

function divMd(content: string): object {
  return { tag: 'div', text: { tag: 'lark_md', content } };
}

function actions(buttons: ButtonSpec[]): object {
  return { tag: 'action', actions: buttons.map(button) };
}

const HR: object = { tag: 'hr' };

function shell(title: string, elements: object[]): object {
  return {
    config: { wide_screen_mode: true, update_multi: true },
    header: { title: { tag: 'plain_text', content: title } },
    elements,
  };
}

export function workspacesCard(current: string | undefined, named: Record<string, string>): object {
  const entries = Object.entries(named);
  const elements: object[] = [];

  elements.push(divMd(`当前 cwd：\`${escapeCode(current ?? '(未设置)')}\``));

  if (entries.length === 0) {
    elements.push(HR);
    elements.push(divMd('暂无命名工作目录。'));
    elements.push(
      divMd('💡 发送 `/ws save <name>` 把当前 cwd 存为命名工作目录'),
    );
  } else {
    elements.push(HR);
    entries.forEach(([name, path], i) => {
      const marker = path === current ? '  ← 当前' : '';
      elements.push(divMd(`**${escapeMd(name)}** → \`${escapeCode(path)}\`${marker}`));
      elements.push(
        actions([
          { text: '切换到此处', value: { cmd: 'ws.use', name }, style: 'primary' },
          { text: '删除', value: { cmd: 'ws.remove', name }, style: 'danger' },
        ]),
      );
      if (i < entries.length - 1) elements.push(HR);
    });
  }

  return shell('📂 工作目录', elements);
}

/**
 * `/model` picker. Each option is a button whose payload `{cmd:'model.use',
 * arg}` is routed by the card dispatcher to `/model use <arg>`.
 */
export function modelCard(current: string, options: ModelOption[]): object {
  const currentOpt = options.find((o) => o.value === current);
  const elements: object[] = [
    divMd(`当前：**${escapeMd(currentOpt?.label ?? current)}**`),
    HR,
  ];
  for (const o of options) {
    const isCurrent = o.value === current;
    const text = `${isCurrent ? '✓ ' : ''}${o.desc ? `${o.label}  ${o.desc}` : o.label}`;
    elements.push(
      actions([
        {
          text,
          value: { cmd: 'model.use', arg: o.value },
          style: isCurrent ? 'primary' : 'default',
        },
      ]),
    );
  }
  elements.push(HR);
  elements.push(divMd('点选即可切换，下一条消息起生效；也可发送 `/model use <id>`。'));
  return shell('🧠 模型', elements);
}

export interface StatusInfo {
  profileName: string;
  cwd?: string;
  sessionId?: string;
  emptySessionText?: string;
  sessionStale: boolean;
  agentName: string;
  runtimeAccess: {
    label: string;
    value: string;
  };
  larkCliStatus?: 'app' | 'user-ready' | 'user-missing' | 'check-failed';
  activeRun: boolean;
  activeScopes?: string[];
  activeCommentScopes?: string[];
  queue?: { active: number; waiting: number; cap: number };
  ownerState: string;
  /** Session scope (= chatId or chatId:threadId in topic groups). */
  scope: string;
  /** Chat mode — used to label scope. */
  chatMode: 'p2p' | 'group' | 'topic';
}

export function statusCard(info: StatusInfo): object {
  const sessionLine = info.sessionId
    ? `\`${info.sessionId.slice(0, 8)}…\`${info.sessionStale ? ' ⚠️ 旧 cwd，下一条会新建' : ''}`
    : (info.emptySessionText ?? '(无)');
  // For topic groups, surface that the scope is per-topic so the user
  // knows /cd / /new only affect this topic.
  const scopeLine =
    info.chatMode === 'topic'
      ? `\`${escapeCode(info.scope)}\` _（话题独立 session）_`
      : `\`${escapeCode(info.scope)}\``;
  const cwdLine = info.cwd ? `\`${escapeCode(info.cwd)}\`` : '(未设置)';
  const queueLine = info.queue
    ? `${info.queue.active}/${info.queue.cap} active, ${info.queue.waiting} waiting`
    : 'unknown';
  const lines = [
    `🧭 **scope**: ${scopeLine}`,
    `🧩 **profile**: ${escapeMd(info.profileName)}`,
    `📁 **cwd**: ${cwdLine}`,
    `🔗 **session**: ${sessionLine}`,
    `🤖 **agent**: ${escapeMd(info.agentName)}`,
    `🛡 **${escapeMd(info.runtimeAccess.label)}**: ${escapeMd(info.runtimeAccess.value)}`,
    ...(info.larkCliStatus ? [`🔐 **lark-cli**: ${info.larkCliStatus}`] : []),
    `🏃 **active run**: ${info.activeRun ? 'yes' : 'no'}`,
    ...(info.activeScopes && info.activeScopes.length > 0
      ? [
          `🏃 **active scopes**: ${info.activeScopes.map((scope) => `\`${escapeCode(scope)}\``).join(', ')}`,
        ]
      : []),
    ...(info.activeCommentScopes && info.activeCommentScopes.length > 0
      ? [
          `📝 **comment runs**: ${info.activeCommentScopes.map((scope) => `\`${escapeCode(scope)}\``).join(', ')}`,
        ]
      : []),
    `🚦 **queue**: ${queueLine}`,
    `👤 **owner API**: ${escapeMd(info.ownerState)}`,
  ];
  return shell('📊 当前状态', [
    divMd(lines.join('\n')),
    HR,
    actions([
      { text: '🆕 新会话', value: { cmd: 'new' }, style: 'primary' },
      { text: '🔁 恢复会话', value: { cmd: 'resume' } },
      { text: '📂 工作目录', value: { cmd: 'ws.list' } },
      { text: '💡 帮助', value: { cmd: 'help' } },
    ]),
  ]);
}

export interface ResumeEntry {
  sessionId: string;
  displayId?: string;
  preview: string;
  relTime: string;
  lineCount?: number;
  detail?: string;
  current?: boolean;
}

export function resumeCard(cwd: string, entries: ResumeEntry[]): object {
  const elements: object[] = [];
  elements.push(divMd(`当前 cwd：\`${escapeCode(cwd)}\``));

  if (entries.length === 0) {
    elements.push(HR);
    elements.push(divMd('此 cwd 下没有历史会话。'));
    return shell('🔁 恢复历史会话', elements);
  }

  elements.push(HR);
  entries.forEach((e, i) => {
    const marker = e.current ? '  ← 当前' : '';
    const detail = e.detail ?? `${e.lineCount ?? 0} 条`;
    const displayId = e.displayId ?? e.sessionId;
    elements.push(
      divMd(
        `**${i + 1}.** ${escapeMd(e.preview)}${marker}\n\`${displayId.slice(0, 8)}…\` · ${e.relTime} · ${escapeMd(detail)}`,
      ),
    );
    elements.push(
      actions([
        {
          text: e.current ? '已是当前会话' : '▸ 恢复此会话',
          value: { cmd: 'resume.use', arg: e.sessionId },
          style: e.current ? 'default' : 'primary',
        },
      ]),
    );
    if (i < entries.length - 1) elements.push(HR);
  });

  return shell('🔁 恢复历史会话', elements);
}

/** One row in the `/sessions` overview: a session the bridge can continue. */
export interface SessionOverviewEntry {
  preview: string;
  /** The session's most recent message, when known. */
  lastPreview?: string;
  /** Short session id, so two similar-looking sessions stay distinguishable. */
  displayId?: string;
  relTime: string;
  detail?: string;
  current?: boolean;
  /**
   * Resume argument for the row's button. A one-time nonce from the resume
   * candidate store — never a raw session id, so a forwarded card cannot
   * resume someone else's session.
   */
  resumeArg?: string;
}

/** A titled group of rows — "这个聊天" vs. everything else on disk. */
export interface SessionOverviewSection {
  title: string;
  entries: SessionOverviewEntry[];
}

/** The conversation's own session, as stored by the bridge. */
export interface SessionOverview {
  sessionId?: string;
  relTime?: string;
  idleTimeoutMinutes?: number;
}

/**
 * `/sessions` overview: the sessions this conversation can continue, grouped
 * by where they came from. Each row is one full-width text button, so the row
 * itself is the thing you click — there is no separate restore button. Every
 * resumable row's payload is a one-time nonce.
 */
export function sessionsCard(
  overview: SessionOverview,
  cwd: string,
  sections: SessionOverviewSection[],
): object {
  const elements: object[] = [md(`\`${escapeCode(cwd)}\` 里的对话`)];

  if (overview.sessionId) {
    const meta = [
      ...(overview.relTime ? [overview.relTime] : []),
      ...(overview.idleTimeoutMinutes !== undefined
        ? [
            overview.idleTimeoutMinutes === 0
              ? '探活关闭'
              : `探活 ${overview.idleTimeoutMinutes} 分钟`,
          ]
        : []),
    ];
    elements.push(
      md(
        `当前会话 \`${escapeCode(overview.sessionId.slice(0, 8))}…\`${meta.length > 0 ? ` · ${meta.join(' · ')}` : ''}`,
      ),
    );
  } else {
    elements.push(md('当前会话：尚未建立（发一条消息后会创建）'));
  }

  const populated = sections.filter((section) => section.entries.length > 0);
  if (populated.length === 0) {
    elements.push(HR2);
    elements.push(md('此目录下没有可列出的会话。'));
  }
  for (const section of populated) {
    elements.push(HR2);
    elements.push(md(`**${escapeMd(section.title)}**`));
    section.entries.forEach((e, i) => {
      const heading = `**${i + 1}. ${escapeMd(e.preview)}**${e.current ? ' · 当前使用中' : ''}`;
      const facts = [
        ...(e.displayId ? [`\`${escapeCode(e.displayId)}\``] : []),
        escapeMd(e.relTime),
        ...(e.detail ? [escapeMd(e.detail)] : []),
      ].join(' · ');
      // A button's text renders on one line — newlines collapse — so the
      // clickable part is the title only and the details sit underneath it as
      // regular markdown, where line breaks survive.
      elements.push(
        e.resumeArg && !e.current
          ? rowButton(heading, { cmd: 'resume.use', arg: e.resumeArg })
          : md(heading),
      );
      elements.push(
        md([...(e.lastPreview ? [`最近：${escapeMd(e.lastPreview)}`] : []), facts].join('\n')),
      );
    });
  }

  elements.push(HR2);
  elements.push(md('点一行，下一条消息接续该会话；`/new` 会回到自动派生的那个。'));
  return shell2('📚 可接续的会话', elements);
}

/** Card JSON 2.0 shell. Container components reject `behaviors`, so the
 * clickable unit has to be a full-width text button. */
function shell2(title: string, elements: object[]): object {
  return {
    schema: '2.0',
    config: { update_multi: true, width_mode: 'fill' },
    header: { title: { tag: 'plain_text', content: title }, template: 'blue' },
    body: { elements },
  };
}

function md(content: string): object {
  return { tag: 'markdown', content };
}

const HR2: object = { tag: 'hr' };

/** One clickable row: borderless, full width, two lines of lark_md. */
function rowButton(content: string, value: Record<string, unknown>): object {
  return {
    tag: 'button',
    type: 'text',
    width: 'fill',
    text: { tag: 'lark_md', content },
    behaviors: [{ type: 'callback', value }],
  };
}

export function helpCard(agentName = 'Agent'): object {
  const escapedAgentName = escapeMd(agentName);
  return shell('💡 使用帮助', [
    divMd(
      [
        '**命令列表**',
        '',
        '- `/new` `/reset` — 清空当前 chat 的会话',
        '- `/new chat [name]` — 新建群+新会话，自动拉你进群',
        '- `/resume [N]` — 列出并恢复历史会话（最多 N 条）',
        '- `/sessions [N]` — 列出可接续的会话，点一行即可接续',
        '- `/sessions rm <id前缀>` — 删除一条历史会话（不可恢复）',
        '- `/compact` — 压缩当前会话的上下文（会话不变，仅 Claude）',
        '- `/cd <path>` — 切换工作目录（会重置 session）',
        '- `/ws list|save <name>|use <name>|remove <name>` — 工作目录',
        '- `/account` — 查看当前应用；`/account change` 换 appId/secret 并重连',
        '- `/config` — 调整偏好、访问控制和 lark-cli 身份策略',
        '- `/model` — 切换模型（卡片点选；`/model use <id>` / `/model reset`）',
        '- `/status` — 当前状态',
        '- `/stop` — 结束当前正在跑的任务（也可点卡片底部 ⏹ 终止 按钮）',
        '- `/stop comment:<scopeHash>` — 管理员停止云文档评论任务',
        '- `/timeout [N|off|default]` — 当前 session 的探活分钟数,`/config` 改全局默认',
        '- `/timeout comment:<scopeHash> N` — 管理员设置云文档评论任务探活',
        '- `/ps` — 列出本机所有 bot,标识当前正在回复的那个',
        '- `/exit <id|#>` — 关掉指定 bot(用 `/ps` 看 id/序号)',
        '- `/reconnect` — 强制重连 WebSocket(网络抖动后 bot 没反应时用)',
        `- \`/doctor [描述]\` — 把日志和描述交给 ${escapedAgentName} 自助诊断`,
        '- `/help` — 本帮助',
        '',
        `其他内容直接交给 ${escapedAgentName}。`,
      ].join('\n'),
    ),
    HR,
    actions([
      { text: '📊 状态', value: { cmd: 'status' }, style: 'primary' },
      { text: '🔁 恢复会话', value: { cmd: 'resume' } },
      { text: '📂 工作目录', value: { cmd: 'ws.list' } },
      { text: '🆕 新会话', value: { cmd: 'new' } },
    ]),
  ]);
}

function escapeMd(s: string): string {
  return s.replace(/([*_`\\])/g, '\\$1');
}

function escapeCode(s: string): string {
  return s.replace(/`/g, "'");
}
