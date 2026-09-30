-- ============================================================================
-- data09-17 — 품질불량 이력 분석 도구 (이력 관리 · 유사 불량 검색 · 반복·다발 탐지 · 대책서 초안)
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금 브라우저 localStorage('data09-17.db')에만 두는
--             불량 이력·열 연결·표기 묶음 사전·탐지 기준·대책서 초안을
--             DB 로 옮길 때 쓸 테이블과 보안 정책입니다.
--             이력을 고치거나 지울 때마다 변경 이력(defect_change_log)이 트리거로 자동으로 쌓입니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--  회사 공용 URL·키는 어디에도 들어 있지 않습니다.
--
--  테이블 (7개) + Storage 버킷 1개
--    defect             — 품질불량 이력 한 건 (발생일·품번·불량유형·현상·원인·대책·수량 …)
--    class_dict         — 표기 묶음 사전 (불량유형·원인 분류·발생원인의 다른 표기 → 대표 이름)
--    column_mapping     — 표준 항목 ↔ 실제 열 이름 연결 (다음 파일에 재사용)
--    app_settings       — 반복·다발 탐지 기준과 유사 불량 검색 가중치
--    countermeasure_draft — 대책서 초안 (새 불량 정보·붙인 과거 이력·AI 답변·칸 나눈 결과)
--    defect_change_log  — 불량 이력 변경 기록 — 기록성, 수정·삭제 불가 (트리거가 자동 기록)
--    defect_photo       — 불량 이력 한 건에 붙인 사진의 정보 (2026-09-30 추가)
--                         사진 파일 자체는 비공개 Storage 버킷 defect-photos 에 둔다
--                         (경로 = <owner_id>/<row_key>/<photo_key>.jpg, 작은 그림은 …_thumb.jpg)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 불량 이력 (logic.js STD_FIELDS 15개 + 도구가 붙이는 id·_src)
--   2026-09-30: status(진행상태 — 실제 이력의 「완료여부」)·source(자료 구분 — 품질불량 이력 / 공정불량 이력 LIST) 추가
--   도구의 입력값 검사에서 「오류」인 행(발생일 없음·못 읽음, 수량 음수·못 읽음)은
--   DB 가 받지 않는다. 도구 화면에서 고친 뒤 저장한다. 「주의」(품번·불량유형 빈칸)는 받는다.
create table if not exists public.defect (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  row_key      text not null,                        -- 도구의 행 id ('r1', 'r2' …)
  mgmt_no      text not null default '',             -- 관리번호
  date         date not null,                        -- 발생일 (필수)
  part_no      text not null default '',             -- 품번
  part_name    text not null default '',             -- 품명
  defect_type  text not null default '',             -- 불량유형
  symptom      text not null default '',             -- 불량현상
  cause_cat    text not null default '',             -- 원인 분류 (4M 등)
  cause        text not null default '',             -- 발생원인
  action       text not null default '',             -- 개선대책
  prevention   text not null default '',             -- 재발방지대책
  qty          numeric check (qty is null or qty >= 0),   -- 불량수량 (비어 있을 수 있음, 음수 불가)
  process      text not null default '',             -- 공정
  customer     text not null default '',             -- 고객사
  status       text not null default '',             -- 진행상태 (완료여부)
  source       text not null default '',             -- 자료 구분 (빈 값 = 품질불량 이력)
  src          text not null default '',             -- 가져온 곳 ('파일 / 시트 12행')
  is_sample    boolean not null default false,       -- _sample
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint defect_date_range check (date between date '1900-01-01' and date '2999-12-31'),
  -- ⚠ upsert 시 onConflict: 'owner_id,row_key'
  constraint defect_owner_row_key unique (owner_id, row_key)
);
-- 이전 판으로 이미 만든 표에도 새 칸을 더한다(재실행 안전)
alter table public.defect add column if not exists status text not null default '';
alter table public.defect add column if not exists source text not null default '';
create index if not exists defect_owner_date_idx on public.defect (owner_id, date desc);
create index if not exists defect_part_type_idx  on public.defect (owner_id, part_no, defect_type);

-- 표기 묶음 사전 (db.dict[field] = { squash(원래 표기): 대표 이름 })
create table if not exists public.class_dict (
  owner_id    uuid not null default auth.uid(),
  field       text not null check (field in ('defect_type', 'cause_cat', 'cause')),
  variant     text not null check (length(variant) > 0),     -- 공백·기호를 뺀 원래 표기
  canonical   text not null check (length(btrim(canonical)) > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- ⚠ upsert 시 onConflict: 'owner_id,field,variant'
  primary key (owner_id, field, variant)
);

-- 열 연결 (db.mapping = { 표준 항목 key: 실제 열 이름 }) — 사용자당 한 행
create table if not exists public.column_mapping (
  owner_id    uuid primary key default auth.uid(),
  mapping     jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping) = 'object'),
  -- 2026-09-30: 품질불량 이력 밖의 자료(공정불량 이력 LIST 등)의 열 연결 { 자료 구분: { 표준 항목: 열 이름 } }
  mapping_by_source jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping_by_source) = 'object'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 탐지 기준·검색 가중치 (DEFAULT_RULE · DEFAULT_SEARCH) — 사용자당 한 행
create table if not exists public.app_settings (
  owner_id      uuid primary key default auth.uid(),
  -- 2026-09-30 확정 기준: 같은 품번 또는 같은 불량유형이 기간 제한 없이(days = 0) 2건 이상
  group_by      text not null default 'part_or_defect',
  days          int not null default 0 check (days >= 0),         -- N일 안에 (0 = 기간 제한 없음)
  min_count     int not null default 2  check (min_count >= 2),   -- M건 이상 (rule.min)
  part_bonus    numeric not null default 2 check (part_bonus >= 0),
  type_bonus    numeric not null default 2 check (type_bonus >= 0),
  search_limit  int not null default 10 check (search_limit >= 1),  -- search.limit
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 이전 판으로 만든 표 고치기(재실행 안전): 칸 추가, 묶음 기준·기간 제약과 기본값을 확정 기준으로
alter table public.column_mapping add column if not exists mapping_by_source jsonb not null default '{}'::jsonb;
alter table public.column_mapping drop constraint if exists column_mapping_mapping_by_source_check;
alter table public.column_mapping add constraint column_mapping_mapping_by_source_check check (jsonb_typeof(mapping_by_source) = 'object');
alter table public.app_settings drop constraint if exists app_settings_group_by_check;
alter table public.app_settings add constraint app_settings_group_by_check
  check (group_by in ('part_or_defect', 'part_defect', 'defect', 'part', 'part_cause'));
alter table public.app_settings drop constraint if exists app_settings_days_check;
alter table public.app_settings add constraint app_settings_days_check check (days >= 0);
alter table public.app_settings alter column group_by set default 'part_or_defect';
alter table public.app_settings alter column days set default 0;
alter table public.app_settings alter column min_count set default 2;

-- 대책서 초안 (db.draft = { input, picked, answer, parsed })
-- 지금 도구는 하나만 기억하지만 DB 에서는 쓴 초안을 쌓아 둔다.
create table if not exists public.countermeasure_draft (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  input       jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
                -- { date, part_no, part_name, defect_type, process, customer, qty, memo }
  picked      text[] not null default '{}',          -- 붙인 과거 이력의 row_key 목록
  answer      text not null default '',              -- 붙여 넣은 AI 답변 원문
  parsed      jsonb check (parsed is null or jsonb_typeof(parsed) = 'object'),
                -- 【불량현상】【발생원인】【개선대책】【재발방지대책】 칸 나눈 결과
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists countermeasure_draft_owner_idx on public.countermeasure_draft (owner_id, created_at desc);

-- 불량 이력 변경 기록 — 기록성이라 UPDATE/DELETE 정책이 없다.
-- defect 를 지워도 기록은 남아야 하므로 외래 키를 걸지 않는다.
create table if not exists public.defect_change_log (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null default auth.uid(),
  defect_id   bigint not null,
  row_key     text not null,
  op          text not null check (op in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  changed_at  timestamptz not null default now()
);
create index if not exists defect_change_log_idx on public.defect_change_log (owner_id, defect_id, changed_at desc);

-- 불량 사진 정보 (row.photos = [{ id, name, w, h, bytes, memo }] — 2026-09-30 추가)
--   도구는 지금 사진 본체를 브라우저 IndexedDB 에 두고, DB 로 옮기면 본체는 Storage(비공개 버킷)에 올린다.
--   이력(defect)을 지우면 사진 정보도 함께 지운다(외래 키 on delete cascade).
--   ⚠ Storage 의 파일은 외래 키로 지워지지 않는다 — 앱이 defect 를 지울 때 Storage 파일도 함께 지운다.
create table if not exists public.defect_photo (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  row_key      text not null,                        -- 붙은 이력의 row_key
  photo_key    text not null check (length(photo_key) between 1 and 64),   -- 도구의 사진 id ('ph…')
  sort_order   int not null default 0 check (sort_order >= 0),             -- 건 안에서의 순서
  name         text not null default '',             -- 원래 파일 이름
  memo         text not null default '' check (length(memo) <= 200),       -- 사진 설명
  width        int check (width is null or width between 1 and 1280),      -- 저장본은 긴 변 1280px 이하
  height       int check (height is null or height between 1 and 1280),
  bytes        int check (bytes is null or bytes >= 0),
  storage_path text not null,                        -- defect-photos 버킷 안의 경로
  thumb_path   text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- 경로 첫 폴더는 반드시 본인 id — 다른 사람 폴더를 가리키는 행을 만들 수 없게
  constraint defect_photo_path_owner check (split_part(storage_path, '/', 1) = owner_id::text),
  constraint defect_photo_thumb_owner check (thumb_path = '' or split_part(thumb_path, '/', 1) = owner_id::text),
  -- ⚠ upsert 시 onConflict: 'owner_id,photo_key'
  constraint defect_photo_owner_key unique (owner_id, photo_key),
  constraint defect_photo_defect_fk foreign key (owner_id, row_key)
    references public.defect (owner_id, row_key) on delete cascade on update cascade
);
create index if not exists defect_photo_row_idx on public.defect_photo (owner_id, row_key, sort_order);

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 고정
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- defect 가 바뀔 때마다 변경 기록을 남긴다.
-- SECURITY DEFINER 가 아니다 — 호출한 사용자 권한으로 넣으므로 log 의 RLS(owner_id = auth.uid())를 그대로 탄다.
create or replace function public.log_defect_change()
returns trigger language plpgsql set search_path = public as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.defect_change_log (owner_id, defect_id, row_key, op, before, after)
    values (new.owner_id, new.id, new.row_key, 'insert', null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.defect_change_log (owner_id, defect_id, row_key, op, before, after)
    values (new.owner_id, new.id, new.row_key, 'update', to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into public.defect_change_log (owner_id, defect_id, row_key, op, before, after)
    values (old.owner_id, old.id, old.row_key, 'delete', to_jsonb(old), null);
    return old;
  end if;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['defect', 'class_dict', 'column_mapping', 'app_settings', 'countermeasure_draft', 'defect_photo']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

drop trigger if exists defect_change on public.defect;
create trigger defect_change after insert or update or delete on public.defect
  for each row execute function public.log_defect_change();

-- ----------------------------------------------------------------------------
-- 3. RLS — 행은 만든 사람(owner_id)만 보고 고친다. 비로그인(anon)은 아무것도 못 한다.
-- ----------------------------------------------------------------------------

alter table public.defect               enable row level security;
alter table public.class_dict           enable row level security;
alter table public.column_mapping       enable row level security;
alter table public.app_settings         enable row level security;
alter table public.countermeasure_draft enable row level security;
alter table public.defect_change_log    enable row level security;
alter table public.defect_photo         enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['defect', 'class_dict', 'column_mapping', 'app_settings', 'countermeasure_draft', 'defect_photo']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- 기록성 표 : 읽기·추가만. 수정·삭제 정책을 두지 않아 사후 조작을 막는다.
drop policy if exists defect_change_log_select on public.defect_change_log;
drop policy if exists defect_change_log_insert on public.defect_change_log;
create policy defect_change_log_select on public.defect_change_log for select to authenticated
  using (owner_id = auth.uid());
create policy defect_change_log_insert on public.defect_change_log for insert to authenticated
  with check (owner_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3-1. Storage — 사진 파일용 비공개 버킷 (2026-09-30 추가)
--
--  버킷 defect-photos 는 public = false 다. 공개 주소로는 열리지 않고,
--  로그인한 본인이 자기 폴더(<본인 id>/…)의 파일만 올리고·보고·바꾸고·지울 수 있다.
--  화면에 보일 때는 앱이 createSignedUrl(짧은 유효시간)로 주소를 받아 쓴다.
--  파일 한 개 5MB, JPEG·PNG·WebP 만 받는다(도구가 올리는 것은 1280px JPEG 라 수백 KB).
--
--  storage 스키마가 없는 곳(로컬 검증의 옛 스텁 등)에서는 건너뛴다.
-- ----------------------------------------------------------------------------
do $st$
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    raise notice 'storage 스키마가 없어 사진 버킷 설정을 건너뜁니다';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('defect-photos', 'defect-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = false,
    file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists defect_photos_select on storage.objects;
  drop policy if exists defect_photos_insert on storage.objects;
  drop policy if exists defect_photos_update on storage.objects;
  drop policy if exists defect_photos_delete on storage.objects;
  create policy defect_photos_select on storage.objects for select to authenticated
    using (bucket_id = 'defect-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy defect_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'defect-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy defect_photos_update on storage.objects for update to authenticated
    using (bucket_id = 'defect-photos' and (storage.foldername(name))[1] = auth.uid()::text)
    with check (bucket_id = 'defect-photos' and (storage.foldername(name))[1] = auth.uid()::text);
  create policy defect_photos_delete on storage.objects for delete to authenticated
    using (bucket_id = 'defect-photos' and (storage.foldername(name))[1] = auth.uid()::text);
end;
$st$;

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 신규 함수마다 anon·authenticated·service_role 에 자동 부여
--  그래서 PUBLIC 과 anon 을 둘 다 끊고 authenticated 에만 다시 준다.
--  (이 스키마에는 RLS 정책 식에서 쓰는 함수가 없으므로 anon 예외도 없다)
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at()    from public, anon;
revoke all on function public.log_defect_change() from public, anon;
-- 둘 다 트리거 전용 함수. 트리거 발화 시 호출자 EXECUTE 를 검사할 경우를 대비해 남긴다.
-- 직접 호출하면 "can only be called as trigger" 로 죽으므로 무해하다.
grant execute on function public.set_updated_at()    to authenticated;
grant execute on function public.log_defect_change() to authenticated;

-- ----------------------------------------------------------------------------
-- 끝.
-- ----------------------------------------------------------------------------
