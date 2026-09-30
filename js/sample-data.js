/*
 * 예시 데이터 — 실제 천일테크윈 품질 이력이 아닌 가상의 값입니다.
 * 품번·품명·고객사·원인·대책 문장은 모두 흐름을 보여 주려고 지어낸 것입니다.
 * 탐지·묶음이 제대로 되는지 보려고 일부러 넣은 것:
 *  - EX-1001 찍힘이 8월 말~9월 초에 몰려 발생(반복·다발)
 *  - EX-2003 용접불량이 6월에 2주 안 3건(반복·다발)
 *  - 띄어쓰기만 다른 표기(치수 불량/치수불량, 작업 자/작업자)
 *  - 낱말이 다른 같은 뜻(스크레치/스크래치, 작업자 실수/작업자) — 「표기 정리」에서 묶어 봅니다
 */
(function (root) {
  'use strict';

  // 같은 결과가 나오도록 고정 씨앗 난수
  function rng(seed) {
    var s = seed >>> 0;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  var PARTS = [
    ['EX-1001', '브래킷(예시)', '프레스', '고객사A(예시)'],
    ['EX-1002', '커버 플레이트(예시)', '프레스', '고객사A(예시)'],
    ['EX-2003', '프레임 어셈블리(예시)', '용접', '고객사B(예시)'],
    ['EX-2004', '마운팅 암(예시)', '용접', '고객사B(예시)'],
    ['EX-3005', '하우징(예시)', '가공', '고객사A(예시)'],
    ['EX-3006', '샤프트(예시)', '가공', '고객사C(예시)'],
    ['EX-4007', '외장 패널(예시)', '도장', '고객사C(예시)']
  ];
  var TYPES = {
    '프레스': [['찍힘', '제품 모서리에 찍힘 자국 발생'], ['버(Burr)', '절단면에 버가 남아 조립 시 걸림'], ['치수불량', '구멍 위치가 도면 공차를 벗어남']],
    '용접': [['용접불량', '용접 비드가 끊기고 기공이 보임'], ['치수 불량', '용접 후 뒤틀림으로 평면도 초과'], ['스패터', '용접 스패터가 표면에 붙어 있음']],
    '가공': [['치수불량', '외경이 하한 공차보다 작음'], ['스크래치', '가공면에 긁힌 자국 발생'], ['스크레치', '이송 중 표면에 긁힘 발생']],
    '도장': [['도장불량', '도장면에 기포와 흐름 발생'], ['이물', '도장면에 먼지 이물 부착'], ['색상차', '로트 간 색상 차이 발생']]
  };
  var CAUSES = [
    ['설비', '설비 셋팅값이 기준에서 벗어남', '셋팅값 재조정 및 작업 전 점검 실시', '셋팅 점검표에 항목 추가, 교대 시 확인'],
    ['금형', '금형 마모로 형상이 무뎌짐', '금형 연마 및 인서트 교체', '금형 타수 관리 기준을 정해 교체 주기 관리'],
    ['자재', '입고 자재 두께 편차', '해당 로트 선별 및 공급사 통보', '수입검사 항목에 두께 측정 추가'],
    ['작업자', '작업 표준 미준수', '작업자 재교육', '작업 표준서 현장 게시, 신규자 교육 강화'],
    ['작업 자', '취급 중 부딪힘', '적재 방법 개선', '제품 간 간지 삽입 기준 마련'],
    ['작업자 실수', '검사 누락', '전수 재검사', '검사 체크시트 서명 절차 도입'],
    ['방법', '이송 지그 구조상 접촉 발생', '지그 접촉부에 보호재 부착', '지그 설계 기준에 접촉 금지 영역 반영']
  ];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function addDays(ymd, n) {
    var p = ymd.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + n));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  function build() {
    var r = rng(20260928);
    var rows = [];
    function pick(a) { return a[Math.floor(r() * a.length)]; }
    function make(date, part, typePair, cause, qty) {
      rows.push({
        mgmt_no: '', date: date, part_no: part[0], part_name: part[1],
        defect_type: typePair[0], symptom: typePair[1],
        cause_cat: cause[0], cause: cause[1], action: cause[2], prevention: cause[3],
        qty: qty, process: part[2], customer: part[3]
      });
    }
    // 흩어진 이력: 2026-03-02 부터 대략 4일 간격
    var d = '2026-03-02';
    for (var i = 0; i < 44; i++) {
      var part = pick(PARTS);
      // 탐지용으로 넣은 묶음과 겹치지 않도록 이 둘은 흩어진 이력에서 뺍니다
      if (part[0] === 'EX-1001' || part[0] === 'EX-2003') part = PARTS[1 + (i % 2) * 3];
      make(d, part, pick(TYPES[part[2]]), pick(CAUSES), 1 + Math.floor(r() * 12));
      d = addDays(d, 3 + Math.floor(r() * 3));
      if (d > '2026-09-25') break;
    }
    // 반복·다발 1: EX-1001 찍힘 — 한 달 사이 5건
    ['2026-08-21', '2026-08-27', '2026-09-02', '2026-09-08', '2026-09-15'].forEach(function (dt, k) {
      make(dt, PARTS[0], TYPES['프레스'][0], k === 1 ? CAUSES[4] : CAUSES[1], 2 + k);
    });
    // 반복·다발 2: EX-2003 용접불량 — 2주 안 3건
    ['2026-06-03', '2026-06-09', '2026-06-16'].forEach(function (dt) {
      make(dt, PARTS[2], TYPES['용접'][0], CAUSES[0], 4);
    });
    // 한참 떨어진 같은 묶음(탐지되면 안 되는 건)
    make('2026-03-20', PARTS[0], TYPES['프레스'][0], CAUSES[3], 1);
    make('2026-04-28', PARTS[2], TYPES['용접'][0], CAUSES[5], 2);

    rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    rows.forEach(function (x, k) { x.mgmt_no = 'EX-Q-' + ('00' + (k + 1)).slice(-3); });
    // 진행상태(2026-09-30 대시보드용) — 9월 10일까지는 완료, 그 뒤는 조치 중인 것으로 둡니다(가상)
    rows.forEach(function (x) { x.status = x.date <= '2026-09-10' ? '완료' : '진행중'; });
    return rows;
  }

  // 「표기 정리」 시연용 추천(예시 데이터를 불러오면 사전에 넣어 둡니다). 키는 띄어쓰기·기호를 뺀 표기.
  var dictHint = { '작업자': '작업자', '작업자실수': '작업자' };
  var typeHint = { '스크레치': '스크래치' };

  var api = { build: build, dictHint: dictHint, typeHint: typeHint };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QCSample = api;
})(typeof window !== 'undefined' ? window : this);
