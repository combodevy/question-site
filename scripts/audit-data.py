# -*- coding: utf-8 -*-
"""
@file scripts/audit-data.py
@description 英语真题数据体检（CI 用）。

检查项：
  乱码/编码异常、非法字符、文件编码、结构缺失、题数/题号不一致、
  选项异常、词库异常、答案引用异常（题号是否存在 + 字母是否在选项数范围内）

用法：
  python3 scripts/audit-data.py            # 有问题则退出码 1
  python3 scripts/audit-data.py --quiet    # 只打印汇总

★ 这些检查覆盖的都是「过去真实出过的问题」：完形节误判、正文混入题目、
  断词（activ ity）、私有区乱码（自动的/联盟/轨迹）、11 套卷缺 Section B、
  答案库题号对不上……把它们放进 CI，同类回归就再也进不了主干。
"""
import json
import os
import re
import sys
import unicodedata
import collections

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'english')
PAPERS = os.path.join(ROOT, 'papers')
QUIET = '--quiet' in sys.argv

# ---------- 乱码特征 ----------
MOJIBAKE = [
    ('替换字符 U+FFFD', re.compile('\ufffd')),
    ('GBK 乱码 锟斤拷', re.compile('锟|斤拷')),
    ('UTF-8 被当 Latin-1（â€ / Ã© 等）', re.compile('[ÃÂ][\u0080-\u00bf\u2013-\u2122]|â€|â€™|â€œ|â€\x9d')),
    ('ï¿½ 形式', re.compile('ï¿½')),
    ('连续拉丁扩展字符（>=3 个）', re.compile('[À-ÿ]{3,}')),
    ('控制字符', re.compile('[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]')),
    ('代理区/私有区字符', re.compile('[\ue000-\uf8ff\ud800-\udfff]')),
    ('零宽/BOM', re.compile('[\ufeff\u200b-\u200f]')),
]


def scan_text(s, where, issues):
    if not isinstance(s, str):
        return
    for name, rx in MOJIBAKE:
        m = rx.search(s)
        if m:
            i = m.start()
            issues['mojibake'].append((where, name, repr(s[max(0, i - 30):i + 30])))
    for ch in s:
        o = ord(ch)
        if o in (0x0a, 0x0d, 0x09):
            continue
        if unicodedata.category(ch) in ('Cc', 'Cs', 'Co', 'Cn'):
            issues['badchar'].append((where, hex(o), unicodedata.name(ch, '?')))


def main():
    issues = collections.defaultdict(list)
    stats = collections.Counter()

    files = sorted(f for f in os.listdir(PAPERS) if f.endswith('.json'))
    index = {}
    for cat in ('cet4', 'cet6', 'kaoyan'):
        with open(os.path.join(ROOT, 'index-%s.json' % cat), encoding='utf-8') as fh:
            for it in json.load(fh):
                index[it['id']] = it
    with open(os.path.join(ROOT, 'keys.json'), encoding='utf-8') as fh:
        keys = json.load(fh)

    seen_ids = set()
    for fn in files:
        path = os.path.join(PAPERS, fn)
        raw = open(path, 'rb').read()
        try:
            raw.decode('utf-8')
        except UnicodeDecodeError as e:
            issues['encoding'].append((fn, '文件不是合法 UTF-8', str(e)))
            continue
        d = json.loads(raw.decode('utf-8'))
        pid = d.get('id')
        seen_ids.add(pid)
        stats['papers'] += 1

        for k in ('id', 'title', 'category', 'ym', 'set', 'year', 'sections', 'questions'):
            if k not in d:
                issues['structure'].append((pid, '缺字段 ' + k))
        scan_text(d.get('title'), pid + ' title', issues)
        if pid not in index:
            issues['structure'].append((pid, '索引里没有这套卷'))
        else:
            if index[pid].get('qCount') != len(d.get('questions') or []):
                issues['count'].append((pid, 'index qCount=%s 实际=%d' % (index[pid].get('qCount'), len(d['questions']))))
            if index[pid].get('title') != d.get('title'):
                issues['structure'].append((pid, '索引 title 与试卷不一致'))
            if not os.path.exists(os.path.join(ROOT, index[pid].get('file', ''))):
                issues['structure'].append((pid, '索引 file 路径不存在: %s' % index[pid].get('file')))

        secs = d.get('sections') or {}
        qs = d.get('questions') or []
        if not secs:
            issues['structure'].append((pid, '没有任何 section'))
        if not qs:
            issues['structure'].append((pid, '没有任何题目'))

        for sec, meta in secs.items():
            where = '%s §%s' % (pid, sec)
            if not meta.get('label'):
                issues['structure'].append((where, 'label 为空'))
            scan_text(meta.get('label'), where + ' label', issues)
            p = meta.get('passage') or ''
            scan_text(p, where + ' passage', issues)
            w = meta.get('words') or []
            for i, x in enumerate(w):
                scan_text(x, '%s words[%d]' % (where, i), issues)
            if not p and not w:
                issues['structure'].append((where, '既没有 passage 也没有 words'))
            if w and len(w) < 10:
                issues['structure'].append((where, '词库只有 %d 个词' % len(w)))
            for i, x in enumerate(w):
                if not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*", str(x)):
                    issues['words'].append((where, 'words[%d]=%r 不是单个英文词' % (i, x)))
            if w and len(set(w)) != len(w):
                issues['words'].append((where, '词库有重复项'))

        bysec = collections.defaultdict(list)
        qmap = {}
        for q in qs:
            no, sec = q.get('no'), q.get('sec')
            where = '%s Q%s' % (pid, no)
            if no is None or sec is None:
                issues['structure'].append((where, '缺 no/sec'))
                continue
            qmap[no] = q
            bysec[sec].append(no)
            if sec not in secs:
                issues['structure'].append((where, 'section %r 不存在' % sec))
            qtext = q.get('q') or ''
            scan_text(qtext, where + ' q', issues)
            if not qtext.strip():
                issues['structure'].append((where, '题干为空'))
            o = q.get('o') or []
            for i, x in enumerate(o):
                scan_text(str(x), '%s o[%d]' % (where, i), issues)
            if not o:
                issues['structure'].append((where, '没有选项'))
            # 选项数量：常规题 2/3/4 个；有词库的完形节 = 词库；段落匹配 = 单个字母
            has_bank = bool((secs.get(sec) or {}).get('words'))
            letter_only = bool(o) and all(re.fullmatch(r'[A-Z]', str(x)) for x in o)
            if not has_bank and not letter_only and len(o) not in (2, 3, 4):
                issues['options'].append((where, '选项数量异常 %d' % len(o)))
            for i, x in enumerate(o):
                if not str(x).strip():
                    issues['options'].append((where, 'o[%d] 为空' % i))
            # 选项里不该还带字母前缀（界面会自己加）；有词库的完形节例外
            if not has_bank:
                for i, x in enumerate(o):
                    if re.match(r'^[A-O][\)\.]\s', str(x)):
                        issues['options'].append((where, 'o[%d]=%r 带字母前缀' % (i, str(x)[:30])))

        for sec, nos in bysec.items():
            nos = sorted(nos)
            if nos[-1] - nos[0] + 1 != len(nos):
                issues['count'].append((pid, '§%s 题号 %s-%s 有 %d 题（不连续）' % (sec, nos[0], nos[-1], len(nos))))

        # 答案引用：题号必须存在，字母必须落在该题选项数范围内
        for k, v in (keys.get(pid) or {}).items():
            no = int(k)
            q = qmap.get(no)
            if q is None:
                issues['keys'].append((pid, '答案 %s 在试卷里不存在' % k))
                continue
            L = str(v).upper()
            if not re.fullmatch(r'[A-Z]', L):
                issues['keys'].append((pid, '答案 %s=%r 不是单个字母' % (k, v)))
                continue
            nopt = len(q.get('o') or [])
            if ord(L) - 64 > nopt:
                issues['keys'].append((pid, '答案 %s=%s 超出该题选项数 %d' % (k, L, nopt)))

    for pid in index:
        if pid not in seen_ids:
            issues['structure'].append((pid, '索引里有但试卷文件缺失'))
    for pid in keys:
        if pid not in seen_ids:
            issues['keys'].append((pid, 'keys 里有但试卷不存在'))

    print('试卷总数: %d   索引条目: %d   keys 覆盖: %d' % (stats['papers'], len(index), len(keys)))
    print()
    titles = [
        ('mojibake', '乱码/编码异常'),
        ('badchar', '非法字符'),
        ('encoding', '文件编码'),
        ('structure', '结构缺失'),
        ('count', '题数/题号不一致'),
        ('options', '选项异常'),
        ('words', '词库异常'),
        ('keys', '答案引用异常'),
    ]
    total = 0
    for k, t in titles:
        v = issues.get(k, [])
        total += len(v)
        print('### %s —— %d 条' % (t, len(v)))
        if not QUIET:
            for x in v[:12]:
                print('   ', x)
            if len(v) > 12:
                print('    … 其余 %d 条' % (len(v) - 12))
    print()
    print('问题合计:', total)
    return 1 if total else 0


if __name__ == '__main__':
    sys.exit(main())
