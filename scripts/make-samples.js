// 예시 데이터 파일 생성: node scripts/make-samples.js
// js/sample-data.js 의 가상 이력을 samples/ 에 xlsx·csv 로 씁니다.
// 열 이름을 일부러 표준 항목과 다르게 적어(예: P/N, 불량 구분, 조치내용) 「열 맞추기」를 시험할 수 있게 합니다.
const fs = require('fs');
const path = require('path');
const XLSX = require('../vendor/xlsx.full.min.js');
const L = require('../js/logic.js');
const Sample = require('../js/sample-data.js');

const out = path.join(__dirname, '..', 'samples');
fs.mkdirSync(out, { recursive: true });
const HEAD = [['mgmt_no', 'NO'], ['date', '발생 일자'], ['part_no', 'P/N'], ['part_name', '부품명'], ['defect_type', '불량 구분'],
  ['symptom', '불량내용'], ['cause_cat', '원인구분'], ['cause', '원인'], ['action', '조치내용'], ['prevention', '재발방지'],
  ['qty', '수량'], ['process', '라인'], ['customer', '고객']];
const rows = Sample.build();
const aoa = [['품질불량 관리대장 — 예시 데이터(가상의 값, 실제 이력 아님)'], [], HEAD.map(h => h[1])];
rows.forEach(r => aoa.push(HEAD.map(([k]) => r[k] == null ? '' : r[k])));

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '불량이력');
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['이 파일은 도구 시연용 예시 데이터입니다. 품번·고객사·원인·대책은 모두 지어낸 값입니다.']]), '안내');
const xlsxPath = path.join(out, '예시데이터_품질불량이력.xlsx');
fs.writeFileSync(xlsxPath, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }));
fs.writeFileSync(path.join(out, '예시데이터_품질불량이력.csv'), L.aoaToCsv(aoa.slice(2)));

// 검증: 방금 쓴 xlsx 를 앱과 같은 방식으로 다시 읽어 원본과 같은지 확인
const back = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
const a2 = XLSX.utils.sheet_to_json(back.Sheets['불량이력'], { header: 1, raw: true, defval: '' });
const hr = L.detectHeaderRow(a2);
const map = L.autoMap(L.headersOf(a2, hr));
const res = L.applyMapping(a2, { headerRow: hr, mapping: map });
if (hr !== 2) throw new Error('머리행 ' + hr);
if (Object.keys(map).length !== HEAD.length) throw new Error('자동 연결 ' + Object.keys(map).length + '/' + HEAD.length + ' ' + JSON.stringify(map));
if (res.rows.length !== rows.length) throw new Error('행 수 다름');
res.rows.forEach((r, i) => HEAD.forEach(([k]) => {
  const want = rows[i][k] == null ? (L.FIELD[k].type === 'number' ? null : '') : rows[i][k];
  if (r[k] !== want) throw new Error(i + '행 ' + k + ': ' + r[k] + ' != ' + want);
}));
console.log('samples 작성·재검증 완료: ' + rows.length + '건, 열 ' + HEAD.length + '개 자동 연결');
