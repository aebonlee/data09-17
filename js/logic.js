/*
 * 품질불량 이력 분석 도구 — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.QCLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때
 * 브라우저가 module 스크립트를 막기 때문입니다.
 *
 * 표준 항목(STD_FIELDS)은 기획서 3장 「품질불량 이력」의 가정 열 구성을 옮긴 것입니다.
 * 실제 이력 Excel 샘플을 받기 전이라 열 이름은 가정이며, 수강생 파일의 열 이름은
 * 불러오기 때 「열 맞추기」 단계에서 연결합니다(synonyms 는 자동 추천용).
 */
(function (root) {
  'use strict';

  // ── 표준 항목 ────────────────────────────────────────────────
  var STD_FIELDS = [
    { key: 'mgmt_no', label: '관리번호', type: 'text', synonyms: ['관리번호', '관리 번호', 'no', '번호', '접수번호', '이슈번호', '불량번호', '문서번호'] },
    { key: 'date', label: '발생일', type: 'date', required: true, synonyms: ['발생일', '발생일자', '일자', '날짜', '접수일', '발생 일자', '발견일', 'date'] },
    { key: 'part_no', label: '품번', type: 'text', synonyms: ['품번', '품목번호', '부품번호', 'p/n', 'pn', 'partno', '품목코드', '자재번호'] },
    { key: 'part_name', label: '품명', type: 'text', synonyms: ['품명', '품목명', '부품명', '제품명', 'partname'] },
    { key: 'defect_type', label: '불량유형', type: 'class', synonyms: ['불량유형', '불량 유형', '유형', '불량구분', '불량 구분', '불량명', '불량항목', '결함유형'] },
    { key: 'symptom', label: '불량현상', type: 'text', synonyms: ['불량현상', '불량 현상', '현상', '불량내용', '불량 내용', '문제점', '이슈내용'] },
    { key: 'cause_cat', label: '원인 분류', type: 'class', synonyms: ['원인분류', '원인 분류', '원인구분', '원인 구분', '원인유형', '4m'] },
    { key: 'cause', label: '발생원인', type: 'text', synonyms: ['발생원인', '발생 원인', '원인', '원인분석', '불량원인', '추정원인'] },
    { key: 'action', label: '개선대책', type: 'text', synonyms: ['개선대책', '개선 대책', '대책', '조치', '조치내용', '조치사항', '시정조치'] },
    { key: 'prevention', label: '재발방지대책', type: 'text', synonyms: ['재발방지대책', '재발방지', '재발 방지', '재발방지 대책', '예방대책'] },
    { key: 'qty', label: '불량수량', type: 'number', synonyms: ['불량수량', '불량 수량', '수량', '불량수', 'qty', '개수'] },
    { key: 'process', label: '공정', type: 'text', synonyms: ['공정', '발생공정', '발생 공정', '공정명', '라인', '작업장'] },
    { key: 'customer', label: '고객사', type: 'text', synonyms: ['고객사', '고객', '납품처', '업체', '거래처', 'customer'] }
  ];
  var FIELD = {};
  STD_FIELDS.forEach(function (f) { FIELD[f.key] = f; });

  // 표기 묶음 사전이 적용되는 항목
  var DICT_FIELDS = ['defect_type', 'cause_cat', 'cause'];

  // 반복·다발 묶음 기준
  var GROUP_BY = {
    part_defect: { label: '같은 품번 · 같은 불량유형', keys: ['part_no', 'defect_type'] },
    defect: { label: '같은 불량유형(품번 무관)', keys: ['defect_type'] },
    part: { label: '같은 품번(유형 무관)', keys: ['part_no'] },
    part_cause: { label: '같은 품번 · 같은 원인', keys: ['part_no', 'cause'] }
  };
  // 사용자가 바꾸기 전의 시작값일 뿐입니다(기획서 10장 6번 「반복·다발 기준」 확인 전).
  var DEFAULT_RULE = { groupBy: 'part_defect', days: 30, min: 3 };
  var DEFAULT_SEARCH = { partBonus: 2, typeBonus: 2, limit: 10 };

  function emptyDb() {
    return { rows: [], mapping: {}, dict: { defect_type: {}, cause_cat: {}, cause: {} }, rule: Object.assign({}, DEFAULT_RULE), search: Object.assign({}, DEFAULT_SEARCH), draft: {}, seq: 0 };
  }

  // ── 값 다듬기 ────────────────────────────────────────────────
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
  function validYmd(y, m, d) {
    if (!(y >= 1900 && y <= 2999 && m >= 1 && m <= 12 && d >= 1)) return false;
    return d <= new Date(y, m, 0).getDate();
  }
  function toDateStr(d) { return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  function fromSerial(n) {
    var d = new Date(Math.round((n - 25569) * 86400000));
    return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  // 날짜 칸: Date, 엑셀 일련번호, 「2026-09-01」「2026.9.1」「2026/09/01」「2026년 9월 1일」「20260901」
  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : toDateStr(v);
    if (typeof v === 'number') return v > 20000 && v < 80000 ? fromSerial(v) : null;
    var s = String(v).trim();
    var m = s.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return /^\d{5}(\.\d+)?$/.test(s) ? parseDate(parseFloat(s)) : null;
    var y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? ymd(y, mo, d) : null;
  }
  // 숫자 칸: 「1,234」「12 EA」「5개」 → 숫자. 못 읽으면 null.
  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    var s = String(v).trim().replace(/,/g, '');
    var m = s.match(/^([-+]?\d+(?:\.\d+)?)\s*[a-zA-Z가-힣%]*$/);
    return m ? parseFloat(m[1]) : null;
  }
  function text(v) {
    if (v == null) return '';
    if (v instanceof Date) return toDateStr(v);
    return String(v).replace(/\r\n?/g, '\n').trim();
  }
  function monthOf(date) { return date ? String(date).slice(0, 7) : ''; }
  function dayNum(date) {
    var p = String(date).split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }

  function normalizeRow(src) {
    var row = {}, bad = [];
    STD_FIELDS.forEach(function (f) {
      var v = src[f.key], out;
      if (f.type === 'date') out = parseDate(v);
      else if (f.type === 'number') out = parseNum(v);
      else out = text(v);
      if ((f.type === 'date' || f.type === 'number') && out == null && v != null && String(v).trim() !== '') bad.push(f.key);
      row[f.key] = out == null ? (f.type === 'text' || f.type === 'class' ? '' : null) : out;
    });
    if (bad.length) {
      row._unreadable = bad;
      row._raw = {};
      bad.forEach(function (k) { row._raw[k] = String(src[k]); });
    }
    return row;
  }

  // ── 열 맞추기 ────────────────────────────────────────────────
  function squash(s) { return String(s == null ? '' : s).toLowerCase().replace(/[\s_\-()（）\[\]·.,:/'"]/g, ''); }
  function matchField(header) {
    var h = squash(header);
    if (!h) return null;
    for (var i = 0; i < STD_FIELDS.length; i++) {
      var f = STD_FIELDS[i];
      if (squash(f.label) === h || squash(f.key) === h) return f.key;
      for (var j = 0; j < f.synonyms.length; j++) if (squash(f.synonyms[j]) === h) return f.key;
    }
    return null;
  }
  function detectHeaderRow(aoa) {
    var best = -1, bestScore = 0;
    for (var i = 0; i < Math.min(10, aoa.length); i++) {
      var score = 0;
      (aoa[i] || []).forEach(function (c) { if (matchField(c)) score++; });
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best >= 0 && bestScore >= 2) return best;
    for (var k = 0; k < aoa.length; k++) {
      if ((aoa[k] || []).some(function (c) { return String(c == null ? '' : c).trim() !== ''; })) return k;
    }
    return 0;
  }
  function headersOf(aoa, headerRow) {
    return (aoa[headerRow] || []).map(function (c) { return String(c == null ? '' : c).trim(); });
  }
  function autoMap(headers, saved) {
    var map = {}, used = {};
    if (saved) Object.keys(saved).forEach(function (k) {
      if (FIELD[k] && headers.indexOf(saved[k]) >= 0 && !used[saved[k]]) { map[k] = saved[k]; used[saved[k]] = true; }
    });
    headers.forEach(function (h) {
      if (!h || used[h]) return;
      var k = matchField(h);
      if (k && !map[k]) { map[k] = h; used[h] = true; }
    });
    return map;
  }
  function applyMapping(aoa, opts) {
    var headers = headersOf(aoa, opts.headerRow);
    var idx = {};
    Object.keys(opts.mapping || {}).forEach(function (k) {
      var i = headers.indexOf(opts.mapping[k]);
      if (i >= 0) idx[k] = i;
    });
    var rows = [], skipped = 0;
    for (var r = opts.headerRow + 1; r < aoa.length; r++) {
      var line = aoa[r] || [];
      if (!line.some(function (c) { return c != null && String(c).trim() !== ''; })) { skipped++; continue; }
      var src = {};
      Object.keys(idx).forEach(function (k) { src[k] = line[idx[k]]; });
      var row = normalizeRow(src);
      row._src = (opts.fileName || '') + (opts.sheetName ? ' / ' + opts.sheetName : '') + ' ' + (r + 1) + '행';
      rows.push(row);
    }
    return { rows: rows, skipped: skipped };
  }

  // ── 입력값 검사 ──────────────────────────────────────────────
  function validateRows(rows) {
    var out = [];
    rows.forEach(function (row) {
      (row._unreadable || []).forEach(function (k) {
        out.push({ id: row.id, level: 'error', field: k, msg: FIELD[k].label + ' 값을 읽지 못했습니다(「' + row._raw[k] + '」)' });
      });
      var dateBad = (row._unreadable || []).indexOf('date') >= 0;
      if (!row.date && !dateBad) out.push({ id: row.id, level: 'error', field: 'date', msg: '발생일이 비어 있습니다' });
      if (!row.part_no) out.push({ id: row.id, level: 'warn', field: 'part_no', msg: '품번이 비어 있습니다' });
      if (!row.defect_type) out.push({ id: row.id, level: 'warn', field: 'defect_type', msg: '불량유형이 비어 있습니다' });
      if (row.qty != null && row.qty < 0) out.push({ id: row.id, level: 'error', field: 'qty', msg: '불량수량이 음수입니다' });
    });
    return out;
  }
  function issueSummary(issues) {
    var s = { error: 0, warn: 0, rows: 0 }, ids = {};
    issues.forEach(function (i) { s[i.level]++; ids[i.id] = true; });
    s.rows = Object.keys(ids).length;
    return s;
  }

  // ── 표기 묶음 사전 ───────────────────────────────────────────
  // dict[field] = { squash(원래 표기): 대표 이름 }.
  // 사전에 없는 값은 띄어쓰기·대소문자·기호만 다른 표기끼리 「가장 많이 쓴 표기」로 자동으로 맞춥니다(auto).
  function autoCanon(rows, field) {
    var cnt = {};
    rows.forEach(function (r) {
      var v = text(r[field]);
      if (!v) return;
      var k = squash(v);
      var c = cnt[k] || (cnt[k] = {});
      c[v] = (c[v] || 0) + 1;
    });
    var out = {};
    Object.keys(cnt).forEach(function (k) {
      out[k] = Object.keys(cnt[k]).sort(function (a, b) { return cnt[k][b] - cnt[k][a] || (a < b ? -1 : 1); })[0];
    });
    return out;
  }
  function canon(dict, field, value, auto) {
    var v = text(value);
    if (!v) return '';
    var d = dict && dict[field];
    var k = squash(v);
    if (d && Object.prototype.hasOwnProperty.call(d, k) && d[k]) return d[k];
    if (auto && auto[field] && auto[field][k]) return auto[field][k];
    return v;
  }
  // 한 행을 사전으로 바꾼 사본(원래 행은 그대로 둡니다)
  function canonRow(dict, row, auto) {
    var r = Object.assign({}, row);
    DICT_FIELDS.forEach(function (f) { r[f] = canon(dict, f, row[f], auto); });
    return r;
  }
  function canonRows(dict, rows) {
    var auto = {};
    DICT_FIELDS.forEach(function (f) { auto[f] = autoCanon(rows, f); });
    return rows.map(function (r) { return canonRow(dict, r, auto); });
  }
  // 한 항목에 쓰인 표기 목록: 띄어쓰기 등만 다른 표기는 한 줄로 묶어 보여 줍니다.
  function distinctValues(rows, field, dict) {
    var map = {};
    rows.forEach(function (r) {
      var v = text(r[field]);
      if (!v) return;
      var k = squash(v);
      var e = map[k] || (map[k] = { key: k, spellings: {}, count: 0 });
      e.spellings[v] = (e.spellings[v] || 0) + 1;
      e.count++;
    });
    return Object.keys(map).map(function (k) {
      var e = map[k];
      var sp = Object.keys(e.spellings).sort(function (a, b) { return e.spellings[b] - e.spellings[a] || (a < b ? -1 : 1); });
      var mapped = dict && dict[field] && dict[field][k];
      return { key: k, spellings: sp, count: e.count, canonical: mapped || sp[0], mapped: !!mapped };
    }).sort(function (a, b) { return b.count - a.count || (a.canonical < b.canonical ? -1 : 1); });
  }

  // ── 거르기·집계 ──────────────────────────────────────────────
  // rows 는 canonRows 를 거친 것을 넣습니다.
  function filterRows(rows, f) {
    f = f || {};
    var kw = f.keyword ? String(f.keyword).trim().toLowerCase() : '';
    return rows.filter(function (r) {
      if (f.from && (!r.date || r.date < f.from)) return false;
      if (f.to && (!r.date || r.date > f.to)) return false;
      if (f.part_no && r.part_no !== f.part_no) return false;
      if (f.defect_type && r.defect_type !== f.defect_type) return false;
      if (f.cause && causeKey(r) !== f.cause) return false;
      if (f.process && r.process !== f.process) return false;
      if (f.customer && r.customer !== f.customer) return false;
      if (kw) {
        var hay = [r.mgmt_no, r.part_no, r.part_name, r.defect_type, r.symptom, r.cause_cat, r.cause, r.action, r.prevention, r.process, r.customer].join(' ').toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
  }
  // 「원인별」 축: 원인 분류 열이 있으면 그것, 없으면 발생원인 문장
  function causeKey(r) { return r.cause_cat || r.cause || ''; }
  function valuesOf(rows, getter) {
    var m = {};
    rows.forEach(function (r) { var v = typeof getter === 'function' ? getter(r) : r[getter]; if (v) m[v] = true; });
    return Object.keys(m).sort();
  }
  // 축별 집계: [{ key, count, qty }] 건수 많은 순
  function groupCount(rows, axis) {
    var get = axis === 'cause' ? causeKey : function (r) { return r[axis]; };
    var m = {};
    rows.forEach(function (r) {
      var k = get(r) || '(비어 있음)';
      var e = m[k] || (m[k] = { key: k, count: 0, qty: 0 });
      e.count++;
      if (r.qty != null) e.qty += r.qty;
    });
    return Object.keys(m).map(function (k) { return m[k]; })
      .sort(function (a, b) { return b.count - a.count || b.qty - a.qty || (a.key < b.key ? -1 : 1); });
  }

  // ── 유사 불량 검색 ───────────────────────────────────────────
  var JOSA = ['으로', '에서', '에게', '부터', '까지', '이며', '이고', '하여', '해서', '됨', '함', '이', '가', '은', '는', '을', '를', '에', '의', '로', '과', '와', '도', '만'];
  // 낱말로 자릅니다: 기호로 나누고, 끝의 조사 하나를 뗍니다(남는 말이 2자 이상일 때만). 1자 낱말은 버립니다.
  function tokenize(s) {
    var out = [], seen = {};
    String(s == null ? '' : s).toLowerCase().split(/[^0-9a-z가-힣]+/).forEach(function (w) {
      if (!w) return;
      for (var i = 0; i < JOSA.length; i++) {
        var j = JOSA[i];
        if (w.length - j.length >= 2 && w.slice(-j.length) === j && /[가-힣]$/.test(w)) { w = w.slice(0, -j.length); break; }
      }
      if (w.length < 2 || seen[w]) return;
      seen[w] = true;
      out.push(w);
    });
    return out;
  }
  function rowText(r) { return [r.part_name, r.defect_type, r.symptom, r.cause_cat, r.cause, r.process].join(' '); }
  // 한 낱말이 이력 쪽 낱말과 같거나, 한쪽이 다른 쪽을 품으면(2자 이상) 겹친 것으로 봅니다.
  function tokenHit(q, list) {
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      if (t === q || (q.length >= 2 && t.indexOf(q) >= 0) || (t.length >= 2 && q.indexOf(t) >= 0)) return true;
    }
    return false;
  }
  // query: { text, part_no, defect_type }. rows 는 canonRows 를 거친 것.
  // 점수 = 겹친 낱말 수 + (같은 품번이면 partBonus) + (같은 불량유형이면 typeBonus)
  function searchSimilar(rows, query, opt) {
    opt = Object.assign({}, DEFAULT_SEARCH, opt || {});
    var qTokens = tokenize(query.text);
    var qPart = squash(query.part_no), qType = squash(query.defect_type);
    var res = [];
    rows.forEach(function (r) {
      if (query.excludeId && r.id === query.excludeId) return;
      var rt = tokenize(rowText(r));
      var matched = qTokens.filter(function (q) { return tokenHit(q, rt); });
      var samePart = !!qPart && squash(r.part_no) === qPart;
      var sameType = !!qType && squash(r.defect_type) === qType;
      var score = matched.length + (samePart ? opt.partBonus : 0) + (sameType ? opt.typeBonus : 0);
      if (score <= 0) return;
      res.push({ row: r, score: score, matched: matched, samePart: samePart, sameType: sameType });
    });
    res.sort(function (a, b) { return b.score - a.score || ((b.row.date || '') < (a.row.date || '') ? -1 : (b.row.date || '') > (a.row.date || '') ? 1 : 0); });
    return opt.limit ? res.slice(0, opt.limit) : res;
  }

  // ── 반복·다발 탐지 ───────────────────────────────────────────
  // 규칙: 같은 묶음(예: 품번+불량유형)이 N일 안(첫 건과 마지막 건 날짜 차이가 N-1일 이하)에 M건 이상.
  // 조건을 채우는 창에 든 건들을 이어 붙여 「구간」 하나로 보여 줍니다.
  function groupKeyOf(r, keys) {
    var parts = keys.map(function (k) { return k === 'cause' ? causeKey(r) : r[k]; });
    return parts.some(function (p) { return !p; }) ? null : parts;
  }
  function detectRepeats(rows, rule) {
    rule = Object.assign({}, DEFAULT_RULE, rule || {});
    var days = Math.floor(Number(rule.days)), min = Math.floor(Number(rule.min));
    if (!(days >= 1) || !(min >= 2)) throw new Error('기간은 1일 이상, 건수는 2건 이상이어야 합니다');
    var gb = GROUP_BY[rule.groupBy] || GROUP_BY.part_defect;
    var groups = {};
    rows.forEach(function (r) {
      if (!r.date) return;
      var parts = groupKeyOf(r, gb.keys);
      if (!parts) return;
      var k = parts.join('\u0001');
      (groups[k] = groups[k] || { parts: parts, rows: [] }).rows.push(r);
    });
    var out = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var list = g.rows.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      var dn = list.map(function (r) { return dayNum(r.date); });
      var flag = new Array(list.length);
      var j = 0;
      for (var i = 0; i < list.length; i++) {
        while (dn[i] - dn[j] > days - 1) j++;
        if (i - j + 1 >= min) for (var x = j; x <= i; x++) flag[x] = true;
      }
      // 이어진 표시 구간 묶기: 표시된 건끼리 날짜 간격이 N-1일 이하면 같은 구간
      var cur = null;
      for (var y = 0; y < list.length; y++) {
        if (!flag[y]) continue;
        if (cur && dn[y] - dayNum(cur.last) <= days - 1) { cur.rows.push(list[y]); cur.last = list[y].date; }
        else {
          cur = { parts: g.parts, label: g.parts.join(' · '), first: list[y].date, last: list[y].date, rows: [list[y]] };
          out.push(cur);
        }
      }
    });
    out.forEach(function (e) {
      e.count = e.rows.length;
      e.qty = e.rows.reduce(function (s, r) { return s + (r.qty || 0); }, 0);
      e.span = dayNum(e.last) - dayNum(e.first) + 1;
    });
    out.sort(function (a, b) { return a.last < b.last ? 1 : a.last > b.last ? -1 : b.count - a.count; });
    return out;
  }

  // ── 월간 현황 ────────────────────────────────────────────────
  function monthRange(from, to) {
    var out = [];
    if (!from || !to || from > to) return out;
    var y = +from.slice(0, 4), m = +from.slice(5, 7);
    while (true) {
      var k = y + '-' + pad(m);
      if (k > to) break;
      out.push(k);
      m++; if (m > 12) { m = 1; y++; }
      if (out.length > 240) break;
    }
    return out;
  }
  // 월별 건수·수량(빈 달도 0 으로 채움)
  function monthlyTotals(rows, fromMonth, toMonth) {
    var m = {};
    rows.forEach(function (r) {
      var k = monthOf(r.date);
      if (!k) return;
      var e = m[k] || (m[k] = { count: 0, qty: 0 });
      e.count++;
      if (r.qty != null) e.qty += r.qty;
    });
    var keys = Object.keys(m).sort();
    var from = fromMonth || keys[0], to = toMonth || keys[keys.length - 1];
    return monthRange(from, to).map(function (k) { return { month: k, count: m[k] ? m[k].count : 0, qty: m[k] ? m[k].qty : 0 }; });
  }
  function monthReport(rows, month, topN) {
    var inMonth = rows.filter(function (r) { return monthOf(r.date) === month; });
    var n = topN || 5;
    return {
      month: month,
      count: inMonth.length,
      qty: inMonth.reduce(function (s, r) { return s + (r.qty || 0); }, 0),
      byType: groupCount(inMonth, 'defect_type').slice(0, n),
      byPart: groupCount(inMonth, 'part_no').slice(0, n),
      byCause: groupCount(inMonth, 'cause').slice(0, n),
      rows: inMonth
    };
  }
  function prevMonth(month) {
    var y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
    if (m < 1) { m = 12; y--; }
    return y + '-' + pad(m);
  }

  // ── 대책서 초안 프롬프트 ─────────────────────────────────────
  var DRAFT_SECTIONS = [
    { key: 'symptom', label: '불량현상' },
    { key: 'cause', label: '발생원인' },
    { key: 'action', label: '개선대책' },
    { key: 'prevention', label: '재발방지대책' }
  ];
  function line(label, v) { return v || v === 0 ? '- ' + label + ': ' + v + '\n' : ''; }
  function buildPrompt(input, similar) {
    var p = '';
    p += '너는 제조업 품질 담당자를 돕는 품질 개선대책서 작성 도우미야.\n';
    p += '아래 「새 불량」 정보와 「과거 유사 불량 이력」을 참고해서 품질 개선대책서 초안을 써줘.\n\n';
    p += '지켜 줄 것\n';
    p += '1. 새 불량 정보와 과거 이력에 있는 사실만 근거로 써줘. 확인되지 않은 수치·원인은 만들지 말고 「확인 필요」라고 적어줘.\n';
    p += '2. 과거 이력의 원인·대책을 참고했다면 어느 관리번호(또는 발생일·품번)를 참고했는지 괄호로 밝혀줘.\n';
    p += '3. 발생원인은 추정이면 「추정」이라고 표시하고, 확인해야 할 점검 항목을 함께 적어줘.\n';
    p += '4. 아래 답변 형식의 네 제목을 그대로 쓰고, 제목 밖에는 다른 말을 붙이지 말아줘.\n\n';
    p += '[새 불량]\n';
    p += line('발생일', input.date) + line('품번', input.part_no) + line('품명', input.part_name) +
      line('불량유형', input.defect_type) + line('공정', input.process) + line('고객사', input.customer) +
      line('불량수량', input.qty) + line('현장 메모(불량현상·상황)', input.memo);
    p += '\n[과거 유사 불량 이력] (' + (similar.length ? similar.length + '건' : '없음') + ')\n';
    similar.forEach(function (r, i) {
      p += '\n(' + (i + 1) + ') ' + [r.mgmt_no ? '관리번호 ' + r.mgmt_no : '', r.date || '', r.part_no || '', r.part_name || ''].filter(Boolean).join(' / ') + '\n';
      p += line('불량유형', r.defect_type) + line('불량현상', r.symptom) + line('원인 분류', r.cause_cat) + line('발생원인', r.cause) +
        line('개선대책', r.action) + line('재발방지대책', r.prevention);
    });
    p += '\n[답변 형식]\n';
    DRAFT_SECTIONS.forEach(function (s) { p += '【' + s.label + '】\n(내용)\n'; });
    return p;
  }
  // 답변에서 【제목】 아래 내용을 뽑습니다. 제목은 「## 제목」「[제목]」「**제목**」「제목:」도 받아 줍니다.
  function parseDraft(answer) {
    var out = {}, found = 0;
    var lines = String(answer == null ? '' : answer).replace(/\r\n?/g, '\n').split('\n');
    var cur = null, buf = [];
    function flush() { if (cur) { out[cur] = buf.join('\n').trim(); } buf = []; }
    lines.forEach(function (ln) {
      var t = ln.trim().replace(/^#+\s*/, '').replace(/^\*\*(.+?)\*\*/, '$1');
      var hit = null, rest = '';
      DRAFT_SECTIONS.forEach(function (s) {
        if (hit) return;
        var m = t.match(new RegExp('^(?:【\\s*' + s.label + '\\s*】|\\[\\s*' + s.label + '\\s*\\]|' + s.label + '(?=\\s*[:：]|\\s*$))\\s*[:：]?\\s*(.*)$'));
        if (m) { hit = s.key; rest = m[1]; }
      });
      if (hit) { flush(); cur = hit; found++; if (rest) buf.push(rest); }
      else if (cur) buf.push(ln);
    });
    flush();
    DRAFT_SECTIONS.forEach(function (s) { if (out[s.key] === '(내용)') out[s.key] = ''; });
    return { fields: out, found: found };
  }

  // ── 내보내기 ─────────────────────────────────────────────────
  function stdHeader() { return STD_FIELDS.map(function (f) { return f.label; }); }
  function standardSheet(rows) {
    var aoa = [stdHeader()];
    rows.forEach(function (r) { aoa.push(STD_FIELDS.map(function (f) { var v = r[f.key]; return v == null ? '' : v; })); });
    return aoa;
  }
  function templateSheets() {
    var guide = [['품질불량 이력 — 표준 양식 작성 안내'], [''], ['항목', '필수', '적는 법']];
    var how = {
      mgmt_no: '사내 관리번호(사진·대책서와 잇는 키가 있으면 여기)', date: '2026-09-01 형식(엑셀 날짜도 됩니다)',
      part_no: '품번', part_name: '품명', defect_type: '불량유형(표기가 흔들려도 「표기 정리」에서 묶을 수 있습니다)',
      symptom: '불량현상 문장', cause_cat: '원인 분류 열이 따로 있으면 여기(없으면 비워 둡니다)', cause: '발생원인 문장',
      action: '개선대책', prevention: '재발방지대책', qty: '불량수량(숫자)', process: '발생 공정', customer: '고객사'
    };
    STD_FIELDS.forEach(function (f) { guide.push([f.label, f.required ? '필수' : '', how[f.key] || '']); });
    guide.push([''], ['한 행 = 불량 1건입니다. 열 이름은 실제 파일 확인 후 바뀔 수 있습니다(가정).']);
    return { '품질불량이력': [stdHeader()], '작성 안내': guide };
  }
  function monthlySheets(totals, report, dictRows) {
    var t = [['월', '건수', '불량수량']];
    totals.forEach(function (x) { t.push([x.month, x.count, x.qty]); });
    function top(title, list) {
      var a = [[title, '건수', '불량수량']];
      list.forEach(function (e) { a.push([e.key, e.count, e.qty]); });
      return a;
    }
    var sheets = { '월별 추이': t };
    if (report) {
      sheets[report.month + ' 유형별'] = top('불량유형', report.byType);
      sheets[report.month + ' 품번별'] = top('품번', report.byPart);
      sheets[report.month + ' 원인별'] = top('원인', report.byCause);
      sheets[report.month + ' 이력'] = standardSheet(report.rows);
    }
    return sheets;
  }
  function repeatsSheet(list) {
    var a = [['묶음', '첫 발생일', '마지막 발생일', '기간(일)', '건수', '불량수량', '관리번호']];
    list.forEach(function (e) { a.push([e.label, e.first, e.last, e.span, e.count, e.qty, e.rows.map(function (r) { return r.mgmt_no || r.date; }).join(', ')]); });
    return a;
  }
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function aoaToCsv(aoa) {
    return '﻿' + aoa.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }

  // ── 다음 단계 준비 ───────────────────────────────────────────
  // 2단계(실제 데이터 보정·문서 검색·사진)로 가려면 수강생에게 받아야 할 것들.
  // 화면 「다음 단계」의 체크 목록과 「보낼 요약 글」이 이 목록을 씁니다.
  var PLAN_QUESTIONS = [
    '이력 Excel 의 열 구성·시트 구성, 한 행이 불량 1건인지',
    '이력 건수와 기간(대략 몇 년치, 몇 건)',
    '개선대책서·재발방지대책 파일 형식(한글·Word·Excel·PDF)',
    '「품질 관련 Excel 관리자료」가 이력과 다른 파일이면 무엇을 관리하는지',
    '불량유형·원인 분류 체계(코드표가 있는지, 자유 기재인지)',
    '「반복·다발 불량」으로 보는 기준(기간·건수·같은 품번만인지)',
    '월간 보고서 KPI 항목과 계산식(불량률 분모 — 생산 수량 자료가 있는지)',
    '불량 사진과 이력을 잇는 키(관리번호 등)가 있는지, 사진 보관 위치',
    '품질 이력·대응자료를 외부 AI·클라우드에 올려도 되는지, 사내 허용 AI',
    '혼자 쓰는지, 품질팀이 함께 쓰는지'
  ];
  var NEXT_CHECKLIST = [
    { key: 'try_import', group: 'now', label: '실제 이력 Excel 을 「Excel·CSV 불러오기」로 열고 「열 맞추기」까지 해 보기' },
    { key: 'try_search', group: 'now', label: '「유사 불량」「반복·다발」「월간 현황」을 실제 이력으로 써 보기' },
    { key: 'note_misfit', group: 'now', label: '안 맞았던 점 적어 두기(못 읽은 날짜·수량, 없는 열, 엉뚱한 검색 결과 등)' },
    { key: 'answers', group: 'send', label: '기획서 10장 질문 10개에 답하기' },
    { key: 'excel', group: 'send', label: '가린 Excel 샘플 10~20행, 또는 열 이름 목록(아래 「요약 글 만들기」)' },
    { key: 'photos', group: 'send', label: '불량유형별로 나눈 불량 사진 — 유형마다 20장 이상(가능하면 50장), 정상품 사진도 함께' },
    { key: 'docs', group: 'send', label: '개선대책서·재발방지대책 3~5건과 사내 표준(검사기준서·작업표준서 등) 목록' }
  ];
  // 이력에서 「보낼 요약 글」을 만듭니다. 열 이름·건수·기간·불량유형 이름·검사 결과만 넣고,
  // 품번·품명·고객사·원인·대책 같은 값은 넣지 않습니다(공개 게시판에 올릴 수 있게).
  function readinessSummary(rows, opt) {
    opt = opt || {};
    var mapping = opt.mapping || {}, headers = opt.headers || [];
    var out = [];
    out.push('[다음 단계 준비 요약 — 품질불량 이력 분석 도구에서 만든 글]');
    out.push('※ 품번·품명·고객사·원인·대책 값은 넣지 않았습니다. 올리기 전에 한 번 읽어 보세요.');
    if (opt.sample) out.push('※ 지금 도구에 든 것은 예시 데이터입니다. 실제 이력을 불러온 뒤 다시 만들어 주세요.');
    out.push('');
    var dates = rows.map(function (r) { return r.date; }).filter(Boolean).sort();
    out.push('1. 이력 규모: ' + rows.length + '건' + (dates.length ? ', 기간 ' + dates[0] + ' ~ ' + dates[dates.length - 1] + ' (' + monthRange(monthOf(dates[0]), monthOf(dates[dates.length - 1])).length + '개월)' : ''));
    out.push('2. 내 파일의 열 이름: ' + (headers.length ? headers.join(', ') : '(아직 불러온 파일 없음)'));
    var linked = STD_FIELDS.filter(function (f) { return mapping[f.key]; });
    if (linked.length) out.push('   - 연결한 열: ' + linked.map(function (f) { return f.label + ' ← ' + mapping[f.key]; }).join(', '));
    var used = {};
    Object.keys(mapping).forEach(function (k) { used[mapping[k]] = true; });
    var extra = headers.filter(function (hd) { return !used[hd]; });
    if (extra.length) out.push('   - 연결하지 않은 열: ' + extra.join(', '));
    if (headers.length) {
      var missing = STD_FIELDS.filter(function (f) { return !mapping[f.key]; }).map(function (f) { return f.label; });
      out.push('   - 파일에 없던 표준 항목: ' + (missing.length ? missing.join(', ') : '없음'));
    }
    var types = groupCount(rows, 'defect_type');
    out.push('3. 불량유형 ' + types.filter(function (g) { return g.key !== '(비어 있음)'; }).length + '가지(건수 많은 순): ' +
      (types.length ? types.slice(0, 20).map(function (g) { return g.key + ' ' + g.count; }).join(', ') + (types.length > 20 ? ' 외 ' + (types.length - 20) + '가지' : '') : '(없음)'));
    var s = issueSummary(validateRows(rows));
    out.push('4. 도구 검사 결과: 오류 ' + s.error + '건 · 확인 ' + s.warn + '건');
    out.push('5. 써 보니 안 맞았던 점: (적어 주세요)');
    out.push('6. 기획서 10장 질문 답:');
    PLAN_QUESTIONS.forEach(function (q, i) { out.push('   ' + (i + 1) + ') ' + q + ' → '); });
    out.push('7. 불량 사진: 유형별 장수 (예: 스크래치 30장, 찍힘 25장, 정상 40장) → ');
    out.push('8. 보낼 수 있는 문서: 대책서 몇 건·형식, 사내 표준 이름 → ');
    return out.join('\n');
  }

  var api = {
    STD_FIELDS: STD_FIELDS, FIELD: FIELD, DICT_FIELDS: DICT_FIELDS, GROUP_BY: GROUP_BY, DEFAULT_RULE: DEFAULT_RULE,
    DEFAULT_SEARCH: DEFAULT_SEARCH, DRAFT_SECTIONS: DRAFT_SECTIONS,
    emptyDb: emptyDb, toDateStr: toDateStr, parseDate: parseDate, parseNum: parseNum, monthOf: monthOf, dayNum: dayNum,
    normalizeRow: normalizeRow, squash: squash, matchField: matchField, detectHeaderRow: detectHeaderRow, headersOf: headersOf,
    autoMap: autoMap, applyMapping: applyMapping, validateRows: validateRows, issueSummary: issueSummary,
    canon: canon, canonRow: canonRow, autoCanon: autoCanon, canonRows: canonRows, distinctValues: distinctValues,
    filterRows: filterRows, causeKey: causeKey, valuesOf: valuesOf, groupCount: groupCount,
    tokenize: tokenize, searchSimilar: searchSimilar, detectRepeats: detectRepeats,
    monthRange: monthRange, monthlyTotals: monthlyTotals, monthReport: monthReport, prevMonth: prevMonth,
    buildPrompt: buildPrompt, parseDraft: parseDraft,
    stdHeader: stdHeader, standardSheet: standardSheet, templateSheets: templateSheets, monthlySheets: monthlySheets,
    repeatsSheet: repeatsSheet, aoaToCsv: aoaToCsv,
    PLAN_QUESTIONS: PLAN_QUESTIONS, NEXT_CHECKLIST: NEXT_CHECKLIST, readinessSummary: readinessSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCLogic = api;
})(typeof window !== 'undefined' ? window : this);
