/* ──────────────────────────────────────────────────────────────
   공간:결 다국어(i18n) 엔진
   - UI 텍스트만 번역 (물품 이름은 AI 인식 원본 유지)
   - 지원 언어: 한국어(ko) · 영어(en)
   - 사용법:
       1) HTML 요소에  data-i18n="키"           → 텍스트 내용 번역
                       data-i18n-ph="키"        → placeholder 번역
                       data-i18n-title="키"     → title 속성 번역
       2) JS에서 문구가 필요하면  t('키')  호출
   - 언어는 localStorage('gyeol_lang')에 저장되어 모든 페이지에서 유지됨
   ────────────────────────────────────────────────────────────── */
(function (global) {
  "use strict";

  var SUPPORTED = ["ko", "en"];
  var DEFAULT_LANG = "ko";
  var STORE_KEY = "gyeol_lang";

  // ── 번역 사전 ──────────────────────────────────────────────
  // 키는 의미 기반(snake_case). 새 문구가 생기면 4개 언어 모두 추가.
  var DICT = {
    ko: {
      // 공통
      brand: "공간:결",
      confirm: "확인",
      close: "닫기",
      save: "저장",
      cancel: "취소",
      loading: "불러오는 중…",
      next: "다음 →",
      prev: "← 이전",
      detail_view: "자세히 보기",

      // 마이페이지 - 헤더/프로필
      mypage_title: "마이페이지",
      help_guide: "사용 안내",
      member_badge: "공간:결 멤버",
      edit_nickname: "닉네임 변경",
      logout: "로그아웃",

      // 보관함 현황 / 이용권
      storage_status: "보관함 현황",
      usage_title: "물품 인식 사용량",
      unit_count: "건",
      used_label: "사용",
      remain_label: "잔여",
      charge_btn: "+ 이용권 충전하기",
      charge_modal_title: "이용권 충전",
      charge_popular: "가장 인기",
      charge_soon: "결제 기능은 곧 오픈 예정이에요. 조금만 기다려주세요!",

      // 표시 설정
      display_settings: "표시 설정",
      dark_mode: "다크 모드",
      dark_mode_sub: "어두운 배경으로 전환",
      font_size: "글씨 크기",
      language: "언어",
      language_sub: "메뉴·버튼 표시 언어를 선택하세요",

      // 보관함 관리
      storage_manage: "보관함 관리",
      add_serial: "시리얼 번호 추가 등록",

      // 구성원
      member_manage: "구성원 관리",
      invite_create: "구성원 초대 코드 생성",
      invite_code: "초대 코드",
      invite_copy: "초대 링크 복사",

      // 등록 정보
      reg_info: "등록 정보",
      reg_verified: "정품 인증",

      // 계정
      account_delete: "계정 삭제",
      account_delete_confirm: "내 계정 삭제",

      // 수납장(drawer)
      search_ph: "물품 검색...",
      analyzing: "물품 분석 중...",
      uploading: "업로드 중...",
      frame_extract: "프레임 추출 중...",
      empty_title: "아직 등록된 물품이 없어요",
      empty_sub: "사진을 올리면 AI가 자동으로 목록을 채워드려요",
      empty_cta: "사진으로 시작하기",
      search_empty_sub: "다른 이름으로 찾아보시거나 직접 추가해 보세요",
      search_no_result: "검색 결과가 없어요",
      search_title: "무엇을 찾으시나요?",
      search_desc: "물건 이름을 입력하면 위치를 알려드려요",
      search_main_ph: "물건 이름으로 검색",
      go: "이동",
      chat_consult: "채팅상담",
      media_add: "사진·영상 탭하여 등록",
      media_add_sub: "물품 자동 인식"
    },

    en: {
      brand: "Gyeol",
      confirm: "OK",
      close: "Close",
      save: "Save",
      cancel: "Cancel",
      loading: "Loading…",
      next: "Next →",
      prev: "← Back",
      detail_view: "Details",

      mypage_title: "My Page",
      help_guide: "Help",
      member_badge: "Gyeol Member",
      edit_nickname: "Edit name",
      logout: "Log out",

      storage_status: "Storage status",
      usage_title: "AI scans used",
      unit_count: "",
      used_label: "Used",
      remain_label: "Left",
      charge_btn: "+ Add scan credits",
      charge_modal_title: "Add credits",
      charge_popular: "Most popular",
      charge_soon: "Payments are coming soon. Hang tight!",

      display_settings: "Display",
      dark_mode: "Dark mode",
      dark_mode_sub: "Switch to a dark background",
      font_size: "Text size",
      language: "Language",
      language_sub: "Choose the menu & button language",

      storage_manage: "Storage",
      add_serial: "Register a serial number",

      member_manage: "Members",
      invite_create: "Create invite code",
      invite_code: "Invite code",
      invite_copy: "Copy invite link",

      reg_info: "Registration",
      reg_verified: "Verified",

      account_delete: "Delete account",
      account_delete_confirm: "Delete my account",

      search_ph: "Search items...",
      analyzing: "Analyzing items...",
      uploading: "Uploading...",
      frame_extract: "Extracting frames...",
      empty_title: "No items yet",
      empty_sub: "Upload a photo and AI fills the list for you",
      empty_cta: "Start with a photo",
      search_empty_sub: "Try another name, or add it manually",
      search_no_result: "no results found",
      search_title: "What are you looking for?",
      search_desc: "Type an item name and we'll tell you where it is",
      search_main_ph: "Search by item name",
      go: "Go",
      chat_consult: "Chat",
      media_add: "Tap to add a photo or video",
      media_add_sub: "Automatic item recognition"
    },


  };

  // ── 현재 언어 ──────────────────────────────────────────────
  function getLang() {
    var v = null;
    try { v = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (v && SUPPORTED.indexOf(v) !== -1) return v;
    // 저장값이 없으면 항상 한국어로 시작 (외국인은 설정에서 직접 변경)
    return DEFAULT_LANG;
  }

  function setLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) lang = DEFAULT_LANG;
    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
    apply(lang);
  }

  // ── 키 → 번역 문구 ─────────────────────────────────────────
  function t(key, lang) {
    lang = lang || getLang();
    var table = DICT[lang] || DICT[DEFAULT_LANG];
    if (table[key] != null) return table[key];
    // 폴백: 한국어 → 키 자체
    if (DICT[DEFAULT_LANG][key] != null) return DICT[DEFAULT_LANG][key];
    return key;
  }

  // ── DOM 전체에 번역 적용 ───────────────────────────────────
  function apply(lang) {
    lang = lang || getLang();

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var val = t(key, lang);
      if (val !== "" || el.getAttribute("data-i18n-allowempty") === "1") {
        el.textContent = val;
      }
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"), lang));
    });
    document.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title"), lang));
    });

    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("data-lang", lang);

    // 다른 스크립트가 후속 처리할 수 있도록 이벤트 발행
    try {
      global.dispatchEvent(new CustomEvent("gyeol:langchange", { detail: { lang: lang } }));
    } catch (e) {}
  }

  // ── 자동 초기 적용 ─────────────────────────────────────────
  function init() { apply(getLang()); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ── 외부 노출 ──────────────────────────────────────────────
  global.I18N = {
    SUPPORTED: SUPPORTED,
    getLang: getLang,
    setLang: setLang,
    apply: apply,
    t: t
  };
  global.t = t; // 짧은 별칭
})(window);
