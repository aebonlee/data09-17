// 실행: node test/logic.test.mjs   (의존성 없음)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
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
  assert.deepEqual(m, { mgmt_no: 'NO', date: '발생 일자', part_no: 'P/N', part_name: '부품명', defect_type: '불량 구분', symptom: '불량내용', cause: '원인', action: '조치내용', qty: '수량', process: '라인' });
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
  assert.equal(L.detectRepeats(three, { days: 10, min: 3 }).length, 1);
  assert.equal(L.detectRepeats(three, { days: 9, min: 3 }).length, 0);
});
test('묶음 기준 「같은 불량유형」이면 품번 B 도 함께 셈', () => {
  const r = L.detectRepeats(rep, { groupBy: 'defect', days: 3, min: 4 });
  // 9/10·9/11(A)·9/11(B)·9/12 = 3일 안 4건
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].label, r[0].count, r[0].qty], ['찍힘', 4, 11]);
});
test('품번이 빈 행은 품번 묶음에서 빠짐', () => {
  const r = L.detectRepeats([row({ date: '2026-09-01', part_no: '', defect_type: '찍힘' }), row({ date: '2026-09-01', part_no: '', defect_type: '찍힘' })], { days: 1, min: 2 });
  assert.equal(r.length, 0);
});
test('잘못된 기준값은 오류', () => {
  assert.throws(() => L.detectRepeats(rep, { days: 0, min: 3 }));
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
  assert.match(txt, /3건, 기간 2026-01-05 ~ 2026-03-20 \(3개월\)/);
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

console.log('\n' + passed + '개 통과' + (process.exitCode ? ' — 실패 있음' : ''));
