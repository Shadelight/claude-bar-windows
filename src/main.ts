import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";

// ----- Types (match backend, camelCase) -----
interface LimitWindow {
  utilization: number;
  resetsAt: string | null;
  resetsInLabel: string;
}
interface ExtraUsage {
  usedUsd: number;
  limitUsd: number;
  utilization: number;
}
interface UsageSnapshot {
  connected: boolean;
  plan: string;
  fiveHour: LimitWindow;
  sevenDay: LimitWindow;
  sevenDaySonnet: LimitWindow | null;
  extraUsage: ExtraUsage;
  stale: boolean;
  error: string | null;
  updatedAt: string;
}
interface CostReport {
  todayUsd: number;
  todayTokens: number;
  weekUsd: number;
  monthUsd: number;
  last30Usd: number;
  last30Tokens: number;
  updatedAt: string;
  empty: boolean;
}

// ----- i18n -----
type Dict = Record<string, string>;
const I18N: Record<string, Dict> = {
  es: {
    session: "Sesión", weekly: "Semanal", extra: "Uso extra", cost: "Costo",
    session5h: "(límite 5h)", weekly7d: "(límite 7 días)", weeklyShort: "(semanal)",
    apiEq: "(equivalente API)", today: "Hoy", thisWeek: "Esta semana", last30: "Últimos 30 días",
    plan: "Plan", rateLimitTier: "Nivel de límite", notifications: "Notificaciones",
    settings: "Ajustes", openLogs: "Abrir carpeta de logs", compactMode: "Modo compacto", quit: "Cerrar",
    refresh: "Actualizar ahora", resetsIn: "Reinicia en", used: "usado", enabled: "Activado", off: "Desactivado",
    pace: "Ritmo", behind: "Por debajo", ahead: "Por encima", onpace: "En ritmo",
    costNote: "≈ valor equivalente en API · tu plan lo cubre",
    lastUpdated: "Actualizado", updatedShort: "Act.", ago: "hace", updatedJust: "recién",
    connect: "Conecta Claude Code para ver tu uso",
    aboutTitle: "Acerca de Claude Bar", settingsTitle: "Ajustes",
    today2: "Hoy",
  },
  en: {
    session: "Session", weekly: "Weekly", extra: "Extra usage", cost: "Cost",
    session5h: "(5h limit)", weekly7d: "(7-day limit)", weeklyShort: "(weekly)",
    apiEq: "(API equivalent)", today: "Today", thisWeek: "This week", last30: "Last 30 days",
    plan: "Plan", rateLimitTier: "Rate limit tier", notifications: "Notifications",
    settings: "Settings", openLogs: "Open logs folder", compactMode: "Compact mode", quit: "Quit",
    refresh: "Refresh now", resetsIn: "Resets in", used: "used", enabled: "Enabled", off: "Off",
    pace: "Pace", behind: "Behind", ahead: "Ahead", onpace: "On track",
    costNote: "≈ API-equivalent value · covered by your plan",
    lastUpdated: "Updated", updatedShort: "Upd.", ago: "ago", updatedJust: "just now",
    connect: "Connect Claude Code to see your usage",
    aboutTitle: "About Claude Bar", settingsTitle: "Settings",
    today2: "Today",
  },
};
let lang = localStorage.getItem("lang") === "en" ? "en" : "es";
const t = (k: string) => I18N[lang][k] ?? k;

const $ = (id: string) => document.getElementById(id)!;
const appWindow = getCurrentWindow();
const FULL = { w: 900, h: 700 };
const COMPACT = { w: 640, h: 300 };

let lastUsage: UsageSnapshot | null = null;
let lastCost: CostReport | null = null;
let lastUpdatedIso = "";
let pinned = true;
let notifEnabled = localStorage.getItem("notif") !== "0";

// ----- Format -----
function fmtUsd(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtPct(n: number): string {
  return (n < 10 ? n.toFixed(n < 1 ? 1 : 0) : Math.round(n).toString()) + "%";
}
function fmtDur(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}
function fmtAbs(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(lang === "es" ? "es-ES" : "en-US", { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  const isTmr = d.toDateString() === tmr.toDateString();
  if (sameDay) return `${lang === "es" ? "Hoy" : "Today"}, ${time}`;
  if (isTmr) return `${lang === "es" ? "Mañana" : "Tomorrow"}, ${time}`;
  const date = d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}
function relTime(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const s = Math.floor(Math.max(0, Date.now() - then) / 1000);
  if (s < 8) return t("updatedJust");
  const val = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  return lang === "es" ? `${t("ago")} ${val}` : `${val} ${t("ago")}`;
}
function setBar(id: string, util: number) {
  ($(id) as HTMLElement).style.width = Math.max(0, Math.min(100, util)) + "%";
}
function weeklyPace(win: LimitWindow): string {
  if (!win.resetsAt) return "";
  const end = new Date(win.resetsAt).getTime();
  if (isNaN(end)) return "";
  const windowMs = 7 * 24 * 3600 * 1000;
  const frac = Math.max(0, Math.min(1, (windowMs - (end - Date.now())) / windowMs));
  const delta = win.utilization - frac * 100;
  const sign = delta >= 0 ? "+" : "";
  const label = delta < -2 ? t("behind") : delta > 2 ? t("ahead") : t("onpace");
  return `${t("pace")}: ${label} (${sign}${delta.toFixed(0)}%)`;
}

// ----- Render usage -----
function applyUsage(u: UsageSnapshot) {
  lastUsage = u;
  const plan = u.connected ? u.plan : "—";
  $("plan-badge").textContent = plan;
  $("cv-plan").textContent = plan;
  $("plan-name").textContent = u.connected ? u.plan : "—";

  const updated = $("updated");
  const cvUpdated = $("cv-updated");
  if (!u.connected) {
    updated.textContent = t("connect");
    updated.classList.add("stale");
    cvUpdated.textContent = t("connect");
  } else if (u.error && u.stale) {
    updated.textContent = u.error;
    updated.classList.add("stale");
    cvUpdated.textContent = u.error;
  } else {
    lastUpdatedIso = u.updatedAt;
    updated.textContent = `${t("lastUpdated")} ${relTime(u.updatedAt)}`;
    updated.classList.remove("stale");
    cvUpdated.textContent = `${t("updatedShort")} ${relTime(u.updatedAt)}`;
  }

  // Session (5h window = 300 min)
  setBar("session-fill", u.fiveHour.utilization);
  $("session-pct").textContent = fmtPct(u.fiveHour.utilization);
  $("session-reset").textContent = u.fiveHour.resetsInLabel || "—";
  $("session-reset-abs").textContent = fmtAbs(u.fiveHour.resetsAt);
  $("session-detail").textContent =
    `${fmtDur((u.fiveHour.utilization / 100) * 300)} ${t("used")} / 5h 00m`;
  setBar("cv-session-fill", u.fiveHour.utilization);
  $("cv-session-pct").textContent = fmtPct(u.fiveHour.utilization);
  $("cv-session-reset").textContent = u.fiveHour.resetsInLabel || "";
  $("cv-session-detail").textContent =
    `${fmtDur((u.fiveHour.utilization / 100) * 300)} / 5h 00m`;

  // Weekly (7d)
  setBar("weekly-fill", u.sevenDay.utilization);
  $("weekly-pct").textContent = fmtPct(u.sevenDay.utilization);
  $("weekly-reset").textContent = u.sevenDay.resetsInLabel || "—";
  $("weekly-reset-abs").textContent = fmtAbs(u.sevenDay.resetsAt);
  $("weekly-detail").textContent = `${fmtPct(u.sevenDay.utilization)} ${t("used")}`;
  $("weekly-pace").textContent = weeklyPace(u.sevenDay);
  setBar("cv-weekly-fill", u.sevenDay.utilization);
  $("cv-weekly-pct").textContent = fmtPct(u.sevenDay.utilization);
  $("cv-weekly-reset").textContent = u.sevenDay.resetsInLabel || "";
  $("cv-weekly-detail").textContent = `${fmtPct(u.sevenDay.utilization)} ${t("used")}`;

  // Sonnet
  const sonnet = u.sevenDaySonnet;
  if (sonnet) {
    setBar("sonnet-fill", sonnet.utilization);
    $("sonnet-pct").textContent = fmtPct(sonnet.utilization);
    $("sonnet-reset").textContent = sonnet.resetsInLabel || "—";
    $("sonnet-reset-abs").textContent = fmtAbs(sonnet.resetsAt);
    $("sonnet-block").style.display = "";
  } else {
    $("sonnet-block").style.display = "none";
  }

  // Extra usage
  const ex = u.extraUsage;
  const enabled = ex.limitUsd > 0;
  setBar("extra-fill", ex.utilization);
  $("extra-amount").textContent = `${fmtUsd(ex.usedUsd)} / ${fmtUsd(ex.limitUsd)}`;
  $("extra-pct").textContent = enabled ? `${fmtPct(ex.utilization)} ${t("used")}` : "";
  const badge = $("extra-state");
  badge.textContent = enabled ? t("enabled") : t("off");
  badge.classList.toggle("badge-on", enabled);
}

function applyCost(c: CostReport) {
  lastCost = c;
  $("cost-today").textContent = fmtUsd(c.todayUsd);
  $("cost-week").textContent = fmtUsd(c.weekUsd);
  $("cost-30").textContent = fmtUsd(c.last30Usd);
  $("cost-note").textContent = t("costNote");
  $("cv-today").textContent = `${t("today2")} ${fmtUsd(c.todayUsd)}`;
}

// ----- Language -----
function applyLang() {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n || "");
  });
  document.querySelectorAll<HTMLElement>(".seg").forEach((el) => {
    el.classList.toggle("active",
      (el.dataset.act === "lang-en" && lang === "en") ||
      (el.dataset.act === "lang-es" && lang === "es"));
  });
  document.documentElement.lang = lang;
  if (lastUsage) applyUsage(lastUsage);
  if (lastCost) applyCost(lastCost);
}
function setLang(l: string) {
  lang = l === "en" ? "en" : "es";
  localStorage.setItem("lang", lang);
  applyLang();
}

// ----- Modal -----
function openModal(title: string, html: string) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal").classList.remove("hidden");
}
function closeModal() {
  $("modal").classList.add("hidden");
}
async function showSettings() {
  const v = await getVersion();
  const L = (es: string, en: string) => (lang === "es" ? es : en);
  const body = `
    <div class="row"><span>${L("Versión", "Version")}</span><span class="muted2">${v} · Rust + Tauri</span></div>
    <div class="row"><span>${L("Cuenta", "Account")}</span><span class="muted2">Claude Code (local)</span></div>
    <div class="row"><span>${L("Inicio con Windows", "Start with Windows")}</span><span class="muted2">${L("menú del icono", "tray menu")}</span></div>
    <div class="row"><span>${L("Refresco de uso", "Usage refresh")}</span><span class="muted2">5 min</span></div>
    <div class="row"><span>${L("Refresco de costo", "Cost refresh")}</span><span class="muted2">60 s</span></div>
    <p style="margin-top:12px">
      <a href="#" data-link="https://claude.ai/usage">${L("Panel de uso", "Usage dashboard")}</a> ·
      <a href="#" data-link="https://status.anthropic.com">${L("Estado del servicio", "Status page")}</a>
    </p>
    <p class="muted2" style="margin-top:8px">
      ${L("Fork de Claude Bar de Daybi · mantenido por Alberth Salazar.", "Fork of Daybi's Claude Bar · maintained by Alberth Salazar.")}
    </p>`;
  openModal(t("settingsTitle"), body);
  $("modal-body").querySelectorAll<HTMLAnchorElement>("a[data-link]").forEach((a) => {
    a.addEventListener("click", (e) => { e.preventDefault(); openUrl(a.dataset.link!); });
  });
}

// ----- Window / compact -----
function setSwitch(id: string, on: boolean) {
  $(id).classList.toggle("on", on);
}
async function setCompact(on: boolean) {
  document.body.classList.toggle("compact", on);
  setSwitch("compact-switch", on);
  if (on) {
    await appWindow.setSize(new LogicalSize(COMPACT.w, COMPACT.h));
    await appWindow.setPosition(new LogicalPosition(12, 12));
  } else {
    await appWindow.setSize(new LogicalSize(FULL.w, FULL.h));
  }
}
async function togglePin() {
  pinned = !pinned;
  await appWindow.setAlwaysOnTop(pinned);
  $("pin-btn").classList.toggle("active", pinned);
}
function toggleNotifications() {
  notifEnabled = !notifEnabled;
  localStorage.setItem("notif", notifEnabled ? "1" : "0");
  setSwitch("notif-toggle", notifEnabled);
  invoke("set_notifications", { enabled: notifEnabled }).catch(() => {});
}

async function handleAction(act: string) {
  switch (act) {
    case "minimize": await appWindow.hide(); break;
    case "compact": await setCompact(true); break;
    case "expand": await setCompact(false); break;
    case "pin": await togglePin(); break;
    case "refresh": await invoke("refresh_now"); break;
    case "notifications": toggleNotifications(); break;
    case "settings": await showSettings(); break;
    case "logs": await invoke("open_logs_folder").catch(() => {}); break;
    case "lang-en": setLang("en"); break;
    case "lang-es": setLang("es"); break;
    case "modal-close": closeModal(); break;
    case "quit": await invoke("quit"); break;
  }
}

// ----- Boot -----
async function main() {
  applyLang();
  $("pin-btn").classList.toggle("active", pinned);
  setSwitch("notif-toggle", notifEnabled);
  invoke("set_notifications", { enabled: notifEnabled }).catch(() => {});

  document.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
    btn.addEventListener("click", () => handleAction(btn.dataset.act || ""));
  });

  await listen<UsageSnapshot>("usage-updated", (e) => applyUsage(e.payload));
  await listen<CostReport>("cost-updated", (e) => applyCost(e.payload));

  try {
    applyUsage(await invoke<UsageSnapshot>("get_usage"));
    applyCost(await invoke<CostReport>("get_cost"));
  } catch (err) {
    console.error("initial state:", err);
  }

  let tries = 0;
  const catchUp = setInterval(async () => {
    tries++;
    try {
      const c = await invoke<CostReport>("get_cost");
      applyCost(c);
      applyUsage(await invoke<UsageSnapshot>("get_usage"));
      if (!c.empty || tries >= 12) clearInterval(catchUp);
    } catch { /* retry */ }
  }, 1500);

  setInterval(() => {
    if (lastUpdatedIso && !$("updated").classList.contains("stale")) {
      $("updated").textContent = `${t("lastUpdated")} ${relTime(lastUpdatedIso)}`;
      $("cv-updated").textContent = `${t("updatedShort")} ${relTime(lastUpdatedIso)}`;
    }
  }, 20_000);
}

main();
