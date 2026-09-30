// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
let seq = 0;
function row(o) { return Object.assign(L.normalizeRow({}), { id: 'r' + (++seq) }, o); }

console.log('값 읽기');
test('날짜 여러 표기', () => {
  assert.equal(L.parseDate('2026.9.1'), '2026-09-01');
  assert.equal(L.parseDate('2026년 9월 1일'), '2026-09-01');
  assert.equal(L.parseDate('20260901'), '2026-09-01');
  assert.equal(L.parseDate(46266), '2026-09-01'); // 엑셀 일련번호
  assert.equal(L.parseDate('2026-02-30'), null);
});
test('수량: 쉼표·단위 떼기, 못 읽으면 null', () => {
  assert.equal(L.parseNum('1,200'), 1200);
  assert.equal(L.parseNum('12 EA'), 12);
  assert.equal(L.parseNum('5개'), 5);
  assert.equal(L.parseNum('많음'), null);
});
test('못 읽은 값은 _raw 에 남고 검사에서 오류', () => {
  const r = Object.assign(L.normalizeRow({ date: '어제', qty: '많음', part_no: 'A', defect_type: '찍힘' }), { id: 'x' });
  assert.deepEqual(r._unreadable, ['date', 'qty']);
  const iss = L.validateRows([r]);
  assert.deepEqual(iss.map(i => i.field + ':' + i.level), ['date:error', 'qty:error']);
});

console.log('열 맞추기');
test('다른 열 이름을 표준 항목으로 추천', () => {
  const m = L.autoMap(['NO', '발생 일자', 'P/N', '부품명', '불량 구분', '불량내용', '원인', '조치내용', '수량', '라인', '비고']);
  assert.deepEqual(m, { mgmt_no: 'NO', date: '발생 일자', part_no: 'P/N', part_name: '부품명', defect_type: '불량 구분', cause: '원인', action: '조치내용', qty: '수량', process: '라인' });
});
test('저장한 연결이 자동 추천보다 먼저', () => {
  const m = L.autoMap(['일자', '작성일'], { date: '작성일' });
  assert.equal(m.date, '작성일');
});
test('머리행 찾기(위에 제목 줄이 있어도)', () => {
  const aoa = [['품질불량 관리대장'], [], ['관리번호', '발생일', '품번', '불량유형'], ['Q1', '2026-09-01', 'A', '찍힘']];
  assert.equal(L.detectHeaderRow(aoa), 2);
  const res = L.applyMapping(aoa, { headerRow: 2, mapping: L.autoMap(L.headersOf(aoa, 2)), fileName: 'f.xlsx' });
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].part_no, 'A');
  assert.equal(res.rows[0].date, '2026-09-01');
});

console.log('표기 묶음');
test('띄어쓰기·대소문자만 다른 표기는 한 줄로 묶임', () => {
  const rows = [row({ defect_type: '치수 불량' }), row({ defect_type: '치수불량' }), row({ defect_type: '치수불량' }), row({ defect_type: 'Burr' }), row({ defect_type: 'burr' })];
  const d = L.distinctValues(rows, 'defect_type', {});
  assert.equal(d.length, 2);
  assert.equal(d[0].canonical, '치수불량'); // 많이 쓴 표기가 대표
  assert.equal(d[0].count, 3);
  assert.deepEqual(d[1].spellings.sort(), ['Burr', 'burr']);
});
test('사전으로 다른 낱말을 대표 이름으로 바꿈(원래 행은 그대로)', () => {
  const dict = { defect_type: { [L.squash('스크레치')]: '스크래치' }, cause: {}, cause_cat: {} };
  const r = row({ defect_type: '스크레치 ' });
  assert.equal(L.canonRow(dict, r).defect_type, '스크래치');
  assert.equal(r.defect_type, '스크레치 ');
  assert.equal(L.canon(dict, 'defect_type', '찍힘'), '찍힘');
});

test('사전에 없으면 띄어쓰기만 다른 표기를 가장 많이 쓴 표기로 자동 통일', () => {
  const rows = [row({ defect_type: '치수 불량' }), row({ defect_type: '치수불량' }), row({ defect_type: '치수불량' })];
  assert.deepEqual(L.canonRows({}, rows).map(r => r.defect_type), ['치수불량', '치수불량', '치수불량']);
  const dict = { defect_type: { '치수불량': '치수 불량' } };
  assert.deepEqual(L.canonRows(dict, rows).map(r => r.defect_type), ['치수 불량', '치수 불량', '치수 불량']);
});

console.log('거르기·집계');
const base = [
  row({ date: '2026-08-01', part_no: 'A', defect_type: '찍힘', cause_cat: '작업자', qty: 3, process: '프레스' }),
  row({ date: '2026-08-15', part_no: 'A', defect_type: '찍힘', cause: '금형 마모', qty: 2, process: '프레스' }),
  row({ date: '2026-09-02', part_no: 'B', defect_type: '치수불량', cause_cat: '설비', qty: 10, process: '가공' }),
  row({ date: '2026-09-20', part_no: 'A', defect_type: '치수불량', cause_cat: '설비', qty: null, process: '가공' })
];
test('기간·품번·원인 거르기', () => {
  assert.equal(L.filterRows(base, { from: '2026-08-10', to: '2026-09-10' }).length, 2);
  assert.equal(L.filterRows(base, { part_no: 'A' }).length, 3);
  assert.equal(L.filterRows(base, { cause: '설비' }).length, 2);
  assert.equal(L.filterRows(base, { cause: '금형 마모' }).length, 1); // 원인 분류가 없으면 발생원인 문장이 축
  assert.equal(L.filterRows(base, { keyword: '마모' }).length, 1);
});
test('축별 건수·수량(수량 빈 칸은 0 으로)', () => {
  assert.deepEqual(L.groupCount(base, 'part_no'), [{ key: 'A', count: 3, qty: 5 }, { key: 'B', count: 1, qty: 10 }]);
  assert.deepEqual(L.groupCount(base, 'defect_type'), [{ key: '치수불량', count: 2, qty: 10 }, { key: '찍힘', count: 2, qty: 5 }]);
});

console.log('유사 불량 검색');
test('조사를 떼고 낱말로 자름', () => {
  assert.deepEqual(L.tokenize('도장면에 기포가 발생함, 2개'), ['도장면', '기포', '발생', '2개']);
});
test('겹친 낱말 + 같은 품번·유형 가산점 순으로 정렬', () => {
  const rows = [
    row({ date: '2026-07-01', part_no: 'P1', defect_type: '도장불량', symptom: '도장면 기포 발생' }),
    row({ date: '2026-07-02', part_no: 'P2', defect_type: '도장불량', symptom: '도장면 흐름' }),
    row({ date: '2026-07-03', part_no: 'P9', defect_type: '찍힘', symptom: '모서리 찍힘' })
  ];
  const res = L.searchSimilar(rows, { text: '도장면에 기포가 생김', part_no: 'P1', defect_type: '' });
  // P1: 도장면·기포 2 + 같은 품번 2 = 4 / P2: 도장면 1 / P9: 0 → 제외
  assert.deepEqual(res.map(r => [r.row.part_no, r.score]), [['P1', 4], ['P2', 1]]);
  assert.deepEqual(res[0].matched, ['도장면', '기포']);
});
test('가산점은 설정값을 따름', () => {
  const rows = [row({ part_no: 'P1', defect_type: '찍힘', symptom: '' })];
  const res = L.searchSimilar(rows, { text: '', part_no: 'p1', defect_type: '찍힘' }, { partBonus: 5, typeBonus: 1 });
  assert.equal(res[0].score, 6);
});

console.log('반복·다발 탐지');
const rep = [
  row({ date: '2026-09-01', part_no: 'A', defect_type: '찍힘', qty: 1 }),
  row({ date: '2026-09-03', part_no: 'A', defect_type: '찍힘', qty: 1 }),
  row({ date: '2026-09-10', part_no: 'A', defect_type: '찍힘', qty: 2 }),
  row({ date: '2026-09-11', part_no: 'A', defect_type: '찍힘', qty: 2 }),
  row({ date: '2026-09-12', part_no: 'A', defect_type: '찍힘', qty: 2 }),
  row({ date: '2026-09-11', part_no: 'B', defect_type: '찍힘', qty: 5 })
];
test('7일 안 3건: 9/10~9/12 한 구간만', () => {
  const r = L.detectRepeats(rep, { groupBy: 'part_defect', days: 7, min: 3 });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].label, r[0].first, r[0].last, r[0].count, r[0].qty, r[0].span], ['A · 찍힘', '2026-09-10', '2026-09-12', 3, 6, 3]);
});
test('10일 안 3건: 다섯 건이 한 구간으로 이어짐', () => {
  const r = L.detectRepeats(rep, { groupBy: 'part_defect', days: 10, min: 3 });
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].first, r[0].last, r[0].count], ['2026-09-01', '2026-09-12', 5]);
});
test('경계: 9/1~9/10 은 10일 창(차이 9일)에 들지만 9일 창에는 안 듦', () => {
  const three = rep.slice(0, 3);
  assert.equal(L.detectRepeats(three, { groupBy: 'part_defect', days: 10, min: 3 }).length, 1);
  assert.equal(L.detectRepeats(three, { groupBy: 'part_defect', days: 9, min: 3 }).length, 0);
});
test('묶음 기준 「같은 불량유형」이면 품번 B 도 함께 셈', () => {
  const r = L.detectRepeats(rep, { groupBy: 'defect', days: 3, min: 4 });
  // 9/10·9/11(A)·9/11(B)·9/12 = 3일 안 4건
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].label, r[0].count, r[0].qty], ['찍힘', 4, 11]);
});
test('품번이 빈 행은 품번 묶음에서 빠짐', () => {
  const r = L.detectRepeats([row({ date: '2026-09-01', part_no: '', defect_type: '찍힘' }), row({ date: '2026-09-01', part_no: '', defect_type: '찍힘' })], { groupBy: 'part_defect', days: 1, min: 2 });
  assert.equal(r.length, 0);
});
test('잘못된 기준값은 오류', () => {
  assert.throws(() => L.detectRepeats(rep, { days: -1, min: 3 }));
  assert.throws(() => L.detectRepeats(rep, { days: 7, min: 1 }));
});

console.log('월간 현황');
test('월별 합계는 빈 달을 0 으로 채움', () => {
  const t = L.monthlyTotals(base.concat([row({ date: '2026-11-05', qty: 1 })]));
  assert.deepEqual(t, [
    { month: '2026-08', count: 2, qty: 5 }, { month: '2026-09', count: 2, qty: 10 },
    { month: '2026-10', count: 0, qty: 0 }, { month: '2026-11', count: 1, qty: 1 }]);
});
test('한 달 보고: 건수·수량·유형별 상위', () => {
  const m = L.monthReport(base, '2026-09');
  assert.equal(m.count, 2);
  assert.equal(m.qty, 10);
  assert.deepEqual(m.byType, [{ key: '치수불량', count: 2, qty: 10 }]);
  assert.deepEqual(m.byCause, [{ key: '설비', count: 2, qty: 10 }]);
});
test('해 넘김 달 계산', () => {
  assert.deepEqual(L.monthRange('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(L.prevMonth('2026-01'), '2025-12');
});

console.log('대책서 초안 프롬프트');
test('프롬프트에 새 불량·과거 이력·답변 형식이 들어감', () => {
  const p = L.buildPrompt({ date: '2026-09-28', part_no: 'A', memo: '모서리 찍힘' }, [base[1]]);
  assert.ok(p.includes('- 품번: A'));
  assert.ok(p.includes('[과거 유사 불량 이력] (1건)'));
  assert.ok(p.includes('- 발생원인: 금형 마모'));
  ['【불량현상】', '【발생원인】', '【개선대책】', '【재발방지대책】'].forEach(s => assert.ok(p.includes(s), s));
  assert.ok(!p.includes('- 품명:')); // 빈 항목은 줄을 넣지 않음
});
test('붙여넣은 답변을 네 칸으로 나눔(여러 제목 표기 허용)', () => {
  const ans = '초안입니다.\n【불량현상】\n모서리 찍힘 2개\n\n## 발생원인\n금형 마모(추정)\n**개선대책**: 금형 연마\n[재발방지대책]\n- 점검 주기 단축\n- 확인 필요';
  const r = L.parseDraft(ans);
  assert.equal(r.found, 4);
  assert.deepEqual(r.fields, { symptom: '모서리 찍힘 2개', cause: '금형 마모(추정)', action: '금형 연마', prevention: '- 점검 주기 단축\n- 확인 필요' });
});
test('형식이 없는 답변은 found 0', () => {
  assert.equal(L.parseDraft('그냥 문장').found, 0);
});

console.log('예시 데이터');
test('예시 데이터에 반복 불량과 표기 흔들림이 들어 있음', () => {
  const rows = Sample.build().map((r, i) => Object.assign({ id: 's' + i }, r));
  assert.ok(rows.length >= 40);
  assert.equal(L.validateRows(rows).filter(i => i.level === 'error').length, 0);
  const d = L.distinctValues(rows, 'defect_type', {});
  assert.ok(d.some(e => e.spellings.length >= 2), '띄어쓰기만 다른 표기');
  const rep = L.detectRepeats(rows, L.DEFAULT_RULE);
  assert.ok(rep.length >= 1, '기본 규칙으로 반복 불량이 잡혀야 함');
  // 사전을 적용하면 철자가 다른 원인 분류도 하나로 묶임
  const dict = L.emptyDb().dict;
  Object.assign(dict.cause_cat, Sample.dictHint);
  const causes = L.valuesOf(L.canonRows(dict, rows), 'cause_cat');
  assert.ok(!causes.includes('작업 자') && !causes.includes('작업자 실수'));
});

console.log('다음 단계 요약 글');
test('요약 글: 열 이름·건수·기간·유형은 넣고, 품번·고객사·원인·대책 값은 넣지 않음', () => {
  const rows = [
    row({ date: '2026-01-05', part_no: 'PN-SECRET-1', customer: '비밀고객사', defect_type: '스크래치', cause: '금형마모원인문장', action: '대책문장비공개', qty: 3 }),
    row({ date: '2026-03-20', part_no: 'PN-SECRET-2', customer: '비밀고객사', defect_type: '스크래치', cause: '금형마모원인문장', action: '대책문장비공개' }),
    row({ date: '2026-02-11', part_no: 'PN-SECRET-1', defect_type: '찍힘' })
  ];
  const txt = L.readinessSummary(rows, { mapping: { date: '일자', part_no: 'P/N', defect_type: '불량 구분' }, headers: ['일자', 'P/N', '불량 구분', '비고'] });
  assert.match(txt, /3건, 기간 2026-01-05 ~ 2026-03-20 \(75일, 약 2개월\)/);
  assert.match(txt, /열 이름: 일자, P\/N, 불량 구분, 비고/);
  assert.match(txt, /발생일 ← 일자/);
  assert.match(txt, /연결하지 않은 열: 비고/);
  assert.match(txt, /파일에 없던 표준 항목: 관리번호, 품명/);
  assert.match(txt, /불량유형 2가지\(건수 많은 순\): 스크래치 2, 찍힘 1/);
  for (const secret of ['PN-SECRET', '비밀고객사', '금형마모원인문장', '대책문장비공개']) assert.ok(!txt.includes(secret), secret + ' 가 새어 나감');
  assert.equal((txt.match(/^   \d+\) /gm) || []).length, L.PLAN_QUESTIONS.length);
  assert.equal(L.PLAN_QUESTIONS.length, 10);
});
test('요약 글: 빈 이력·예시 데이터 표시', () => {
  const t0 = L.readinessSummary([], {});
  assert.match(t0, /이력 규모: 0건\n/);
  assert.match(t0, /아직 불러온 파일 없음/);
  assert.ok(!/파일에 없던 표준 항목/.test(t0));
  assert.match(L.readinessSummary([], { sample: true }), /예시 데이터입니다/);
});
test('다음 단계 체크 목록: 키 중복 없음, 두 묶음', () => {
  const keys = L.NEXT_CHECKLIST.map(c => c.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual([...new Set(L.NEXT_CHECKLIST.map(c => c.group))], ['now', 'send']);
});

console.log('2026-09-30 실제 이력 반영');
// 수강생 요약 글의 불량유형 19가지(값이 아닌 유형 이름만, 셀 안 줄바꿈 그대로). 품번·날짜는 지어낸 값.
const REAL_TYPES = [
  ['터미널 밀림', 3], ['단자밀림', 2], ['RING 단자 이종', 1], ['케이블 그룹 내 불량 규격(PB+) 2개 묶음 조립', 1], ['터미널 미삽입', 1],
  ['LIGHT SW 단자 밀림', 1], ['MPT 단자 밀림', 1], ['OPT POWER\n연결 누락', 1], ['단자 미삽입\n(조립불량', 1], ['단자 밀림(미삽입)', 1],
  ['단자 벌어짐\n접촉불량', 1], ['단자 이종\n조립불가', 1], ['라벨 이종', 1], ['마스트작동불능 / \n단자 밀림', 1], ['부품누락(클립)', 1],
  ['시동불능 / 단자밀림', 1], ['피복 탈피 불량으로 심선 가닥수가 적어 인장력이 안나옴', 1], ['하우징 파손\n(CAN PORT)', 1], ['회로오배', 1]
];
function realRows() {
  const out = []; let d = 9;
  REAL_TYPES.forEach(([t, n], i) => { for (let k = 0; k < n; k++) { d += 4; const dt = new Date(Date.UTC(2026, 5, d)); out.push(row({ date: dt.toISOString().slice(0, 10), part_no: 'P' + (i % 7), defect_type: t, qty: 1 })); } });
  return out;
}
test('실제 이력 모양: 22건, 표기 19가지', () => {
  const rs = realRows();
  assert.equal(rs.length, 22);
  assert.equal(L.distinctValues(rs, 'defect_type').length, 19);
});
test('핵심 표기: 괄호·앞 영문 부위·터미널=단자·「/」 앞 증상', () => {
  assert.equal(L.coreOf('단자 밀림(미삽입)').text, '단자 밀림');
  assert.equal(L.coreOf('단자 미삽입\n(조립불량').text, '단자 미삽입');       // 닫는 괄호 없음
  assert.equal(L.coreOf('하우징 파손\n(CAN PORT)').text, '하우징 파손');
  assert.equal(L.coreOf('LIGHT SW 단자 밀림').text, '단자 밀림');
  assert.equal(L.coreOf('OPT POWER\n연결 누락').text, '연결 누락');
  assert.equal(L.coreOf('터미널 밀림').text, '단자 밀림');
  const slash = L.coreOf('시동불능 / 단자밀림');
  assert.equal(slash.text, '단자밀림');
  assert.equal(slash.sure, false);                                            // 「/」 규칙은 확신 낮음
  assert.equal(L.coreOf('회로오배').steps.length, 0);
});
test('묶기 제안: 단자 밀림 묶음(확신 7표기 + 확인 2표기), 단자 미삽입 묶음', () => {
  const sg = L.suggestGroups(realRows(), 'defect_type', L.emptyDb().dict);
  const push = sg.groups.find(g => g.name === '단자 밀림');
  assert.ok(push, '단자 밀림 묶음이 없음');
  const sure = push.members.filter(m => m.sure).map(m => m.spelling).sort();
  assert.deepEqual(sure, ['LIGHT SW 단자 밀림', 'MPT 단자 밀림', '단자 밀림(미삽입)', '단자밀림', '터미널 밀림'].sort());
  assert.deepEqual(push.members.filter(m => !m.sure).map(m => m.spelling).sort(), ['마스트작동불능 / \n단자 밀림', '시동불능 / 단자밀림'].sort());
  const ins = sg.groups.find(g => g.name === '단자 미삽입');
  assert.deepEqual(ins.members.map(m => m.spelling).sort(), ['단자 미삽입\n(조립불량', '터미널 미삽입'].sort());
  // 한 표기뿐인 것(회로오배 등)은 제안하지 않음
  assert.equal(sg.groups.length, 2);
});
test('합치기 제안: 미삽입≈밀림(확인), 「단자 이종 조립불가」→「단자 이종」, 라벨 이종은 안 붙음', () => {
  const sg = L.suggestGroups(realRows(), 'defect_type', L.emptyDb().dict);
  const near = sg.merges.find(m => m.intoName === '단자 밀림');
  assert.ok(near && near.fromNames.includes('단자 미삽입') && /미삽입 ≈ 밀림/.test(near.reason));
  const kind = sg.merges.find(m => m.intoName === '단자 이종');
  assert.ok(kind && kind.fromNames[0] === '단자 이종 조립불가');
  assert.ok(!sg.merges.some(m => m.names.includes('라벨 이종')));
});
test('확인한 묶음을 사전에 넣으면 집계·반복 탐지가 묶인 유형으로 셈', () => {
  const rs = realRows();
  const dict = L.emptyDb().dict;
  const before = L.groupCount(L.canonRows(dict, rs), 'defect_type');
  assert.deepEqual([before[0].key, before[0].count], ['터미널 밀림', 3]);
  const g = L.suggestGroups(rs, 'defect_type', dict).groups.find(x => x.name === '단자 밀림');
  assert.equal(L.applyGroup(dict, 'defect_type', g.name, g.members.filter(m => m.sure).map(m => m.key)), 5);
  const after = L.groupCount(L.canonRows(dict, rs), 'defect_type');
  assert.deepEqual([after[0].key, after[0].count], ['단자 밀림', 8]);
  const rp = L.detectRepeats(L.canonRows(dict, rs), { groupBy: 'defect', days: 0, min: 2 });
  assert.equal(rp.find(e => e.label === '단자 밀림').count, 8);
  // 이미 묶은 제안은 done
  assert.equal(L.suggestGroups(rs, 'defect_type', dict).groups.find(x => x.name === '단자 밀림').done, false); // 확인 2표기는 아직
  L.applyGroup(dict, 'defect_type', '단자 밀림', g.members.map(m => m.key));
  assert.equal(L.suggestGroups(rs, 'defect_type', dict).groups.find(x => x.name === '단자 밀림').done, true);
  L.removeGroup(dict, 'defect_type', g.members.map(m => m.key));
  assert.equal(Object.keys(dict.defect_type).length, 0);
  assert.throws(() => L.applyGroup(dict, 'defect_type', ' ', ['a']));
});
test('반복 기준(확정): 같은 품번 또는 같은 유형, 기간 제한 없이 2건 이상', () => {
  assert.deepEqual(L.DEFAULT_RULE, { groupBy: 'part_or_defect', days: 0, min: 2 });
  const rs = [
    row({ date: '2026-06-10', part_no: 'P1', defect_type: '단자 밀림' }),
    row({ date: '2026-09-10', part_no: 'P1', defect_type: '라벨 이종' }),   // 같은 품번, 3개월 간격
    row({ date: '2026-07-01', part_no: 'P2', defect_type: '단자 밀림' }),   // 같은 유형, 다른 품번
    row({ date: '2026-07-02', part_no: 'P3', defect_type: '회로오배' })
  ];
  const r = L.detectRepeats(rs);
  assert.deepEqual(r.map(e => e.label).sort(), ['불량유형: 단자 밀림', '품번: P1']);
  assert.equal(r.find(e => e.basis === '품번').span, 93);
  // 기간을 30일로 좁히면 품번 P1(93일 간격)은 빠짐
  assert.deepEqual(L.detectRepeats(rs, { groupBy: 'part_or_defect', days: 30, min: 2 }).map(e => e.label), ['불량유형: 단자 밀림']);
});
test('저장된 옛 시작값(30일 3건)만 확정 기준으로 바뀌고, 사용자가 바꾼 값은 그대로', () => {
  assert.deepEqual(L.migrateRule({ groupBy: 'part_defect', days: 30, min: 3 }), L.DEFAULT_RULE);
  assert.deepEqual(L.migrateRule({ groupBy: 'part', days: 60, min: 2 }), { groupBy: 'part', days: 60, min: 2 });
  assert.deepEqual(L.migrateRule(null), L.DEFAULT_RULE);
  assert.equal(L.migrateRule({ groupBy: '없는기준', days: 5, min: 2 }).groupBy, 'part_or_defect');
});
const REAL_HEADERS = ['하자NO.', '발생일', '고객', '품번', '품명', '공정', '불량내용', '수량', '현상 조치&조치 사항', '원인분류', '발생원인', '대책수립 진행결과', '완료여부', '비고'];
test('저장된 양식: 실제 열 이름을 그대로 연결(완료여부 → 진행상태)', () => {
  const p = L.pickPreset(REAL_HEADERS);
  assert.ok(p && p.id === 'quality_2026_09_30');
  const m = L.autoMap(REAL_HEADERS);
  assert.deepEqual(m, { mgmt_no: '하자NO.', date: '발생일', part_no: '품번', part_name: '품명', defect_type: '불량내용', symptom: '현상 조치&조치 사항',
    cause_cat: '원인분류', cause: '발생원인', action: '대책수립 진행결과', status: '완료여부', qty: '수량', process: '공정', customer: '고객' });
  // 띄어쓰기·마침표가 달라도(「하자 NO」) 같은 열
  assert.equal(L.autoMap(REAL_HEADERS.map(h => h === '하자NO.' ? '하자 NO' : h)).mgmt_no, '하자 NO');
  assert.equal(L.pickPreset(['일자', 'P/N', '불량 구분']), null);
});
test('이전 판 연결 고치기: 재발방지대책 ← 완료여부 를 진행상태로, 저장된 상태 값도 옮김', () => {
  const f = L.fixMapping({ date: '발생일', prevention: '완료여부' });
  assert.equal(f.moved, true);
  assert.deepEqual(f.mapping, { date: '발생일', status: '완료여부' });
  assert.equal(L.fixMapping({ prevention: '재발방지대책' }).moved, false);
  const rs = [row({ prevention: '완료' }), row({ prevention: '진행중' }), row({ prevention: '작업표준서 개정, 교육 실시' })];
  assert.equal(L.moveStatusValues(rs), 2);
  assert.deepEqual(rs.map(r => [r.status, r.prevention]), [['완료', ''], ['진행중', ''], ['', '작업표준서 개정, 교육 실시']]);
  // 저장된 연결이 옛 방식이어도 autoMap 결과는 진행상태
  assert.equal(L.autoMap(REAL_HEADERS, { prevention: '완료여부' }).status, '완료여부');
});
test('유사 검색: 「터미널 밀림」으로 찾아도 「단자 밀림」 이력이 걸림', () => {
  const rs = [row({ defect_type: '단자 밀림', symptom: '커넥터 단자 밀림' }), row({ defect_type: '라벨 이종' })];
  const res = L.searchSimilar(rs, { text: '터미널 밀림' });
  assert.equal(res.length, 1);
  assert.deepEqual(res[0].matched, ['단자', '밀림']);
});
test('두 번째 자료(공정불량 이력 LIST): 자료 구분 거르기·파일 이름 짐작', () => {
  assert.equal(L.guessSource('공정불량 이력 LIST_2026.xlsx'), '공정불량 이력 LIST');
  assert.equal(L.guessSource('품질불량이력.xlsx'), '품질불량 이력');
  const rs = [row({ date: '2026-09-01' }), row({ date: '2026-09-02', source: '공정불량 이력 LIST' })];
  assert.equal(L.filterRows(rs, { source: '품질불량 이력' }).length, 1);   // 빈 값은 품질불량 이력
  assert.equal(L.filterRows(rs, { source: '공정불량 이력 LIST' }).length, 1);
  assert.match(L.readinessSummary(rs, {}), /자료별: 공정불량 이력 LIST 1건, 품질불량 이력 1건/);
});
test('요약 글: 열 이름을 기억 못 했으면 그렇게 적고, 유형 이름의 줄바꿈은 한 칸으로', () => {
  const t = L.readinessSummary([row({ date: '2026-06-09', defect_type: 'OPT POWER\n연결 누락' }), row({ date: '2026-09-17' })], { mapping: { date: '발생일' } });
  assert.match(t, /기억하지 못했습니다/);
  assert.match(t, /OPT POWER 연결 누락 1/);
  assert.match(t, /\(101일, 약 3개월\)/);
});

console.log('사진 (2026-09-30)');
test('사진 크기: 긴 변을 1280 으로 줄이고 작은 사진은 키우지 않음', () => {
  assert.deepEqual(L.fitSize(4032, 3024, 1280), { w: 1280, h: 960 });
  assert.deepEqual(L.fitSize(3024, 4032, 1280), { w: 960, h: 1280 });   // 세로 사진
  assert.deepEqual(L.fitSize(800, 600, 1280), { w: 800, h: 600 });
  assert.deepEqual(L.fitSize(4000, 10, 240), { w: 240, h: 1 });          // 0px 이 되지 않음
});
test('정리: 이력에서 가리키지 않는 사진만 지울 대상(저장 전 사진은 남김)', () => {
  const rs = [row({ photos: [{ id: 'a' }, { id: 'b' }] }), row({})];
  assert.deepEqual(L.allPhotoIds(rs), ['a', 'b']);
  assert.deepEqual(L.orphanPhotoIds(rs, ['a', 'b', 'c', 'd'], ['d']), ['c']);
  assert.equal(L.photoCount(rs[1]), 0);
});
test('내보내기 사진 이름: 관리번호_순번, 관리번호 없으면 발생일_품번, 겹치면 -2', () => {
  const rs = [
    row({ mgmt_no: 'Q-1', photos: [{ id: 'a' }, { id: 'b' }] }),
    row({ mgmt_no: 'Q-1', photos: [{ id: 'c' }] }),
    row({ date: '2026-09-01', part_no: 'P/100', photos: [{ id: 'd' }] })
  ];
  const n = L.photoFileNames(rs);
  assert.equal(n.a, 'Q-1_1.jpg'); assert.equal(n.b, 'Q-1_2.jpg');
  assert.equal(n.c, 'Q-1_1-2.jpg');                 // 같은 관리번호의 다른 건
  assert.equal(n.d, '2026-09-01_P-100_1.jpg');      // 파일 이름에 못 쓰는 / 는 -
});
test('Excel: 이력 표 끝에 사진 수·사진 파일, 사진 목록 시트는 사진마다 한 줄', () => {
  const rs = [row({ mgmt_no: 'Q-7', date: '2026-09-02', photos: [{ id: 'a', name: 'IMG_1.jpg', w: 1280, h: 960, bytes: 204800, memo: '찍힘 부위' }, { id: 'b' }] }), row({ mgmt_no: 'Q-8' })];
  const t = L.standardSheetWithPhotos(rs);
  assert.deepEqual(t[0].slice(-2), ['사진 수', '사진 파일']);
  assert.deepEqual(t[1].slice(-2), [2, 'Q-7_1.jpg, Q-7_2.jpg']);
  assert.deepEqual(t[2].slice(-2), [0, '']);
  assert.equal(t[0].length, L.STD_FIELDS.length + 2);
  const pl = L.photoListSheet(rs);
  assert.equal(pl.length, 3);
  assert.deepEqual(pl[1].slice(0, 8), ['Q-7', '2026-09-02', '', '', 1, 'Q-7_1.jpg', 'IMG_1.jpg', '찍힘 부위']);
  assert.equal(pl[1][10], 200);   // KB
  assert.equal(L.matchField('사진 수'), null);   // 내보낸 파일을 다시 불러와도 표준 항목에 섞이지 않음
});
test('ZIP: 한글 파일 이름·CRC 가 맞고 풀 수 있는 구조', () => {
  assert.equal(L.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);   // CRC-32 표준 검사값
  const a = new TextEncoder().encode('hello'), b = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
  const z = L.makeZip([{ name: '품질불량이력.xlsx', data: a }, { name: '사진/Q-1_1.jpg', data: b }], new Date(2026, 8, 30, 10, 0, 0));
  const v = new DataView(z.buffer);
  assert.equal(v.getUint32(0, true), 0x04034b50);
  assert.equal(v.getUint16(6, true) & 0x0800, 0x0800);           // UTF-8 이름 표시
  const eocd = z.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50);
  assert.equal(v.getUint16(eocd + 10, true), 2);                 // 파일 2개
  const cd = v.getUint32(eocd + 16, true);
  assert.equal(v.getUint32(cd, true), 0x02014b50);
  const nlen = v.getUint16(cd + 28, true);
  assert.equal(new TextDecoder().decode(z.slice(cd + 46, cd + 46 + nlen)), '품질불량이력.xlsx');
  assert.equal(v.getUint32(cd + 16, true), L.crc32(a));
  // 실제 unzip 으로도 확인(있을 때만)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qczip-'));
  try {
    fs.writeFileSync(path.join(dir, 't.zip'), z);
    let out = null;
    try { out = execFileSync('unzip', ['-t', path.join(dir, 't.zip')], { encoding: 'utf8' }); } catch (e) { if (e.code !== 'ENOENT') throw new Error('unzip -t 실패: ' + (e.stdout || e.message)); }
    if (out != null) assert.match(out, /No errors detected/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('백업: 되살리면 이력·사진이 그대로, 본체 없는 사진은 목록에서 빼고 알림', () => {
  const db = L.emptyDb();
  db.rows = [row({ id: 'r1', mgmt_no: 'Q-1', photos: [{ id: 'p1', name: 'a.jpg' }, { id: 'p2' }] }), row({ id: 'r2', photos: [{ id: 'p3' }] })];
  const photos = [{ id: 'p1', rowId: 'r1', data: 'AAEC', thumb: 'AA==' }, { id: 'p3', rowId: 'r2', data: '/9j/' }, { id: 'p9', data: 'AA==' }];
  const text = JSON.stringify(L.buildBackup(db, photos, new Date('2026-09-30T00:00:00Z')));
  const bk = L.parseBackup(text);
  assert.equal(bk.error, undefined);
  assert.equal(bk.exportedAt, '2026-09-30T00:00:00.000Z');
  assert.deepEqual(bk.db.rows[0].photos.map(p => p.id), ['p1']);   // p2 는 본체가 없어 뺌
  assert.deepEqual(bk.photos.map(p => p.id), ['p1', 'p3']);        // p9 는 어느 건에도 안 붙어 뺌
  assert.equal(bk.warnings.length, 2);
  assert.match(bk.warnings.join(' '), /본체가 없는 사진 1장/);
});
test('백업: 다른 파일·깨진 JSON·깨진 사진 자료는 거름', () => {
  assert.match(L.parseBackup('{').error, /JSON/);
  assert.match(L.parseBackup(JSON.stringify({ app: 'other', db: { rows: [] } })).error, /백업 파일이 아닙니다/);
  const db = L.emptyDb(); db.rows = [row({ photos: [{ id: 'x' }] })];
  const bk = L.parseBackup(L.buildBackup(db, [{ id: 'x', data: '<script>' }]));
  assert.equal(bk.photos.length, 0);
  assert.equal(bk.db.rows[0].photos, undefined);
});

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
