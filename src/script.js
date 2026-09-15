"use strict";

/* ==========================================================================
   Data
   ========================================================================== */

const CURRENCIES = {
    USD: { name: "Dólar Americano", flag: "🇺🇸", symbol: "US$" },
    EUR: { name: "Euro", flag: "🇪🇺", symbol: "€" },
    BRL: { name: "Real Brasileiro", flag: "🇧🇷", symbol: "R$" },
    GBP: { name: "Libra Esterlina", flag: "🇬🇧", symbol: "£" },
    JPY: { name: "Iene Japonês", flag: "🇯🇵", symbol: "¥" },
    CAD: { name: "Dólar Canadense", flag: "🇨🇦", symbol: "C$" },
    AUD: { name: "Dólar Australiano", flag: "🇦🇺", symbol: "A$" },
    CHF: { name: "Franco Suíço", flag: "🇨🇭", symbol: "Fr" },
    CNY: { name: "Yuan Chinês", flag: "🇨🇳", symbol: "¥" },
    ARS: { name: "Peso Argentino", flag: "🇦🇷", symbol: "$" },
};

const API_URL = "https://api.exchangerate-api.com/v4/latest/";
const MARKET_PAIRS = ["USD", "EUR", "GBP", "JPY"];
const STORAGE_KEYS = {
    theme: "cc_theme",
    favorites: "cc_favorites",
    history: "cc_history",
    rateHistory: "cc_rate_history",
};

/* ==========================================================================
   Element references
   ========================================================================== */

const form = document.getElementById("converterForm");
const amountInput = document.getElementById("amount");
const fromCurrency = document.getElementById("fromCurrency");
const toCurrency = document.getElementById("toCurrency");
const fromFlag = document.getElementById("fromFlag");
const toFlag = document.getElementById("toFlag");
const fromName = document.getElementById("fromName");
const toName = document.getElementById("toName");
const fromSymbol = document.getElementById("fromSymbol");
const swapBtn = document.getElementById("swapBtn");

const loading = document.getElementById("loading");
const result = document.getElementById("result");
const errorBox = document.getElementById("error");
const convertBtn = document.getElementById("converterBtn");

const resultFrom = document.getElementById("resultFrom");
const resultTo = document.getElementById("resultTo");
const resultRate = document.getElementById("resultRate");
const resultUpdated = document.getElementById("resultUpdated");

const apiStatus = document.getElementById("apiStatus");
const themeToggle = document.getElementById("themeToggle");

const marketGrid = document.getElementById("marketGrid");
const statsGrid = document.getElementById("statsGrid");

const chartPairLabel = document.getElementById("chartPairLabel");
const rangeButtons = document.querySelectorAll(".range-btn");
const chartCanvas = document.getElementById("rateChart");

const quickCurrencySelect = document.getElementById("quickCurrency");
const quickGrid = document.getElementById("quickGrid");

const favoritesList = document.getElementById("favoritesList");

const historyList = document.getElementById("historyList");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const toastStack = document.getElementById("toastStack");

/* ==========================================================================
   State
   ========================================================================== */

let marketRatesBRL = null; // { USD: 0.185, EUR: ..., ... } — value of 1 unit of BRL in each currency
let lastConversion = null;
let rateChart = null;
let currentRange = 1;

/* ==========================================================================
   Utilities
   ========================================================================== */

function parseAmount(raw) {
    if (typeof raw !== "string") return NaN;
    const normalized = raw.trim().replace(/\./g, "").replace(",", ".");
    // If there was only one separator and it looked like a decimal point already, try plain parse too
    const plain = Number(raw.replace(",", "."));
    const value = Number(normalized);
    if (!Number.isNaN(plain) && raw.split(/[.,]/).length <= 2) return plain;
    return value;
}

function formatCurrency(value, code) {
    try {
        return new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: code,
            maximumFractionDigits: code === "JPY" ? 0 : 2,
        }).format(value);
    } catch {
        return `${CURRENCIES[code]?.symbol ?? code} ${value.toFixed(2)}`;
    }
}

function formatTime(date) {
    return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    toastStack.appendChild(toast);
    setTimeout(() => toast.remove(), 2800);
}

function safeGetJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

function safeSetJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* storage unavailable — fail silently */
    }
}

/* ==========================================================================
   Theme
   ========================================================================== */

function initTheme() {
    const saved = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
    applyTheme(saved);
}

function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme);
    themeToggle.setAttribute("aria-pressed", String(theme === "light"));
    themeToggle.setAttribute("aria-label", theme === "light" ? "Alternar para modo escuro" : "Alternar para modo claro");
    try {
        localStorage.setItem(STORAGE_KEYS.theme, theme);
    } catch { /* ignore */ }
}

themeToggle.addEventListener("click", () => {
    const current = document.body.getAttribute("data-theme");
    applyTheme(current === "light" ? "dark" : "light");
    if (rateChart) renderChart();
});

/* ==========================================================================
   Currency panel display (flag / name / symbol)
   ========================================================================== */

function updateCurrencyDisplay() {
    const from = CURRENCIES[fromCurrency.value];
    const to = CURRENCIES[toCurrency.value];
    if (from) {
        fromFlag.textContent = from.flag;
        fromName.textContent = from.name;
        fromSymbol.textContent = from.symbol;
    }
    if (to) {
        toFlag.textContent = to.flag;
        toName.textContent = to.name;
    }
}

fromCurrency.addEventListener("change", updateCurrencyDisplay);
toCurrency.addEventListener("change", updateCurrencyDisplay);

swapBtn.addEventListener("click", () => {
    swapBtn.classList.add("is-spinning");
    const temp = fromCurrency.value;
    fromCurrency.value = toCurrency.value;
    toCurrency.value = temp;
    updateCurrencyDisplay();
    setTimeout(() => swapBtn.classList.remove("is-spinning"), 350);
});

/* ==========================================================================
   Amount input validation
   ========================================================================== */

amountInput.addEventListener("input", () => {
    const value = parseAmount(amountInput.value);
    amountInput.classList.toggle("is-invalid", amountInput.value.length > 0 && (Number.isNaN(value) || value < 0));
});

/* ==========================================================================
   Main conversion
   ========================================================================== */

async function convertMoney() {
    const amountValue = parseAmount(amountInput.value);

    if (Number.isNaN(amountValue) || amountValue <= 0) {
        showError("Digite um valor válido maior que zero.");
        return;
    }

    if (fromCurrency.value === toCurrency.value) {
        showError("Escolha duas moedas diferentes para converter.");
        return;
    }

    setLoading(true);

    try {
        const response = await fetch(API_URL + fromCurrency.value);
        if (!response.ok) {
            throw new Error(`API respondeu com status ${response.status}`);
        }

        const data = await response.json();

        if (!data || !data.rates || typeof data.rates[toCurrency.value] !== "number") {
            throw new Error("Resposta da API não contém a cotação solicitada.");
        }

        const rate = data.rates[toCurrency.value];
        const convertedValue = amountValue * rate;

        if (!Number.isFinite(convertedValue)) {
            throw new Error("Não foi possível calcular a conversão.");
        }

        setApiStatus(true);
        renderResult(amountValue, convertedValue, rate);

        lastConversion = {
            from: fromCurrency.value,
            to: toCurrency.value,
            amount: amountValue,
            converted: convertedValue,
            rate,
            ts: Date.now(),
        };

        pushHistory(lastConversion);
    } catch (err) {
        console.error(err);
        setApiStatus(false);
        showError("Falha ao buscar a cotação. Verifique sua conexão e tente novamente.");
    } finally {
        setLoading(false);
    }
}

function setLoading(isLoading) {
    loading.classList.toggle("is-visible", isLoading);
    errorBox.classList.remove("is-visible");
    if (isLoading) {
        result.classList.remove("is-visible");
        convertBtn.disabled = true;
    } else {
        convertBtn.disabled = false;
    }
}

function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.add("is-visible");
    result.classList.remove("is-visible");
    loading.classList.remove("is-visible");
}

function renderResult(amountValue, convertedValue, rate) {
    resultFrom.textContent = formatCurrency(amountValue, fromCurrency.value);
    resultTo.textContent = formatCurrency(convertedValue, toCurrency.value);
    resultRate.textContent = `1 ${fromCurrency.value} = ${rate.toFixed(4)} ${toCurrency.value}`;
    resultUpdated.textContent = `Última atualização: hoje às ${formatTime(new Date())}`;
    result.classList.add("is-visible");
    errorBox.classList.remove("is-visible");
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    convertMoney();
});

/* ==========================================================================
   API status indicator
   ========================================================================== */

function setApiStatus(isOnline) {
    apiStatus.classList.toggle("is-online", isOnline);
    apiStatus.classList.toggle("is-offline", !isOnline);
    apiStatus.querySelector(".status-text").textContent = isOnline ? "API conectada" : "API indisponível";
}

/* ==========================================================================
   Market data (base = BRL) — powers market cards, stats, quick conversions & chart
   ========================================================================== */

async function loadMarketData() {
    try {
        const response = await fetch(API_URL + "BRL");
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        if (!data || !data.rates) throw new Error("Resposta inválida");

        marketRatesBRL = data.rates;
        setApiStatus(true);

        renderMarketGrid();
        renderStats(data);
        renderQuickConversions();
        recordRateSnapshot();
        renderChart();
    } catch (err) {
        console.error(err);
        setApiStatus(false);
        marketGrid.innerHTML = `<p class="panel-placeholder">Não foi possível carregar as cotações do mercado agora.</p>`;
        statsGrid.innerHTML = `<p class="panel-placeholder">Estatísticas indisponíveis no momento.</p>`;
    }
}

function renderMarketGrid() {
    if (!marketRatesBRL) return;

    marketGrid.innerHTML = MARKET_PAIRS.map((code) => {
        const rateToBRL = 1 / marketRatesBRL[code]; // value of 1 unit of `code` in BRL
        const info = CURRENCIES[code];
        return `
            <div class="market-card">
                <div class="market-pair">
                    <span aria-hidden="true">${info.flag}</span>
                    <span>${code} / BRL</span>
                </div>
                <div class="market-value">${formatCurrency(rateToBRL, "BRL")}</div>
            </div>
        `;
    }).join("");
}

function renderStats(data) {
    if (!marketRatesBRL) return;

    const codes = Object.keys(CURRENCIES).filter((code) => code !== "BRL" && marketRatesBRL[code]);
    const valuesInBRL = codes.map((code) => ({ code, valueBRL: 1 / marketRatesBRL[code] }));

    const highest = valuesInBRL.reduce((a, b) => (b.valueBRL > a.valueBRL ? b : a));
    const lowest = valuesInBRL.reduce((a, b) => (b.valueBRL < a.valueBRL ? b : a));
    const updatedAt = data.time_last_updated ? new Date(data.time_last_updated * 1000) : new Date();

    const stats = [
        {
            icon: "📈",
            label: "Maior cotação vs. BRL",
            value: `${highest.code} — ${formatCurrency(highest.valueBRL, "BRL")}`,
            sub: "Calculado a partir das cotações atuais",
        },
        {
            icon: "📉",
            label: "Menor cotação vs. BRL",
            value: `${lowest.code} — ${formatCurrency(lowest.valueBRL, "BRL")}`,
            sub: "Calculado a partir das cotações atuais",
        },
        {
            icon: "🌎",
            label: "Moedas monitoradas",
            value: `${codes.length + 1} moedas`,
            sub: "Disponíveis neste conversor",
        },
        {
            icon: "🔄",
            label: "Última atualização",
            value: formatTime(updatedAt),
            sub: "Horário informado pela ExchangeRate API",
        },
    ];

    statsGrid.innerHTML = stats
        .map(
            (s) => `
            <div class="stat-card">
                <span class="stat-icon" aria-hidden="true">${s.icon}</span>
                <span class="stat-label">${s.label}</span>
                <span class="stat-value">${s.value}</span>
                <span class="stat-sub">${s.sub}</span>
            </div>
        `
        )
        .join("");
}

/* ==========================================================================
   Quick conversions
   ========================================================================== */

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

function renderQuickConversions() {
    if (!marketRatesBRL) return;
    const target = quickCurrencySelect.value;
    const rate = marketRatesBRL[target];

    if (typeof rate !== "number") {
        quickGrid.innerHTML = `<p class="panel-placeholder">Cotação indisponível para ${target}.</p>`;
        return;
    }

    quickGrid.innerHTML = QUICK_AMOUNTS.map((amount) => {
        const converted = amount * rate;
        return `
            <div class="quick-card">
                <div class="quick-from">${formatCurrency(amount, "BRL")}</div>
                <div class="quick-to">${formatCurrency(converted, target)}</div>
            </div>
        `;
    }).join("");
}

quickCurrencySelect.addEventListener("change", renderQuickConversions);

/* ==========================================================================
   Favorites
   ========================================================================== */

function getFavorites() {
    return safeGetJSON(STORAGE_KEYS.favorites, []);
}

function toggleFavorite(code) {
    const favorites = getFavorites();
    const index = favorites.indexOf(code);
    if (index === -1) {
        favorites.push(code);
        showToast(`${code} adicionada aos favoritos`);
    } else {
        favorites.splice(index, 1);
        showToast(`${code} removida dos favoritos`);
    }
    safeSetJSON(STORAGE_KEYS.favorites, favorites);
    renderFavorites();
}

function renderFavorites() {
    const favorites = getFavorites();
    favoritesList.innerHTML = Object.entries(CURRENCIES)
        .map(([code, info]) => {
            const isFav = favorites.includes(code);
            return `
                <li>
                    <button type="button" class="favorite-chip ${isFav ? "is-favorite" : ""}" data-code="${code}" aria-pressed="${isFav}">
                        <span class="star" aria-hidden="true">${isFav ? "★" : "☆"}</span>
                        <span aria-hidden="true">${info.flag}</span>
                        <span>${code}</span>
                    </button>
                </li>
            `;
        })
        .join("");

    favoritesList.querySelectorAll(".favorite-chip").forEach((btn) => {
        btn.addEventListener("click", () => toggleFavorite(btn.dataset.code));
    });
}

/* ==========================================================================
   Conversion history
   ========================================================================== */

function getHistory() {
    return safeGetJSON(STORAGE_KEYS.history, []);
}

function pushHistory(entry) {
    const history = getHistory();
    history.unshift(entry);
    safeSetJSON(STORAGE_KEYS.history, history.slice(0, 10));
    renderHistory();
}

function renderHistory() {
    const history = getHistory();

    if (history.length === 0) {
        historyList.innerHTML = `<li class="panel-placeholder">Nenhuma conversão realizada ainda.</li>`;
        return;
    }

    historyList.innerHTML = history
        .map((entry) => {
            const date = new Date(entry.ts);
            return `
                <li class="history-item">
                    <span class="history-conversion">${formatCurrency(entry.amount, entry.from)} → ${formatCurrency(entry.converted, entry.to)}</span>
                    <span class="history-time">Hoje — ${formatTime(date)}</span>
                </li>
            `;
        })
        .join("");
}

clearHistoryBtn.addEventListener("click", () => {
    safeSetJSON(STORAGE_KEYS.history, []);
    renderHistory();
    showToast("Histórico de conversões limpo");
});

/* ==========================================================================
   Rate history (self-collected, powers the chart)
   ========================================================================== */

function recordRateSnapshot() {
    if (!marketRatesBRL) return;
    const history = safeGetJSON(STORAGE_KEYS.rateHistory, []);
    const snapshot = { ts: Date.now() };
    MARKET_PAIRS.forEach((code) => {
        snapshot[code] = 1 / marketRatesBRL[code];
    });
    history.push(snapshot);
    safeSetJSON(STORAGE_KEYS.rateHistory, history.slice(-1000));
}

function getChartPoints(rangeDays) {
    const history = safeGetJSON(STORAGE_KEYS.rateHistory, []);
    const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
    return history.filter((point) => point.ts >= cutoff && typeof point.USD === "number");
}

function renderChart() {
    if (typeof Chart === "undefined") return;

    const points = getChartPoints(currentRange);
    const styles = getComputedStyle(document.body);
    const accent = styles.getPropertyValue("--accent").trim() || "#5B8DEF";
    const textMuted = styles.getPropertyValue("--text-muted").trim() || "#9AA3C2";
    const gridColor = styles.getPropertyValue("--border-soft").trim() || "#242E4A";

    const labels = points.map((p) => formatTime(new Date(p.ts)));
    const values = points.map((p) => p.USD);

    if (rateChart) {
        rateChart.destroy();
    }

    rateChart = new Chart(chartCanvas, {
        type: "line",
        data: {
            labels,
            datasets: [
                {
                    label: "USD → BRL",
                    data: values,
                    borderColor: accent,
                    backgroundColor: (ctx) => {
                        const { chart } = ctx;
                        const { ctx: c, chartArea } = chart;
                        if (!chartArea) return "transparent";
                        const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                        gradient.addColorStop(0, `${accent}55`);
                        gradient.addColorStop(1, `${accent}00`);
                        return gradient;
                    },
                    borderWidth: 2.5,
                    tension: 0.35,
                    fill: true,
                    pointRadius: points.length <= 30 ? 3 : 0,
                    pointBackgroundColor: accent,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `1 USD = ${ctx.parsed.y.toFixed(4)} BRL`,
                    },
                },
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textMuted, maxTicksLimit: 6 },
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textMuted },
                },
            },
        },
    });
}

rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        rangeButtons.forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        currentRange = Number(btn.dataset.range);
        renderChart();
    });
});

/* ==========================================================================
   Init
   ========================================================================== */

function init() {
    initTheme();
    updateCurrencyDisplay();
    renderFavorites();
    renderHistory();
    loadMarketData();
}

init();