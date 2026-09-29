-- ============================================================================
-- 로컬 검증 전용 — data09-17 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B·비로그인(anon) 세 역할로 번갈아 들어가
--  RLS 격리 · 기록성 표 · 제약 · 함수 권한을 실제로 확인한다.
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 보조 함수 — 이름이 _assert 로 시작해 공통 권한 검사에서 제외된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    v_state := sqlstate;
  end;
  if v_state = p_state then raise notice '  OK   %', p_label;
  else raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 %)', p_label, p_state, coalesce(v_state, '성공함');
  end if;
end;
$fn$;

create or replace function public._assert_rows(p_sql text, p_rows int, p_label text)
returns void language plpgsql set search_path = public as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, p_rows, p_label);
end;
$fn$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'b@example.com')
on conflict (id) do nothing;

-- ── 재실행 안전 ────────────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 재적용 · 정책 수'; end $t$;
do $t$ begin
  perform public._assert_eq(
    (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    22, '두 번 적용해도 정책이 22개 그대로다');
  perform public._assert_eq(
    (select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal),
    6, '두 번 적용해도 트리거가 6개 그대로다(updated_at 5 + 변경 기록 1)');
end $t$;

-- ── 사용자 A ───────────────────────────────────────────────────
set role authenticated;
do $t$ begin perform set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false); end $t$;

do $t$ begin raise notice '[프로젝트] 사용자 A 입력 · 제약 · 변경 기록'; end $t$;
do $t$
declare v_def bigint; v_draft bigint;
begin
  insert into public.defect (row_key, mgmt_no, date, part_no, part_name, defect_type, symptom, cause, action, qty, process, customer, src, is_sample)
    values ('r1', 'Q-001', '2026-09-01', 'EX-100', '예시 브래킷', '찍힘', '표면 찍힘', '지그 마모', '지그 교체', 12, '프레스', '예시고객', '예시.xlsx / 이력 3행', true)
    returning id into v_def;
  insert into public.defect (row_key, date, part_no, defect_type) values ('r2', '2026-09-03', 'EX-100', '찍힘');
  insert into public.defect (row_key, date) values ('r3', '2026-09-05');   -- 품번·유형 빈칸(주의)은 받는다
  perform set_config('test.a_def', v_def::text, false);

  insert into public.class_dict (field, variant, canonical) values ('defect_type', '찍힘불량', '찍힘');
  insert into public.column_mapping (mapping) values ('{"date":"발생일자","part_no":"P/N"}');
  insert into public.app_settings default values;
  insert into public.countermeasure_draft (input, picked, answer, parsed)
    values ('{"date":"2026-09-10","part_no":"EX-100","memo":"찍힘 재발"}', '{r1,r2}',
            $ans$【불량현상】
표면 찍힘
【발생원인】
지그 마모$ans$, '{"symptom":"표면 찍힘","cause":"지그 마모"}')
    returning id into v_draft;

  perform public._assert_eq((select owner_id from public.defect where id = v_def),
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'owner_id 가 auth.uid() 로 자동으로 채워진다');
  perform public._assert_eq((select min_count from public.app_settings), 3, '탐지 기준 기본값이 도구 기본값(30일 3건)과 같다');
  perform public._assert((select strpos(answer, E'\n') > 0 from public.countermeasure_draft where id = v_draft),
    'AI 답변의 줄바꿈이 그대로 저장된다');

  -- 변경 기록 트리거
  update public.defect set action = '지그 교체 + 주기 점검' where id = v_def;
  perform public._assert_eq(
    (select count(*)::int from public.defect_change_log where defect_id = v_def), 2,
    '입력·수정이 변경 기록에 자동으로 2건 남는다');
  perform public._assert_eq(
    (select before->>'action' from public.defect_change_log where defect_id = v_def and op = 'update'),
    '지그 교체', '수정 전 값이 before 에 남는다');
  delete from public.defect where row_key = 'r3';
  perform public._assert_eq(
    (select count(*)::int from public.defect_change_log where row_key = 'r3' and op = 'delete'), 1,
    '이력을 지워도 삭제 기록은 남는다');

  -- UNIQUE · upsert
  perform public._assert_raises(
    $q$insert into public.defect (row_key, date) values ('r1', '2026-01-01')$q$,
    '23505', '같은 사용자의 같은 행 id(row_key)는 두 번 들어가지 않는다');
  insert into public.class_dict (field, variant, canonical) values ('defect_type', '찍힘불량', '찍힘(외관)')
    on conflict (owner_id, field, variant) do update set canonical = excluded.canonical;
  perform public._assert_eq((select canonical from public.class_dict where variant = '찍힘불량'),
    '찍힘(외관)', 'onConflict (owner_id, field, variant) upsert 가 갱신으로 동작한다');

  -- CHECK · NOT NULL
  perform public._assert_raises(
    $q$insert into public.defect (row_key) values ('r9')$q$,
    '23502', '발생일이 없는 이력은 받지 않는다(도구의 「오류」)');
  perform public._assert_raises(
    $q$insert into public.defect (row_key, date, qty) values ('r9', '2026-09-01', -1)$q$,
    '23514', '불량수량 음수는 받지 않는다(도구의 「오류」)');
  perform public._assert_raises(
    $q$insert into public.class_dict (field, variant, canonical) values ('symptom', 'a', 'b')$q$,
    '23514', '표기 사전은 불량유형·원인 분류·발생원인에만 쓴다');
  perform public._assert_raises(
    $q$update public.app_settings set group_by = 'customer'$q$,
    '23514', '반복·다발 묶음 기준은 정해진 4가지만 받는다');
  perform public._assert_raises(
    $q$update public.app_settings set min_count = 1$q$,
    '23514', '다발 기준 건수는 2건 이상이다');
  perform public._assert_raises(
    $q$update public.app_settings set days = 0$q$,
    '23514', '기간은 1일 이상이다');

  update public.countermeasure_draft set updated_at = '2000-01-01' where id = v_draft;
  perform public._assert((select updated_at > '2001-01-01' from public.countermeasure_draft where id = v_draft),
    '수정하면 updated_at 트리거가 현재 시각으로 바꾼다');
end $t$;

do $t$ begin raise notice '[프로젝트] 기록성 표(defect_change_log)'; end $t$;
do $t$ begin
  perform public._assert_rows('update public.defect_change_log set op = $$insert$$',
    0, 'defect_change_log 는 본인도 UPDATE 할 수 없다(0행)');
  perform public._assert_rows('delete from public.defect_change_log',
    0, 'defect_change_log 는 본인도 DELETE 할 수 없다(0행)');
  perform public._assert_eq((select count(*)::int from public.defect_change_log), 5,
    'defect_change_log 가 그대로 5건 남아 있다(입력 3·수정 1·삭제 1)');
end $t$;

-- ── 사용자 B ───────────────────────────────────────────────────
do $t$ begin perform set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false); end $t$;

do $t$ begin raise notice '[프로젝트] RLS — 사용자 B 는 A 의 자료에 손대지 못한다'; end $t$;
do $t$
declare
  t text;
  v_def text := current_setting('test.a_def');
begin
  foreach t in array array['defect', 'class_dict', 'column_mapping', 'app_settings',
                           'countermeasure_draft', 'defect_change_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'B 에게 A 의 ' || t || ' 가 안 보인다');
  end loop;

  perform public._assert_rows('update public.defect set cause = $$조작$$ where id = ' || v_def,
    0, 'B 는 A 의 불량 이력을 고칠 수 없다(0행)');
  perform public._assert_rows('delete from public.defect where id = ' || v_def,
    0, 'B 는 A 의 불량 이력을 지울 수 없다(0행)');
  perform public._assert_rows('update public.app_settings set days = 999',
    0, 'B 는 A 의 설정을 고칠 수 없다(0행)');
  perform public._assert_rows('delete from public.class_dict',
    0, 'B 는 A 의 표기 사전을 지울 수 없다(0행)');

  perform public._assert_raises(
    $q$insert into public.defect (owner_id, row_key, date) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'x', '2026-09-01')$q$,
    '42501', 'B 는 owner_id 를 A 로 위장해 이력을 넣을 수 없다');
  perform public._assert_raises(format(
    $q$insert into public.defect_change_log (owner_id, defect_id, row_key, op) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', %s, 'r1', 'delete')$q$, v_def),
    '42501', 'B 는 A 의 변경 기록을 위조해 넣을 수 없다');

  -- B 도 같은 row_key 로 자기 것을 만들 수 있다(row_key UNIQUE 는 사용자별)
  insert into public.defect (row_key, date) values ('r1', '2026-09-01');
  perform public._assert_rows('select 1 from public.defect', 1, 'B 는 자기 이력만 본다');
  perform public._assert_rows('select 1 from public.defect_change_log', 1, 'B 는 자기 변경 기록만 본다');
end $t$;

-- ── 비로그인(anon) ─────────────────────────────────────────────
reset role;
set role anon;
do $t$ begin perform set_config('request.jwt.claim.sub', '', false); end $t$;

do $t$ begin raise notice '[프로젝트] anon 차단'; end $t$;
do $t$
declare t text;
begin
  foreach t in array array['defect', 'class_dict', 'column_mapping', 'app_settings',
                           'countermeasure_draft', 'defect_change_log']
  loop
    perform public._assert_rows(format('select 1 from public.%I', t), 0, 'anon 에게 ' || t || ' 가 안 보인다');
  end loop;
  perform public._assert_raises($q$insert into public.defect (row_key, date) values ('anon', '2026-09-01')$q$,
    '42501', 'anon 은 불량 이력을 쓸 수 없다');
  perform public._assert_raises($q$insert into public.countermeasure_draft (answer) values ('x')$q$,
    '42501', 'anon 은 대책서 초안을 쓸 수 없다');
  perform public._assert_raises($q$insert into public.defect_change_log (defect_id, row_key, op) values (1, 'x', 'insert')$q$,
    '42501', 'anon 은 변경 기록을 쓸 수 없다');
  perform public._assert_raises($q$select public.set_updated_at()$q$,
    '42501', 'anon 은 set_updated_at() 을 실행할 수 없다');
  perform public._assert_raises($q$select public.log_defect_change()$q$,
    '42501', 'anon 은 log_defect_change() 를 실행할 수 없다');
end $t$;

reset role;

-- ── 함수 ACL ───────────────────────────────────────────────────
do $t$ begin raise notice '[프로젝트] 함수 ACL (proacl)'; end $t$;
do $t$
declare v_bad text;
begin
  -- 이 스키마에는 anon 예외 함수가 없다(RLS 정책 식에서 함수를 쓰지 않음)
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert(
    (select bool_and(proacl is not null) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수의 proacl 이 기본값(NULL=PUBLIC 실행)이 아니다');
  perform public._assert(
    (select bool_and(proconfig @> array['search_path=public'])
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname not like '\_assert%'),
    '모든 함수가 search_path = public 으로 고정돼 있다');
  perform public._assert(
    (select not prosecdef from pg_proc where proname = 'log_defect_change'),
    '변경 기록 트리거는 SECURITY DEFINER 가 아니다(RLS 를 그대로 탄다)');
end $t$;

-- 정리
alter table public.defect disable trigger defect_change;
delete from public.defect;
alter table public.defect enable trigger defect_change;
delete from public.defect_change_log;
delete from public.class_dict;
delete from public.column_mapping;
delete from public.app_settings;
delete from public.countermeasure_draft;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
