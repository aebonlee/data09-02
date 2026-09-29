-- ============================================================================
-- 로컬 검증 전용 — data09-02 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  역할 전환으로 실제 사용자처럼 질의한다.
--    set role authenticated + request.jwt.claim.sub = 사용자 uuid  → auth.uid()
--    set role anon                                                   → 비로그인
-- ============================================================================
do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

do $t$ begin raise notice '[프로젝트] data09-02 — 재실행 · 제약 · RLS · 함수 권한'; end $t$;

-- ── 0. 재실행 안전 (run.sh 가 schema.sql 을 두 번 적용한 뒤다) ──────────────
do $t$
declare v_n int;
begin
  perform public._assert_eq(
    (select count(*)::int from pg_tables where schemaname = 'public'
      and tablename in ('items','accidents','techs')), 3, '표 3개가 한 번씩만 있다 (두 번 적용 후)');
  select count(*) into v_n from pg_trigger t where not t.tgisinternal and t.tgname like '%\_updated\_at';
  perform public._assert_eq(v_n, 3, 'updated_at 트리거가 표마다 하나씩 (중복 생성 없음)');
  select count(*) into v_n from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname in ('items','accidents','techs');
  perform public._assert_eq(v_n, 12, '정책이 표마다 4개씩, 중복 없이 12개');
end $t$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com')
on conflict (id) do nothing;

-- ── 1. 사용자 A — 정상 흐름과 제약 ───────────────────────────────────────
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';

do $t$
declare v_raised boolean;
begin
  insert into public.items (set_date, area_id, question, q_source)
  values ('2026-09-01', 1, '최소점화에너지를 설명하시오.', 'AI');
  insert into public.accidents (id, title, type, areas) values ('ACC-001', '예시 사고', '폭발', '1;7');
  insert into public.techs (id, title, type, areas) values ('TEC-001', '예시 기술', '방폭', '2');

  v_raised := false;
  begin insert into public.items (set_date, area_id, question) values ('2026-09-01', 11, 'X');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '영역번호는 1~10 만 (CHECK)');

  v_raised := false;
  begin insert into public.items (set_date, area_id, question) values ('2026-09-01', 1, '같은 날 같은 영역');
  exception when unique_violation then v_raised := true; end;
  perform public._assert(v_raised, '같은 날·같은 영역 두 번째 문제는 UNIQUE 가 막는다');

  v_raised := false;
  begin update public.items set eval_at = now(), score_engineer = 70, score_doctor = 70,
          score_grader = 70, score_reporter = 70, score_total = 70
         where set_date = '2026-09-01' and area_id = 1;
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '제출하지 않은 답안은 평가를 저장할 수 없다 (CHECK)');

  update public.items set ans_body = '본론', ans_submitted_at = now()
   where set_date = '2026-09-01' and area_id = 1;

  v_raised := false;
  begin update public.items set eval_at = now(), score_engineer = 70
         where set_date = '2026-09-01' and area_id = 1;
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '네 관점 점수가 다 없으면 평가를 저장할 수 없다 (CHECK)');

  v_raised := false;
  begin update public.items set score_doctor = 101 where set_date = '2026-09-01' and area_id = 1;
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '점수는 0~100 (CHECK)');

  v_raised := false;
  begin update public.items set model_answer = '모범', model_at = now()
         where set_date = '2026-09-01' and area_id = 1;
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '평가 전에는 모범답안을 저장할 수 없다 (CHECK)');

  update public.items set eval_at = now(), score_engineer = 70, score_doctor = 80,
         score_grader = 60, score_reporter = 90, score_total = 75
   where set_date = '2026-09-01' and area_id = 1;
  update public.items set model_answer = '모범', model_at = now()
   where set_date = '2026-09-01' and area_id = 1;
  perform public._assert_eq((select score_total from public.items where area_id = 1), 75.0::numeric(4,1),
    '제출 → 평가 → 모범답안 순서로는 저장된다');

  v_raised := false;
  begin insert into public.accidents (id, title) values ('TEC-009', '번호 틀림');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '사고 카드 번호는 ACC-000 형식 (CHECK)');

  v_raised := false;
  begin insert into public.accidents (id, title, type) values ('ACC-002', '유형 틀림', '붕괴');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '사고 유형은 누출·화재·폭발·기타만 (CHECK)');

  -- 기술 카드 제목·목차·내용 (2026-09-29 오후)
  insert into public.techs (id, title, toc, content) values ('TEC-010', '수소 취성', '수소안전', '고압 수소에서 금속이 약해진다');
  perform public._assert_eq((select toc from public.techs where id = 'TEC-001'), '기타', '목차를 안 주면 「기타」');
  v_raised := false;
  begin insert into public.techs (id, title, toc) values ('TEC-011', '목차 틀림', '연소폭팔공학');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '목차는 11개 중 하나만 (CHECK)');

  v_raised := false;
  begin insert into public.techs (id, title, src_url) values ('TEC-002', 'URL 틀림', 'ftp://x');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '출처 URL 은 http(s) 만 (CHECK)');

  v_raised := false;
  begin insert into public.techs (id, title, src_checked) values ('TEC-003', '출처 없음', 'Y');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '출처 없이 「출처 확인(Y)」은 표시할 수 없다 (CHECK)');

  v_raised := false;
  begin insert into public.accidents (id, title, areas) values ('ACC-003', '영역 표기', '1,7');
  exception when check_violation then v_raised := true; end;
  perform public._assert(v_raised, '관련 영역번호는 세미콜론 목록 (CHECK)');

  v_raised := false;
  begin insert into public.accidents (id, title) values ('ACC-001', '번호 중복');
  exception when unique_violation then v_raised := true; end;
  perform public._assert(v_raised, '내 카드 번호 중복은 PK 가 막는다');
end $t$;

-- ── 2. 사용자 B — A 의 자료를 못 보고 못 고친다 ───────────────────────────
set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $t$
declare v_n int; v_raised boolean := false;
begin
  perform public._assert_eq((select count(*) from public.items),     0::bigint, 'B 는 A 의 학습기록을 못 본다');
  perform public._assert_eq((select count(*) from public.accidents), 0::bigint, 'B 는 A 의 사고 카드를 못 본다');
  perform public._assert_eq((select count(*) from public.techs),     0::bigint, 'B 는 A 의 기술 카드를 못 본다');

  update public.items set score_total = 0;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, 'B 는 A 의 학습기록을 고칠 수 없다');
  delete from public.accidents;
  get diagnostics v_n = row_count;
  perform public._assert_eq(v_n, 0, 'B 는 A 의 카드를 지울 수 없다');

  begin
    insert into public.items (set_date, area_id, question, owner_id)
    values ('2026-09-02', 2, '남의 이름으로', '00000000-0000-0000-0000-00000000000a');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'B 는 남의 owner_id 로 행을 만들 수 없다');

  -- 같은 날·같은 영역·같은 카드 번호라도 사람이 다르면 따로 저장된다
  insert into public.items (set_date, area_id, question) values ('2026-09-01', 1, 'B 의 문제');
  insert into public.accidents (id, title) values ('ACC-001', 'B 의 카드');
  perform public._assert_eq((select count(*) from public.items), 1::bigint,
    '사람이 다르면 같은 날·같은 영역도 따로 저장된다 (UNIQUE 에 owner_id 포함)');
end $t$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
do $t$
declare v_before timestamptz; v_after timestamptz;
begin
  perform public._assert_eq((select count(*) from public.items), 1::bigint, 'A 는 자기 학습기록 1건만 본다');
  perform public._assert_eq((select title from public.accidents where id = 'ACC-001'), '예시 사고',
    'A 의 ACC-001 은 B 의 카드와 섞이지 않는다');
  select updated_at into v_before from public.techs where id = 'TEC-001';
  perform pg_sleep(0.01);
  update public.techs set core = '핵심' where id = 'TEC-001';
  select updated_at into v_after from public.techs where id = 'TEC-001';
  perform public._assert(v_after > v_before, 'updated_at 트리거가 수정 시각을 갱신한다');
end $t$;

-- ── 3. 비로그인(anon) ─────────────────────────────────────────────────────
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $t$
declare v_ok boolean; v_raised boolean := false; v_t text;
begin
  foreach v_t in array array['items','accidents','techs']
  loop
    execute format('select count(*) = 0 from public.%I', v_t) into v_ok;
    perform public._assert(v_ok, 'anon 은 ' || v_t || ' 을 한 행도 못 본다');
  end loop;
  begin
    insert into public.items (set_date, area_id, question, owner_id)
    values ('2026-09-01', 3, 'anon', '00000000-0000-0000-0000-00000000000a');
  exception when insufficient_privilege then v_raised := true; end;
  perform public._assert(v_raised, 'anon 은 쓸 수 없다');
end $t$;
reset role;

-- ── 4. 함수 ACL — PUBLIC·anon 에 EXECUTE 가 없다 (proacl 직접 확인) ───────────
--    이 프로젝트의 함수는 트리거 함수 하나뿐이고 RLS 정책 식에 함수를 쓰지 않으므로
--    anon 예외가 없다.
do $t$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and a.privilege_type = 'EXECUTE'
     and (a.grantee = 0 or a.grantee = 'anon'::regrole);
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert(
    (select proconfig @> array['search_path=public'] from pg_proc where proname = 'set_updated_at'),
    'set_updated_at 의 search_path=public 고정');
end $t$;

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
