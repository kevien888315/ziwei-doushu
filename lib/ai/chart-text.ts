/**
 * lib/ai/chart-text —— 把 ZiweiChart 结构压成给模型看的纯文本命盘摘要
 *
 * 只做数据序列化，不含任何断语；断语由模型基于系统提示词生成。
 */
import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { STEMS, BRANCHES } from '@/lib/ziwei/constants';

const SHICHEN_NAMES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

function starText(s: Star): string {
  let t = s.name;
  if (s.brightnessRaw) t += `(${s.brightnessRaw})`;
  if (s.siHua) t += `化${s.siHua}`;
  return t;
}

function palaceLine(p: Palace): string {
  const ganzhi = `${STEMS[p.stem]}${BRANCHES[p.branch]}`;
  const tags: string[] = [];
  if (p.isMingGong) tags.push('命宫');
  if (p.isShenGong) tags.push('身宫');
  if (p.isCurrentDaXian) tags.push('当前大限');
  const major = p.stars.filter(s => s.type === 'major').map(starText);
  const minor = p.stars.filter(s => s.type === 'minor').map(starText);
  const lucky = p.stars.filter(s => s.type === 'lucky').map(starText);
  const sha = p.stars.filter(s => s.type === 'sha').map(starText);

  const parts: string[] = [];
  parts.push(`【${p.name}·${ganzhi}】${tags.length ? `[${tags.join('/')}]` : ''}`);
  if (p.daXianAge) parts.push(`大限${p.daXianAge[0]}–${p.daXianAge[1]}岁`);
  if (major.length) parts.push(`主星：${major.join('、')}`);
  else if (p.isEmpty) parts.push(`空宫${p.borrowedStars?.length ? `（借对宫${p.borrowedFromName ?? ''}：${p.borrowedStars.join('、')}）` : ''}`);
  if (lucky.length) parts.push(`吉星：${lucky.join('、')}`);
  if (sha.length) parts.push(`煞星：${sha.join('、')}`);
  if (minor.length) parts.push(`杂曜：${minor.join('、')}`);
  if (p.selfSihua?.length) parts.push(`自化：${p.selfSihua.map(x => `${x.starName}自化${x.siHua}`).join('、')}`);
  return parts.join(' ');
}

/** 从命宫开始按十二宫顺序（逆行地支）排列 */
function orderedPalaces(chart: ZiweiChart): Palace[] {
  const byBranch = new Map(chart.palaces.map(p => [p.branch, p]));
  const out: Palace[] = [];
  for (let i = 0; i < 12; i++) {
    const b = ((chart.mingGongBranch - i) % 12 + 12) % 12;
    const p = byBranch.get(b);
    if (p) out.push(p);
  }
  return out.length === 12 ? out : chart.palaces;
}

export function chartToText(chart: ZiweiChart, label?: string): string {
  const b = chart.birthInfo;
  const l = chart.lunarInfo;
  const lines: string[] = [];

  if (label) lines.push(`=== ${label} ===`);
  const who = [b.name ? `姓名：${b.name}` : null, `性别：${b.gender === 'male' ? '男' : '女'}`, chart.yinYangGender ? `（${chart.yinYangGender}）` : null]
    .filter(Boolean).join(' ');
  lines.push(who);
  lines.push(`公历：${b.year}年${b.month}月${b.day}日 ${SHICHEN_NAMES[b.hour] ?? ''}时${b.city ? `，出生地 ${b.province ?? ''}${b.city}` : ''}`);
  lines.push(`农历：${l.lunarYear}年${l.isLeapMonth ? '闰' : ''}${Math.abs(l.lunarMonth)}月${l.lunarDay}日（${STEMS[l.yearStem]}${BRANCHES[l.yearBranch]}年）`);
  if (l.fourPillars) lines.push(`四柱：${l.fourPillars.join(' ')}`);
  lines.push(`五行局：${chart.wuxingJuName}；命宫在${BRANCHES[chart.mingGongBranch]}，身宫在${BRANCHES[chart.shenGongBranch]}${chart.mingZhu ? `；命主${chart.mingZhu}` : ''}${chart.shenZhu ? `，身主${chart.shenZhu}` : ''}`);

  const cur = chart.daXians[chart.currentDaXianIndex];
  lines.push(`现年 ${chart.currentAge} 岁${cur ? `，当前大限 ${cur.startAge}–${cur.endAge} 岁行${cur.palaceName}（${cur.stemName ?? ''}${BRANCHES[cur.palaceBranch]}）` : ''}`);
  if (cur?.siHua) {
    lines.push(`当前大限四化：${cur.siHua.lu}化禄、${cur.siHua.quan}化权、${cur.siHua.ke}化科、${cur.siHua.ji}化忌`);
  }

  lines.push('');
  lines.push('十二宫（从命宫起）：');
  for (const p of orderedPalaces(chart)) lines.push(palaceLine(p));

  lines.push('');
  lines.push('大限顺序：' + chart.daXians.map(d => `${d.startAge}–${d.endAge}${d.palaceName}`).join('，'));

  return lines.join('\n');
}
