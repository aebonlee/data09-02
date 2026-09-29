/*
 * 설정 — 10개 출제 영역, 4개 평가 관점, 사고·기술 카드 양식 (기획서 7장: 설정 파일로 분리)
 * 영역·관점·양식을 바꿀 때는 이 파일만 고치면 됩니다.
 * 영역 id 는 학습 기록에 저장되므로, 이미 쌓인 기록이 있으면 id 는 그대로 두고 이름만 바꾸십시오.
 */
(function (root) {
  'use strict';

  // 기획서 3장 · 제출 원문 ① 의 10개 영역 (제출자 정의, 순서 그대로)
  var AREAS = [
    { id: 1, name: '연소·폭발공학' },
    { id: 2, name: '방폭공학' },
    { id: 3, name: '기초역학' },
    { id: 4, name: '연소기기 및 가스용품' },
    { id: 5, name: '고압가스' },
    { id: 6, name: 'LPG 설비' },
    { id: 7, name: '도시가스' },
    { id: 8, name: '수소안전' },
    { id: 9, name: '가스용기' },
    { id: 10, name: '저장탱크' }
  ];

  // 제출 원문 「AI 역할 구성」의 4개 관점. criteria 는 평가 프롬프트에 그대로 들어갑니다.
  var ROLES = [
    {
      key: 'engineer', label: '가스기술사', focus: '현장 실무 및 기술사 관점',
      criteria: ['현장 설비·운전에 그대로 적용할 수 있는가', '대책이 구체적이고 실행 가능한가', '관련 법규·기준을 적용해야 할 곳에서 빠뜨리지 않았는가']
    },
    {
      key: 'doctor', label: '공학박사', focus: '이론·공학적 근거 검토',
      criteria: ['원리·메커니즘 설명이 정확한가', '용어·수식·단위가 바르게 쓰였는가', '주장마다 공학적 근거가 있는가']
    },
    {
      key: 'grader', label: '채점위원', focus: '시험 답안의 구성·채점 관점 검토',
      criteria: ['서론-본론-결론 구성이 갖춰졌는가', '문제가 요구한 항목을 빠짐없이 다뤘는가', '핵심 키워드·도식·표를 활용해 채점자가 읽기 쉬운가']
    },
    {
      key: 'reporter', label: '전문기자', focus: '사고·산업동향·신기술 정보 관점 검토',
      criteria: ['관련 사고 교훈이나 산업 동향과 연결했는가', '최신 기술·제도 변화를 반영했는가', '실무자에게 주는 시사점이 있는가']
    }
  ];
  var SUMMARY_LABEL = '종합의견';

  // 사고 카드 5항목 (제출 원문 ② 순서 그대로)
  var ACCIDENT_FIELDS = [
    { key: 'overview', label: '사고 개요' },
    { key: 'cause', label: '사고 원인' },
    { key: 'mechanism', label: '사고발생 메커니즘' },
    { key: 'prevention', label: '재발방지대책' },
    { key: 'opinion', label: '가스기술사 종합의견' }
  ];
  // 기술 카드 — 2026-09-29 오후 요청으로 「제목 + 내용」 두 칸과 목차로 바꿨습니다.
  // 목차 이름은 제출자가 적은 그대로(원문의 「연소폭팔공학」 오타만 「연소폭발공학」으로 바로잡음).
  // 앞의 10개는 출제 영역 1~10 과 순서가 같습니다.
  var TECH_TOC = ['연소폭발공학', '방폭공학', '기초역학', '연소기기 및 가스용품', '고압가스',
    'LPG설비', '도시가스', '수소안전', '가스용기', '저장탱크', '기타'];
  // 예전(1차) 기술 카드 6항목 — 옛 데이터·엑셀을 「내용」 한 칸으로 옮길 때만 씁니다
  var TECH_FIELDS = [
    { key: 'definition', label: '기술 정의' },
    { key: 'problem', label: '기존 기술의 문제점' },
    { key: 'core', label: '핵심 기술' },
    { key: 'application', label: '적용 분야' },
    { key: 'outlook', label: '향후 발전방향' }
  ];
  // 제출 원문 ③ 의 대상 분야 예시 7개 + 기타
  var TECH_CATEGORIES = ['수소 저장·운송', '가스누출 감지', '스마트 가스안전관리', 'AI 기반 이상감지',
    '방폭', '고압가스 저장', '도시가스 안전', '기타'];
  var ACCIDENT_TYPES = ['누출', '화재', '폭발', '기타'];

  // 가스기술사 답안 채점 기준 (2026-09-29 추가 요청 — 평가·모범답안 통합 프롬프트에 그대로 들어갑니다)
  var GRADING_GUIDE = [
    '구성: 서론(정의·개요) - 본론(번호 붙인 항목) - 결론(실무 시사점·의견) 세 부분이 갖춰졌는가',
    '핵심 키워드: 문제가 요구한 핵심 용어·원리·기준을 빠짐없이 쓰고 눈에 띄게 드러냈는가',
    '도해: 계통도·그래프·표 같은 그림 설명을 넣어 채점자가 한눈에 보게 했는가 (글자로 그린 도식도 인정)',
    '분량: 답안지 기준 A4 1~2쪽(대략 1,000~2,500자)에 맞는가 — 너무 짧거나 길면 감점'
  ];

  // 「자동 모드」 — 사용자가 본인 OpenAI API 키를 넣으면 브라우저에서 직접 호출합니다.
  // 키는 이 브라우저(localStorage)에만 저장하고 코드·리포에는 넣지 않습니다(공개 리포).
  var AI = {
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4.1'],
    defaultModel: 'gpt-4o-mini'
  };

  // 사고 카드 「가스사고 기사」 — GitHub Actions 가 매일 받는 공개 RSS 검색어
  var NEWS = {
    queries: ['가스사고', '가스폭발', '가스누출'],
    jsonPath: 'data/news.json',
    pagesUrl: 'https://aebonlee.github.io/data09-02/',
    keepDays: 365,  // 이보다 오래된 기사는 목록에서 뺍니다
    maxItems: 500
  };

  var api = {
    GRADING_GUIDE: GRADING_GUIDE, AI: AI, NEWS: NEWS,
    AREAS: AREAS, ROLES: ROLES, SUMMARY_LABEL: SUMMARY_LABEL,
    ACCIDENT_FIELDS: ACCIDENT_FIELDS, TECH_FIELDS: TECH_FIELDS, TECH_TOC: TECH_TOC,
    TECH_CATEGORIES: TECH_CATEGORIES, ACCIDENT_TYPES: ACCIDENT_TYPES,
    HISTORY_IN_PROMPT: 20, // 출제 프롬프트에 영역별로 넣을 최근 문제 수
    SIMILAR_THRESHOLD: 0.8 // 이전 문제와 이만큼 비슷하면 중복 경고
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GTConfig = api;
})(typeof window !== 'undefined' ? window : this);
