import { describe, expect, it } from 'vitest';
import { sessionsCard } from '../../../src/card/templates.js';

describe('sessionsCard', () => {
  const card = (sections: Parameters<typeof sessionsCard>[2]) =>
    sessionsCard({ sessionId: 'abcdef12-3456', relTime: '3 分钟前' }, '/tmp/w', sections);

  it('makes each resumable row itself the click target', () => {
    const text = JSON.stringify(
      card([
        {
          title: '这个聊天',
          entries: [{ preview: '当前会话', relTime: '刚刚', current: true, resumeArg: 'nonce-2' }],
        },
        {
          title: '其它来源',
          entries: [
            {
              preview: '旧会话',
              lastPreview: '最近一句话',
              displayId: 'abcdef12',
              relTime: '昨天',
              detail: '7 条',
              resumeArg: 'nonce-1',
            },
          ],
        },
      ]),
    );
    expect(text).toContain('可接续的会话');
    expect(text).toContain('这个聊天');
    expect(text).toContain('其它来源');
    expect(text).toContain('当前使用中');
    expect(text).toContain('最近：最近一句话');
    expect(text).toContain('abcdef12');
    expect(text).toContain('resume.use');
    expect(text).toContain('nonce-1');
    // No separate per-row restore button label.
    expect(text).not.toContain('恢复此会话');
    // The active row is a label, not a no-op click target.
    expect(text).not.toContain('nonce-2');
  });

  it('renders every non-current row as a full-width text button', () => {
    const built = card([
      { title: '其它来源', entries: [{ preview: '旧会话', relTime: '昨天', resumeArg: 'n1' }] },
    ]) as { body: { elements: Array<Record<string, unknown>> } };
    const rows = built.body.elements.filter((el) => el.tag === 'button');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: 'text',
      width: 'fill',
      behaviors: [{ type: 'callback', value: { cmd: 'resume.use', arg: 'n1' } }],
    });
  });

  it('omits click targets when a row has no resume argument', () => {
    const built = card([
      { title: '其它来源', entries: [{ preview: '无按钮', relTime: '昨天' }] },
    ]) as { body: { elements: Array<Record<string, unknown>> } };
    expect(built.body.elements.some((el) => el.tag === 'button')).toBe(false);
  });

  it('drops empty sections instead of printing a bare heading', () => {
    const text = JSON.stringify(
      card([
        { title: '这个聊天', entries: [] },
        { title: '其它来源', entries: [{ preview: '一条', relTime: '昨天' }] },
      ]),
    );
    expect(text).not.toContain('这个聊天');
    expect(text).toContain('其它来源');
  });
});
