const STORE = {
  name: "찬팩토리",
  smsNumber: "01000000000",
  minimumOrder: 25000,
  deliveryFee: 1000,
  orderClose: "18:30",
  // 운영 전 확정: 주문 문자 보관 기간 (privacy.html과 같게)
  privacyRetention: "3개월",
};

// 테스트 데이터: 기본 배달 지역과 추가배달료 단지. 운영 전 실제 지역으로 교체한다.
const DELIVERY_AREAS = ["운정", "와동동", "목동동", "야당동", "동패동", "당하동", "교하", "다율동"];
const EXTRA_FEE_ZONES = [
  { name: "초롱꽃마을", keywords: ["초롱꽃마을"], extra: 1000 },
  { name: "책향기마을", keywords: ["책향기마을", "물향기마을"], extra: 1000 },
  { name: "다율동", keywords: ["다율동"], extra: 1000 },
  { name: "별하람마을", keywords: ["별하람마을"], extra: 1000 },
];
const BLOCKED_AREAS = ["문발동"];

// 테스트용: 링크에 ?to=01012345678 을 붙이면 주문 문자를 그 번호로 보낸다.
const testNumber = new URLSearchParams(location.search).get("to")?.replace(/\D/g, "");
if (testNumber && /^01\d{8,9}$/.test(testNumber)) STORE.smsNumber = testNumber;

const CART_KEY = "chan-factory-cart";
const FORM_KEY = "chan-factory-form";

const state = {
  menu: [],
  categories: [],
  cart: new Map(readJson(CART_KEY, [])),
  query: "",
  activeCategory: null,
  mode: "delivery",
  delivery: null,
  orderCode: null,
};

const $ = (selector) => document.querySelector(selector);
const money = (value) => `${value.toLocaleString("ko-KR")}원`;
const formatPhone = (digits) => digits.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3");
const isPickup = () => state.mode === "pickup";

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경은 무시 */ }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const ICON_PLUS = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>';
const ICON_BLOCK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="m4.7 15.3 10.6-10.6" /></svg>';

/* ---------- 데이터 ---------- */

async function loadMenu() {
  const response = await fetch("./menu.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`menu ${response.status}`);
  const data = await response.json();
  state.menu = data.items;
  state.categories = data.categories ?? [...new Set(data.items.map((item) => item.category))].map((name) => ({ name }));
}

function normalizeCart() {
  const next = new Map();
  state.menu.forEach((item) => {
    const quantity = Number(state.cart.get(item.id) ?? state.cart.get(String(item.id)) ?? 0);
    if (quantity > 0 && item.stock > 0) next.set(item.id, Math.min(quantity, item.stock));
  });
  state.cart = next;
  saveCart();
}

function saveCart() { writeJson(CART_KEY, [...state.cart.entries()]); }

function getQuantity(id) { return state.cart.get(id) || 0; }

function setQuantity(id, quantity) {
  const item = state.menu.find((entry) => entry.id === id);
  if (!item || item.stock === 0) return;
  if (quantity > item.stock) showToast(`오늘은 ${item.stock}개까지 주문할 수 있어요.`);
  const next = Math.max(0, Math.min(quantity, item.stock));
  if (next === 0) state.cart.delete(id);
  else state.cart.set(id, next);
  saveCart();
  renderMenu();
  renderCart();
}

/* ---------- 메뉴 ---------- */

const sectionId = (name) => `cat-${state.categories.findIndex((category) => category.name === name)}`;

function renderFilters() {
  $("#categoryFilters").replaceChildren(...state.categories.map(({ name }) => {
    const button = el("button", "chip", name);
    button.type = "button";
    button.dataset.category = name;
    button.addEventListener("click", () => {
      closeSearch();
      document.getElementById(sectionId(name))?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveChip(name);
    });
    return button;
  }));
}

function setActiveChip(name) {
  if (state.activeCategory === name) return;
  state.activeCategory = name;
  document.querySelectorAll(".chip").forEach((chip) => {
    const active = chip.dataset.category === name;
    chip.classList.toggle("is-active", active);
    if (active) chip.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  });
}

function priceLine(item) {
  const price = el("p", "dish__price");
  if (item.unit) price.append(el("small", "", `${item.unit} : `));
  price.append(money(item.price));
  return price;
}

function dishRow(item) {
  const quantity = getQuantity(item.id);
  const soldOut = item.stock === 0;
  const row = el("article", "dish");
  row.classList.toggle("is-selected", quantity > 0);
  row.classList.toggle("is-soldout", soldOut);

  const body = el("div", "dish__body");
  if (item.tag) body.append(el("span", "dish__tag", item.tag));
  body.append(el("h3", "dish__name", item.name));
  if (soldOut) {
    const label = el("p", "dish__soldout");
    label.innerHTML = ICON_BLOCK;
    label.append("품절됐어요");
    body.append(label);
  } else if (item.description) {
    body.append(el("p", "dish__desc", item.description));
  }
  body.append(priceLine(item));
  if (!soldOut && item.stock <= 3) body.append(el("p", "dish__stock", `오늘 ${item.stock}개 남았어요`));

  const side = el("div", "dish__side");
  if (item.image) {
    side.classList.add("dish__side--thumb");
    const img = el("img", "dish__thumb");
    img.src = item.image;
    img.alt = "";
    img.loading = "lazy";
    side.append(img);
  }
  if (!soldOut) {
    const ctrl = el("div", "dish__ctrl");
    if (quantity === 0) {
      const add = el("button", "add-btn");
      add.type = "button";
      add.setAttribute("aria-label", `${item.name} 담기`);
      add.innerHTML = ICON_PLUS;
      add.addEventListener("click", () => setQuantity(item.id, 1));
      ctrl.append(add);
    } else {
      ctrl.append(stepper(item, quantity));
    }
    side.append(ctrl);
  }
  row.append(body, side);
  return row;
}

function stepper(item, quantity) {
  const wrap = el("div", "stepper");
  const minus = el("button", "stepper__btn", "−");
  const value = el("output", "stepper__value", String(quantity));
  const plus = el("button", "stepper__btn", "+");
  minus.type = plus.type = "button";
  minus.setAttribute("aria-label", `${item.name} 수량 줄이기`);
  plus.setAttribute("aria-label", `${item.name} 수량 늘리기`);
  plus.disabled = quantity >= item.stock;
  minus.addEventListener("click", () => setQuantity(item.id, quantity - 1));
  plus.addEventListener("click", () => setQuantity(item.id, quantity + 1));
  wrap.append(minus, value, plus);
  return wrap;
}

function renderMenu() {
  const query = state.query;
  const sections = state.categories.map(({ name, description }) => {
    const items = state.menu
      .filter((item) => item.category === name)
      .filter((item) => !query || `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query));
    if (items.length === 0) return null;
    const section = el("section", "menu-group");
    section.id = sectionId(name);
    section.dataset.category = name;
    section.append(el("h2", "menu-group__title", name));
    if (description && !query) section.append(el("p", "menu-group__desc", description));
    section.append(...items.map(dishRow));
    return section;
  }).filter(Boolean);
  $("#menuList").replaceChildren(...sections);
  $("#emptyMenu").hidden = sections.length > 0 || state.menu.length === 0;
  observeSections();
}

let sectionObserver;
function observeSections() {
  sectionObserver?.disconnect();
  sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) setActiveChip(visible.target.dataset.category);
  }, { rootMargin: "-130px 0px -60% 0px" });
  document.querySelectorAll(".menu-group").forEach((section) => sectionObserver.observe(section));
}

function openSearch() {
  $("#searchBox").hidden = false;
  $("#tabsRow").hidden = true;
  $("#tabs").scrollIntoView({ block: "start" });
  $("#menuSearch").focus();
}

function closeSearch() {
  if ($("#searchBox").hidden) return;
  $("#menuSearch").value = "";
  state.query = "";
  $("#searchBox").hidden = true;
  $("#tabsRow").hidden = false;
  renderMenu();
}

/* ---------- 장바구니 / 주문서 ---------- */

function cartDetails() {
  return state.menu.map((item) => ({ item, quantity: getQuantity(item.id) })).filter(({ quantity }) => quantity > 0);
}

function totals() {
  const subtotal = cartDetails().reduce((sum, { item, quantity }) => sum + item.price * quantity, 0);
  const deliveryFee = isPickup() ? 0 : state.delivery?.fee ?? 0;
  return { subtotal, deliveryFee, grandTotal: subtotal + deliveryFee };
}

function renderCart() {
  const details = cartDetails();
  const count = details.reduce((sum, entry) => sum + entry.quantity, 0);
  const { subtotal, deliveryFee, grandTotal } = totals();
  const remaining = Math.max(0, STORE.minimumOrder - subtotal);

  $("#cartCount").textContent = count;
  $("#cartTotalCompact").textContent = money(subtotal);
  $("#cartToggle").classList.toggle("is-disabled", count === 0);
  const hint = $("#minimumNotice");
  if (subtotal === 0) hint.textContent = `최소주문 ${money(STORE.minimumOrder)}`;
  else if (remaining > 0) hint.innerHTML = `<b>${money(remaining)}</b> 더 담으면 주문할 수 있어요`;
  else hint.textContent = "최소주문 금액을 채웠어요";

  $("#sheetCount").textContent = count;
  $("#subtotal").textContent = money(subtotal);
  $("#deliveryFee").textContent = state.delivery ? money(deliveryFee) : "주소 확인 필요";
  $("#grandTotal").textContent = money(grandTotal);
  $("#cartEmpty").hidden = details.length > 0;
  $("#cartItems").replaceChildren(...details.map(({ item, quantity }) => {
    const line = el("li", "cart-line");
    const info = el("div", "cart-line__info");
    info.append(el("strong", "", item.unit ? `${item.name} (${item.unit})` : item.name), el("span", "", money(item.price * quantity)));
    line.append(info, stepper(item, quantity));
    return line;
  }));
  renderPreview();
}

function renderPreview() {
  $("#smsPreview").textContent = buildOrderText();
}

/* ---------- 배달 / 픽업 ---------- */

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-delivery-only]").forEach((node) => { node.hidden = isPickup(); });
  document.querySelectorAll("[data-pickup-only]").forEach((node) => { node.hidden = !isPickup(); });
  $("#timeLabel").textContent = isPickup() ? "찾으러 갈 시간" : "받는 시간";
  saveForm();
  renderDelivery();
}

function checkDelivery(address) {
  const compact = address.replace(/\s+/g, "");
  if (BLOCKED_AREAS.some((area) => compact.includes(area))) return { blocked: true };
  const extraZone = EXTRA_FEE_ZONES.find((zone) => zone.keywords.some((keyword) => compact.includes(keyword)));
  if (extraZone) return { name: `${extraZone.name} · 추가배달료 ${money(extraZone.extra)}`, fee: STORE.deliveryFee + extraZone.extra };
  if (DELIVERY_AREAS.some((area) => compact.includes(area))) return { name: "기본 배달 지역", fee: STORE.deliveryFee };
  return null;
}

function fullAddress() {
  if (!state.delivery) return "";
  return [state.delivery.address, $("#addressDetail").value.trim()].filter(Boolean).join(" ");
}

// matchText: 주소 검색 결과의 법정동·건물명처럼 판정에만 쓰는 추가 문자열
function updateDelivery(address, { silent = false, matchText = "" } = {}) {
  const error = $("#deliveryError");
  if (!address.trim()) {
    error.textContent = "주소를 입력해 주세요.";
    error.hidden = false;
    return;
  }
  const zone = checkDelivery(`${address} ${matchText}`);
  if (!zone || zone.blocked) {
    state.delivery = null;
    error.textContent = zone?.blocked
      ? "죄송해요, 이 지역은 배달이 어려워요. 픽업으로 주문해 주세요."
      : "배달 지역을 찾지 못했어요. 단지명이나 동 이름을 넣어 주시거나 매장으로 문의해 주세요.";
    error.hidden = false;
    renderDelivery();
    return;
  }
  error.hidden = true;
  state.delivery = { ...zone, address: address.trim(), matchText };
  saveForm();
  renderDelivery();
  if (!silent) {
    showToast(`배달 가능해요 · 배달팁 ${money(zone.fee)}`);
    $("#addressDetail").focus();
  }
}

function renderDelivery() {
  const done = Boolean(state.delivery);
  $("#addressEdit").hidden = done;
  $("#addressDone").hidden = !done;
  if (done) {
    $("#addressText").textContent = state.delivery.address;
    $("#zoneName").textContent = `${state.delivery.name} · 배달팁 ${money(state.delivery.fee)}`;
  }
  $("#feeText").textContent = done ? money(state.delivery.fee) : `${money(STORE.deliveryFee)}~`;
  $("#sheetModeTitle").textContent = isPickup() ? "픽업" : "배달 주소";
  document.querySelector("[data-goto-address]").hidden = isPickup();
  const address = $("#sheetAddress");
  address.textContent = isPickup() ? "매장에서 직접 받아가요." : done ? fullAddress() : "배달 주소를 먼저 확인해 주세요.";
  address.classList.toggle("is-missing", !isPickup() && !done);
  renderCart();
}

function editAddress() {
  $("#addressEdit").hidden = false;
  $("#addressDone").hidden = true;
}

/* ---------- 주소 검색 (카카오 우편번호 서비스) ---------- */

// 손님이 검색을 누를 때만 불러온다. 첫 주소가 막히면 예전 주소로 한 번 더 시도한다.
const POSTCODE_SCRIPTS = [
  "https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js",
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js",
];
let postcodeReady;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => { script.remove(); reject(new Error(src)); };
    document.head.append(script);
  });
}

function loadPostcode() {
  postcodeReady ??= POSTCODE_SCRIPTS.reduce(
    (attempt, src) => attempt.catch(() => loadScript(src).then(() => { if (!window.daum?.Postcode) throw new Error("no postcode"); })),
    Promise.reject(),
  ).catch((error) => { postcodeReady = null; throw error; });
  return postcodeReady;
}

async function openPostcode() {
  const layer = $("#postcodeLayer");
  const frame = $("#postcodeFrame");
  layer.hidden = false;
  $("#postcodeError").hidden = true;
  document.body.classList.add("is-locked");
  try {
    await loadPostcode();
  } catch {
    $("#postcodeError").hidden = false;
    return;
  }
  frame.replaceChildren();
  new window.daum.Postcode({
    width: "100%",
    height: "100%",
    animation: false,
    oncomplete: (data) => {
      closePostcode();
      applyPostcode(data);
    },
  }).embed(frame, { autoClose: false });
}

function closePostcode() {
  $("#postcodeLayer").hidden = true;
  document.body.classList.remove("is-locked");
}

function applyPostcode(data) {
  const base = data.userSelectedType === "J" ? data.jibunAddress || data.autoJibunAddress : data.roadAddress || data.autoRoadAddress;
  const building = data.buildingName && !base.includes(data.buildingName) ? ` (${data.buildingName})` : "";
  const address = `${base}${building}`;
  $("#address").value = address;
  updateDelivery(address, { matchText: [data.bname, data.bname1, data.buildingName, data.jibunAddress, data.autoJibunAddress].filter(Boolean).join(" ") });
}

/* ---------- 주문 문자 ---------- */

function makeOrderCode() {
  const now = new Date();
  const mmdd = `${now.getMonth() + 1}`.padStart(2, "0") + `${now.getDate()}`.padStart(2, "0");
  return `${mmdd}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function buildOrderText() {
  const details = cartDetails();
  const { subtotal, deliveryFee, grandTotal } = totals();
  const time = document.querySelector('input[name="deliveryTime"]:checked')?.value || "가능한 빨리";
  const lines = details.map(({ item, quantity }) => `${item.name}${item.unit ? `(${item.unit})` : ""} x${quantity} ${money(item.price * quantity)}`);
  return [
    `[${STORE.name} 주문] #${state.orderCode}`,
    `수령: ${isPickup() ? "픽업" : "배달"}`,
    `이름: ${$("#customerName").value.trim() || "-"}`,
    ...(isPickup() ? [] : [`주소: ${fullAddress() || "-"}`]),
    `${isPickup() ? "픽업시간" : "받는시간"}: ${time}`,
    "--------",
    ...(lines.length ? lines : ["(담은 메뉴 없음)"]),
    "--------",
    isPickup() ? `메뉴 ${money(subtotal)}` : `메뉴 ${money(subtotal)} + 배달팁 ${money(deliveryFee)}`,
    `합계 ${money(grandTotal)}`,
    `요청: ${$("#requestNote").value.trim() || "없음"}`,
    "개인정보 수집·이용 안내 확인함",
  ].join("\n");
}

function validateOrder() {
  const { subtotal } = totals();
  if (!isPickup() && !state.delivery) return "배달 주소를 먼저 확인해 주세요.";
  if (cartDetails().length === 0) return "주문할 메뉴를 담아 주세요.";
  if (subtotal < STORE.minimumOrder) return `메뉴 금액이 ${money(STORE.minimumOrder)} 이상이어야 주문할 수 있어요.`;
  if (!$("#customerName").value.trim()) return "주문하시는 분 이름을 입력해 주세요.";
  if (!$("#privacyAgree").checked) {
    $(".check").classList.add("is-invalid");
    $(".check").scrollIntoView({ behavior: "smooth", block: "center" });
    return "개인정보 수집·이용 안내를 확인해 주세요.";
  }
  return null;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}

function showSheetError(message) {
  const error = $("#sheetError");
  error.textContent = message;
  error.hidden = !message;
}

function smsHref(text) {
  const separator = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent) ? "&" : "?";
  return `sms:${STORE.smsNumber}${separator}body=${encodeURIComponent(text)}`;
}

/* ---------- 입력값 보존 ---------- */

function saveForm() {
  writeJson(FORM_KEY, {
    mode: state.mode,
    address: $("#address").value,
    matchText: state.delivery?.matchText ?? "",
    addressDetail: $("#addressDetail").value,
    customerName: $("#customerName").value,
    requestNote: $("#requestNote").value,
  });
}

function restoreForm() {
  const saved = readJson(FORM_KEY, {});
  ["address", "addressDetail", "customerName", "requestNote"].forEach((key) => {
    if (saved[key]) $(`#${key}`).value = saved[key];
  });
  if (saved.address) updateDelivery(saved.address, { silent: true, matchText: saved.matchText ?? "" });
  setMode(saved.mode === "pickup" ? "pickup" : "delivery");
}

/* ---------- 화면 전환 / 토스트 ---------- */

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function openSheet() {
  showSheetError("");
  renderPreview();
  $("#sheet").classList.add("is-open");
  $("#sheet").setAttribute("aria-hidden", "false");
  $("#cartToggle").setAttribute("aria-expanded", "true");
  document.body.classList.add("is-locked");
}

function closeSheet() {
  $("#sheet").classList.remove("is-open");
  $("#sheet").setAttribute("aria-hidden", "true");
  $("#cartToggle").setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-locked");
}

function showDone(show) {
  $("#doneView").hidden = !show;
  document.body.classList.toggle("is-locked", show);
}

/* ---------- 이벤트 ---------- */

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

$("#addressForm").addEventListener("submit", (event) => {
  event.preventDefault();
  updateDelivery($("#address").value);
});

document.querySelectorAll("[data-address]").forEach((button) => {
  button.addEventListener("click", () => {
    $("#address").value = button.dataset.address;
    updateDelivery(button.dataset.address);
  });
});

$("#addressChange").addEventListener("click", editAddress);
$("#privacyAgree").addEventListener("change", () => {
  $(".check").classList.remove("is-invalid");
  showSheetError("");
});
$("#postcodeOpen").addEventListener("click", openPostcode);
$("#postcodeClose").addEventListener("click", closePostcode);
$("#manualToggle").addEventListener("click", () => {
  $("#addressForm").hidden = false;
  $("#manualToggle").hidden = true;
  $("#address").focus();
});
document.querySelector("[data-goto-address]").addEventListener("click", () => {
  closeSheet();
  editAddress();
  $("#addressSection").scrollIntoView({ behavior: "smooth", block: "center" });
});
$("#addMore").addEventListener("click", closeSheet);

["addressDetail", "customerName", "requestNote"].forEach((id) => {
  $(`#${id}`).addEventListener("input", () => {
    saveForm();
    if (id === "addressDetail" && state.delivery) renderDelivery();
    else renderPreview();
  });
});
document.querySelectorAll('input[name="deliveryTime"]').forEach((input) => input.addEventListener("change", renderPreview));

$("#searchToggle").addEventListener("click", openSearch);
$("#searchClose").addEventListener("click", closeSearch);
$("#menuSearch").addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  renderMenu();
});

$("#cartToggle").addEventListener("click", () => {
  if (cartDetails().length === 0) return showToast("메뉴를 먼저 담아 주세요.");
  openSheet();
});
$("#sheetClose").addEventListener("click", closeSheet);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!$("#postcodeLayer").hidden) closePostcode();
  else if (!$("#doneView").hidden) showDone(false);
  else closeSheet();
});

$("#copyOrder").addEventListener("click", async () => {
  const error = validateOrder();
  showSheetError(error || "");
  if (error) return;
  try {
    await copyText(buildOrderText());
    showToast(`복사했어요. ${formatPhone(STORE.smsNumber)}로 붙여넣어 보내주세요.`);
  } catch {
    $("details.preview").open = true;
    showToast("자동 복사가 막혀 있어요. 미리보기 글을 길게 눌러 복사해 주세요.");
  }
});

$("#sendSms").addEventListener("click", async () => {
  const error = validateOrder();
  showSheetError(error || "");
  if (error) return;
  const text = buildOrderText();
  try { await copyText(text); } catch { /* 문자 앱 이동은 계속 진행 */ }
  closeSheet();
  showDone(true);
  window.location.href = smsHref(text);
});

$("#doneCopy").addEventListener("click", async () => {
  try {
    await copyText(buildOrderText());
    showToast("주문 내용을 다시 복사했어요.");
  } catch {
    showToast("복사하지 못했어요. 주문서의 미리보기를 이용해 주세요.");
  }
});
$("#doneClose").addEventListener("click", () => {
  showDone(false);
  openSheet();
});

const storeName = $(".store__name");
new IntersectionObserver(([entry]) => {
  $("#appbar").classList.toggle("is-scrolled", !entry.isIntersecting);
}, { rootMargin: "-56px 0px 0px 0px" }).observe(storeName);

/* ---------- 시작 ---------- */

function initHeader() {
  const now = new Date();
  const [hour, minute] = STORE.orderClose.split(":").map(Number);
  const closed = now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
  $("#openStatus").textContent = closed ? `오늘 주문 마감 (${STORE.orderClose})` : `오늘 ${STORE.orderClose} 주문 마감`;
  $("#openStatus").classList.toggle("is-closed", closed);
  $("#minOrderText").textContent = money(STORE.minimumOrder);
  document.querySelectorAll("[data-retention]").forEach((node) => { node.textContent = STORE.privacyRetention; });
  $("#doneNumber").textContent = formatPhone(STORE.smsNumber);
  $("#doneNumber").href = `sms:${STORE.smsNumber}`;
}

async function init() {
  state.orderCode = makeOrderCode();
  initHeader();
  try {
    await loadMenu();
  } catch {
    $("#menuLoadError").hidden = false;
  }
  normalizeCart();
  renderFilters();
  renderMenu();
  restoreForm();
}

init();
