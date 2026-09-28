-- ============================================================================
-- data09-02 — AI 기반 가스기술사 학습·기술정보 통합 지원 시스템
-- Supabase(PostgreSQL) 스키마 + RLS
--
--  무엇인가 : 지금은 브라우저 localStorage('data09-02.db') 한 곳에 들어 있는
--             학습기록·사고 카드·기술 카드를 DB 표로 옮기기 위한 스크립트입니다.
--             필드 이름은 도구(js/logic.js · js/config.js)의 필드 이름을 그대로 씁니다.
--             단, 카드의 `when` 은 PostgreSQL 예약어라 `when_text` 로 적습니다.
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  본인 프로젝트에 올리는 것을 전제로 하므로 테이블 이름에 접두사를 붙이지 않았습니다.
--  개인 학습 도구라 관리자 역할이 없습니다. 모든 행은 만든 사람만 보고 고칩니다.
--
--  테이블 (3)
--    items      학습기록 — 날짜 × 영역 한 행에 문제·답안·4관점 평가·모범답안
--    accidents  사고 카드 (5항목 + 출처)
--    techs      기술 카드 (기술명 + 5항목 + 출처)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

-- 학습기록 — 하루에 영역마다 한 문제. 단계: 문제 → 답안 작성 → 제출 → AI 평가 → 모범답안
create table if not exists public.items (
  id               bigint generated always as identity primary key,
  set_date         date not null,                                   -- 출제일
  area_id          int  not null check (area_id between 1 and 10), -- 10개 출제 영역 (config.js AREAS)
  question         text not null check (length(trim(question)) > 0),
  q_source         text not null default '직접',                    -- 출제 방식 (AI·직접 등)
  ans_intro        text not null default '',                        -- 답안_서론
  ans_body         text not null default '',                        -- 답안_본론
  ans_conclusion   text not null default '',                        -- 답안_결론
  ans_saved_at     timestamptz,                                     -- 임시저장 시각
  ans_submitted_at timestamptz,                                     -- 제출 시각
  -- 4관점 평가 (config.js ROLES) — 점수는 0~100
  score_engineer   numeric(4,1) check (score_engineer between 0 and 100),
  cmt_engineer     text not null default '',
  score_doctor     numeric(4,1) check (score_doctor   between 0 and 100),
  cmt_doctor       text not null default '',
  score_grader     numeric(4,1) check (score_grader   between 0 and 100),
  cmt_grader       text not null default '',
  score_reporter   numeric(4,1) check (score_reporter between 0 and 100),
  cmt_reporter     text not null default '',
  score_total      numeric(4,1) check (score_total    between 0 and 100),  -- 네 점수의 평균
  cmt_total        text not null default '',                        -- 종합의견
  eval_at          timestamptz,                                     -- 평가 일시
  model_answer     text not null default '',                        -- 모범답안
  model_at         timestamptz,                                     -- 모범답안 일시
  owner_id         uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),              -- 출제 일시
  updated_at       timestamptz not null default now(),
  -- 도구와 같은 단계 규칙: 제출 없이 평가 없고, 평가 없이 모범답안 없다
  constraint items_eval_after_submit check (eval_at is null or ans_submitted_at is not null),
  constraint items_model_after_eval  check (model_at is null or eval_at is not null),
  -- 평가를 저장했으면 네 점수와 종합 점수가 모두 있어야 한다 (saveEval 의 missing_scores)
  constraint items_eval_scores check (eval_at is null or (
    score_engineer is not null and score_doctor is not null and
    score_grader is not null and score_reporter is not null and score_total is not null)),
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 'owner_id,set_date,area_id' 로 반드시 지정할 것
  constraint items_owner_date_area_key unique (owner_id, set_date, area_id)
);
create index if not exists items_owner_date_idx on public.items (owner_id, set_date desc);

-- 사고 카드 — id 는 도구가 붙이는 'ACC-001' 형식
create table if not exists public.accidents (
  id          text not null check (id ~ '^ACC-\d{3,}$'),
  title       text not null check (length(trim(title)) > 0),        -- 사고명
  when_text   text not null default '',                             -- 발생 시기 (도구 필드 `when`)
  type        text not null default '' check (type in ('', '누출', '화재', '폭발', '기타')),
  areas       text not null default '' check (areas ~ '^(\d{1,2}(;\d{1,2})*)?$'),  -- 관련 영역번호 '1;7'
  overview    text not null default '',                             -- 사고 개요
  cause       text not null default '',                             -- 사고 원인
  mechanism   text not null default '',                             -- 사고발생 메커니즘
  prevention  text not null default '',                             -- 재발방지대책
  opinion     text not null default '',                             -- 가스기술사 종합의견
  src_title   text not null default '',                             -- 출처_문서명
  src_org     text not null default '',                             -- 출처_발행기관
  src_url     text not null default '' check (src_url = '' or src_url ~* '^https?://\S+$'),
  src_checked text not null default '' check (src_checked in ('', 'Y')),
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 「출처 확인(Y)」은 출처(문서명 또는 URL)가 있을 때만 (validateCard 의 source_needed)
  constraint accidents_checked_needs_source check (src_checked = '' or src_title <> '' or src_url <> ''),
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 'owner_id,id' 로 반드시 지정할 것
  constraint accidents_pkey primary key (owner_id, id)
);

-- 기술 카드 — id 는 'TEC-001' 형식
create table if not exists public.techs (
  id          text not null check (id ~ '^TEC-\d{3,}$'),
  title       text not null check (length(trim(title)) > 0),        -- 기술명
  when_text   text not null default '',                             -- 연도 (도구 필드 `when`)
  type        text not null default '' check (type in ('', '수소 저장·운송', '가스누출 감지',
                '스마트 가스안전관리', 'AI 기반 이상감지', '방폭', '고압가스 저장', '도시가스 안전', '기타')),
  areas       text not null default '' check (areas ~ '^(\d{1,2}(;\d{1,2})*)?$'),
  definition  text not null default '',                             -- 기술 정의
  problem     text not null default '',                             -- 기존 기술의 문제점
  core        text not null default '',                             -- 핵심 기술
  application text not null default '',                             -- 적용 분야
  outlook     text not null default '',                             -- 향후 발전방향
  src_title   text not null default '',
  src_org     text not null default '',
  src_url     text not null default '' check (src_url = '' or src_url ~* '^https?://\S+$'),
  src_checked text not null default '' check (src_checked in ('', 'Y')),
  owner_id    uuid not null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint techs_checked_needs_source check (src_checked = '' or src_title <> '' or src_url <> ''),
  -- ⚠ 프런트에서 upsert 할 때 onConflict 를 'owner_id,id' 로 반드시 지정할 것
  constraint techs_pkey primary key (owner_id, id)
);

-- ----------------------------------------------------------------------------
-- 2. 함수 — search_path 고정
-- ----------------------------------------------------------------------------

-- updated_at 자동 갱신
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['items','accidents','techs']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만 보고 쓴다. 비로그인(anon)은 정책이 없어 아무것도 못 한다
-- ----------------------------------------------------------------------------

alter table public.items     enable row level security;
alter table public.accidents enable row level security;
alter table public.techs     enable row level security;

do $rls$
declare t text;
begin
  foreach t in array array['items','accidents','techs']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read',   t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 함수 실행 권한
--
--  ⚠ GRANT 만으로는 제한되지 않는다. PostgreSQL 이 PUBLIC 에, Supabase 가
--    anon·authenticated·service_role 에 EXECUTE 를 미리 붙이므로 둘 다 끊는다.
--  트리거 전용 함수는 authenticated 를 남긴다(직접 호출하면 "can only be called
--  as trigger" 로 죽어 무해하다).
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at() from public, anon;
grant execute on function public.set_updated_at() to authenticated;
