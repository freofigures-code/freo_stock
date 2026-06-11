(() => {
  const STORAGE_KEY = 'freostock-ai-pwa-state-v1';
  const $ = (selector) => document.querySelector(selector);

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const uid = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const numberOr = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const formatBRL = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberOr(value));
  const formatNumber = (value, digits = 0) => numberOr(value).toLocaleString('pt-BR', { maximumFractionDigits: digits });
  const formatGrams = (value) => `${formatNumber(value, 1)}g`;
  const normalizeKey = (value) => String(value || '').trim().toUpperCase();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));

  const defaultState = () => ({
    settings: {
      demandWindowDays: 7,
      targetCoverageDays: 10,
      minStockBuffer: 3,
      shopeeAdvertisedStockLowAlert: 5,
      maxBatchUnits: 60
    },
    products: [
      {
        id: 'prod-chaveiro-exu', sku: 'EXU-CHAVEIRO-PRETO', name: 'Chaveiro Exu Tranca Ruas', category: 'Chaveiro',
        realStock: 5, shopeeAdvertisedStock: 999, salePrice: 24.9, estimatedMargin: 9.4, active: true,
        recipe: { material: 'PLA', color: 'Preto', gramsPerUnit: 18, wastePercent: 10, printTimeMinutes: 42 }
      },
      {
        id: 'prod-suporte-celular', sku: 'SUP-CEL-BRANCO', name: 'Suporte de Celular Minimalista', category: 'Suporte',
        realStock: 12, shopeeAdvertisedStock: 200, salePrice: 34.9, estimatedMargin: 12.5, active: true,
        recipe: { material: 'PLA', color: 'Branco', gramsPerUnit: 65, wastePercent: 8, printTimeMinutes: 130 }
      },
      {
        id: 'prod-miniatura-vermelha', sku: 'MINI-VERMELHA', name: 'Miniatura Decorativa Vermelha', category: 'Miniatura',
        realStock: 2, shopeeAdvertisedStock: 4, salePrice: 39.9, estimatedMargin: 15.2, active: true,
        recipe: { material: 'PLA', color: 'Vermelho', gramsPerUnit: 42, wastePercent: 15, printTimeMinutes: 95 }
      }
    ],
    filaments: [
      { id: 'fil-pla-preto', material: 'PLA', color: 'Preto', brand: 'Genérico', currentWeightGrams: 720, active: true },
      { id: 'fil-pla-branco', material: 'PLA', color: 'Branco', brand: 'Genérico', currentWeightGrams: 430, active: true },
      { id: 'fil-pla-vermelho', material: 'PLA', color: 'Vermelho', brand: 'Genérico', currentWeightGrams: 1100, active: true }
    ],
    sales: [
      { id: 'sale-1', sku: 'EXU-CHAVEIRO-PRETO', quantity: 4, price: 24.9, soldAt: daysAgo(0) },
      { id: 'sale-2', sku: 'EXU-CHAVEIRO-PRETO', quantity: 6, price: 24.9, soldAt: daysAgo(1) },
      { id: 'sale-3', sku: 'EXU-CHAVEIRO-PRETO', quantity: 5, price: 24.9, soldAt: daysAgo(3) },
      { id: 'sale-4', sku: 'SUP-CEL-BRANCO', quantity: 3, price: 34.9, soldAt: daysAgo(2) },
      { id: 'sale-5', sku: 'MINI-VERMELHA', quantity: 7, price: 39.9, soldAt: daysAgo(1) },
      { id: 'sale-6', sku: 'MINI-VERMELHA', quantity: 5, price: 39.9, soldAt: daysAgo(5) }
    ],
    recommendations: [],
    alerts: [],
    lastSummary: ''
  });

  function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }

  let state = loadState();
  let deferredInstallPrompt = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return migrateState(parsed);
    } catch (error) {
      console.warn('Falha ao carregar dados locais.', error);
      return defaultState();
    }
  }

  function migrateState(input) {
    const base = defaultState();
    return {
      settings: { ...base.settings, ...(input.settings || {}) },
      products: Array.isArray(input.products) ? input.products : base.products,
      filaments: Array.isArray(input.filaments) ? input.filaments : base.filaments,
      sales: Array.isArray(input.sales) ? input.sales : base.sales,
      recommendations: Array.isArray(input.recommendations) ? input.recommendations : [],
      alerts: Array.isArray(input.alerts) ? input.alerts : [],
      lastSummary: input.lastSummary || ''
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state, null, 2));
  }

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }

  function formToObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function gramsPerUnitWithWaste(product) {
    const recipe = product.recipe || {};
    const grams = numberOr(recipe.gramsPerUnit);
    const waste = numberOr(recipe.wastePercent);
    return grams * (1 + waste / 100);
  }

  function filamentKey(material, color) {
    return `${normalizeKey(material)}::${normalizeKey(color)}`;
  }

  function salesInWindow(sku, windowDays) {
    const since = Date.now() - windowDays * 86400000;
    return state.sales
      .filter((sale) => normalizeKey(sale.sku) === normalizeKey(sku))
      .filter((sale) => new Date(sale.soldAt || todayIso()).getTime() >= since)
      .reduce((sum, sale) => sum + numberOr(sale.quantity), 0);
  }

  function revenueInWindow(sku, windowDays) {
    const since = Date.now() - windowDays * 86400000;
    return state.sales
      .filter((sale) => normalizeKey(sale.sku) === normalizeKey(sku))
      .filter((sale) => new Date(sale.soldAt || todayIso()).getTime() >= since)
      .reduce((sum, sale) => sum + numberOr(sale.quantity) * numberOr(sale.price), 0);
  }

  function buildFilamentAvailability() {
    const map = new Map();
    for (const filament of state.filaments.filter((f) => f.active !== false)) {
      const key = filamentKey(filament.material, filament.color);
      const current = map.get(key) || { material: filament.material, color: filament.color, availableGrams: 0 };
      current.availableGrams += numberOr(filament.currentWeightGrams);
      map.set(key, current);
    }
    return map;
  }

  function runRecommendations() {
    const settings = state.settings;
    const demandWindowDays = Math.max(1, numberOr(settings.demandWindowDays, 7));
    const targetCoverageDays = Math.max(1, numberOr(settings.targetCoverageDays, 10));
    const minStockBuffer = Math.max(0, numberOr(settings.minStockBuffer, 3));
    const maxBatchUnits = Math.max(1, numberOr(settings.maxBatchUnits, 60));
    const lowAdvertisedStock = Math.max(0, numberOr(settings.shopeeAdvertisedStockLowAlert, 5));
    const availability = buildFilamentAvailability();
    const allocation = new Map();
    const recommendations = [];
    const alerts = [];

    for (const product of state.products.filter((p) => p.active !== false)) {
      const recentSales = salesInWindow(product.sku, demandWindowDays);
      const revenue = revenueInWindow(product.sku, demandWindowDays);
      const dailyVelocity = recentSales / demandWindowDays;
      const targetStock = Math.ceil(dailyVelocity * targetCoverageDays + minStockBuffer);
      const realStock = Math.max(0, numberOr(product.realStock));
      const neededUnits = Math.max(0, targetStock - realStock);
      const daysOfStockLeft = dailyVelocity > 0 ? realStock / dailyVelocity : Infinity;
      const gramsEach = gramsPerUnitWithWaste(product);
      const recipe = product.recipe || {};
      const key = filamentKey(recipe.material, recipe.color);
      const filament = availability.get(key) || { material: recipe.material || '', color: recipe.color || '', availableGrams: 0 };
      const alreadyAllocated = allocation.get(key) || 0;
      const remainingGrams = Math.max(0, numberOr(filament.availableGrams) - alreadyAllocated);
      const possibleByFilament = gramsEach > 0 ? Math.floor(remainingGrams / gramsEach) : 0;
      const suggestedUnits = Math.min(neededUnits, maxBatchUnits, possibleByFilament);
      const filamentNeeded = suggestedUnits * gramsEach;
      allocation.set(key, alreadyAllocated + filamentNeeded);

      const score = Math.round((dailyVelocity * 14) + Math.max(0, 10 - Math.min(daysOfStockLeft, 10)) * 7 + numberOr(product.estimatedMargin) * 1.5);
      let action = 'hold';
      let priority = 'Baixa';
      let title = 'Não produzir agora';
      let reason = 'Estoque real cobre a demanda configurada ou não houve vendas recentes suficientes.';

      if (neededUnits > 0 && suggestedUnits > 0) {
        action = 'produce';
        priority = daysOfStockLeft <= 3 || score >= 80 ? 'Alta' : daysOfStockLeft <= 7 || score >= 45 ? 'Média' : 'Baixa';
        title = `Produzir ${suggestedUnits} unidade${suggestedUnits === 1 ? '' : 's'}`;
        reason = `Vendeu ${recentSales} em ${demandWindowDays} dias. Estoque real: ${realStock}. Estoque-alvo: ${targetStock}.`;
      } else if (neededUnits > 0 && possibleByFilament <= 0 && gramsEach > 0) {
        action = 'buy_filament';
        priority = 'Comprar filamento';
        title = `Falta ${recipe.material || 'material'} ${recipe.color || ''}`.trim();
        reason = `Precisa repor ${neededUnits}, mas o filamento disponível não cobre a produção.`;
      }

      if (numberOr(product.shopeeAdvertisedStock) <= lowAdvertisedStock) {
        alerts.push(`Aumentar estoque anunciado na Shopee: ${product.name} está com ${numberOr(product.shopeeAdvertisedStock)} anunciado.`);
      }

      recommendations.push({
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        action,
        priority,
        title,
        reason,
        recentSales,
        revenue,
        realStock,
        targetStock,
        neededUnits,
        suggestedUnits,
        dailyVelocity,
        daysOfStockLeft: Number.isFinite(daysOfStockLeft) ? daysOfStockLeft : null,
        gramsEach,
        filamentNeeded,
        availableFilamentBeforeAllocation: remainingGrams,
        material: recipe.material,
        color: recipe.color,
        estimatedMargin: numberOr(product.estimatedMargin),
        estimatedProfit: suggestedUnits * numberOr(product.estimatedMargin),
        score
      });
    }

    recommendations.sort((a, b) => {
      const rank = { produce: 3, buy_filament: 2, hold: 1 };
      const prio = { Alta: 3, Média: 2, Baixa: 1, 'Comprar filamento': 2 };
      return (rank[b.action] - rank[a.action]) || (prio[b.priority] - prio[a.priority]) || (b.score - a.score);
    });

    state.recommendations = recommendations;
    state.alerts = alerts;
    state.lastSummary = buildSummary(recommendations, alerts);
    saveState();
    render();
    toast('Recomendação gerada.');
  }

  function buildSummary(rows, alerts) {
    const toProduce = rows.filter((r) => r.action === 'produce');
    const toBuy = rows.filter((r) => r.action === 'buy_filament');
    const totalUnits = toProduce.reduce((sum, r) => sum + r.suggestedUnits, 0);
    const estimatedProfit = toProduce.reduce((sum, r) => sum + r.estimatedProfit, 0);
    if (!rows.length) return 'Cadastre produtos, filamentos e vendas para gerar recomendação.';

    const lines = [];
    if (toProduce.length) {
      lines.push(`Produzir ${totalUnits} peça${totalUnits === 1 ? '' : 's'} agora, com lucro estimado de ${formatBRL(estimatedProfit)} antes de custos extras.`);
      lines.push(`Prioridade: ${toProduce.slice(0, 3).map((r) => `${r.productName} (${r.suggestedUnits})`).join(', ')}.`);
    } else {
      lines.push('Nenhum produto precisa ser produzido agora pelas regras atuais.');
    }
    if (toBuy.length) lines.push(`Comprar filamento para: ${toBuy.map((r) => `${r.material || ''} ${r.color || ''}`.trim()).join(', ')}.`);
    if (alerts.length) lines.push(`${alerts.length} alerta${alerts.length === 1 ? '' : 's'} de estoque anunciado na Shopee.`);
    lines.push('Lembrete: o estoque da Shopee não foi usado como estoque real.');
    return lines.join('\n');
  }

  function render() {
    renderMetrics();
    renderRecommendations();
    renderProducts();
    renderFilaments();
    renderSales();
    renderSettings();
  }

  function renderMetrics() {
    const totalProducts = state.products.length;
    const totalRealStock = state.products.reduce((sum, p) => sum + numberOr(p.realStock), 0);
    const totalFilament = state.filaments.reduce((sum, f) => sum + numberOr(f.currentWeightGrams), 0);
    const sales7 = state.sales.filter((s) => Date.now() - new Date(s.soldAt || todayIso()).getTime() <= 7 * 86400000).reduce((sum, s) => sum + numberOr(s.quantity), 0);
    $('#metrics').innerHTML = [
      ['Produtos', totalProducts],
      ['Estoque real pronto', totalRealStock],
      ['Filamento disponível', formatGrams(totalFilament)],
      ['Vendas 7 dias', sales7]
    ].map(([label, value]) => `<article class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join('');
  }

  function renderRecommendations() {
    const summary = $('#summary');
    summary.textContent = state.lastSummary || 'Clique em “Gerar recomendação”.';
    summary.classList.toggle('empty', !state.lastSummary);

    const rows = state.recommendations || [];
    $('#recommendations').innerHTML = rows.length ? rows.map((r) => `
      <article class="card">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(r.productName)}</h3>
            <p class="subtitle">${escapeHtml(r.reason)}</p>
          </div>
          <span class="badge ${escapeHtml(r.action)}">${escapeHtml(r.priority)}</span>
        </div>
        <div class="meta">
          <span>${escapeHtml(r.title)}</span>
          <span>SKU ${escapeHtml(r.sku)}</span>
          <span>Vendeu ${formatNumber(r.recentSales)} em ${formatNumber(state.settings.demandWindowDays)} dias</span>
          <span>Estoque real ${formatNumber(r.realStock)}</span>
          <span>Alvo ${formatNumber(r.targetStock)}</span>
          <span>${formatGrams(r.gramsEach)} por peça</span>
          <span>Gasta ${formatGrams(r.filamentNeeded)}</span>
          <span>${escapeHtml(r.material || '-')} ${escapeHtml(r.color || '')}</span>
          <span>Lucro estimado ${formatBRL(r.estimatedProfit)}</span>
        </div>
      </article>
    `).join('') : '<p class="empty-state">Nenhuma recomendação gerada ainda.</p>';

    $('#alerts').innerHTML = state.alerts.length ? state.alerts.map((a) => `<div class="alert-item">${escapeHtml(a)}</div>`).join('') : '';
  }

  function renderProducts() {
    const list = $('#productList');
    list.innerHTML = state.products.length ? state.products.map((p) => `
      <article class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(p.name)}</div>
          <div class="item-sub">
            SKU ${escapeHtml(p.sku)} · Real: ${formatNumber(p.realStock)} · Anunciado Shopee: ${formatNumber(p.shopeeAdvertisedStock)}<br />
            ${escapeHtml(p.recipe?.material || '-')} ${escapeHtml(p.recipe?.color || '')} · ${formatGrams(p.recipe?.gramsPerUnit)} + ${formatNumber(p.recipe?.wastePercent, 1)}% perda · ${formatBRL(p.salePrice)}
          </div>
        </div>
        <div class="item-actions">
          <button class="link-button" data-action="edit-product" data-id="${escapeHtml(p.id)}" type="button">Editar</button>
          <button class="link-button danger" data-action="delete-product" data-id="${escapeHtml(p.id)}" type="button">Excluir</button>
        </div>
      </article>
    `).join('') : '<p class="empty-state">Nenhum produto cadastrado.</p>';
  }

  function renderFilaments() {
    const list = $('#filamentList');
    list.innerHTML = state.filaments.length ? state.filaments.map((f) => `
      <article class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(f.material)} ${escapeHtml(f.color)}</div>
          <div class="item-sub">${escapeHtml(f.brand || 'Sem marca')} · Disponível: ${formatGrams(f.currentWeightGrams)}</div>
        </div>
        <div class="item-actions">
          <button class="link-button" data-action="edit-filament" data-id="${escapeHtml(f.id)}" type="button">Editar</button>
          <button class="link-button danger" data-action="delete-filament" data-id="${escapeHtml(f.id)}" type="button">Excluir</button>
        </div>
      </article>
    `).join('') : '<p class="empty-state">Nenhum filamento cadastrado.</p>';
  }

  function renderSales() {
    const sorted = [...state.sales].sort((a, b) => new Date(b.soldAt || 0) - new Date(a.soldAt || 0)).slice(0, 30);
    $('#salesList').innerHTML = sorted.length ? sorted.map((s) => `
      <article class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(s.sku)}</div>
          <div class="item-sub">${formatNumber(s.quantity)} unid. · ${formatBRL(s.price)} cada · ${escapeHtml(s.soldAt || '-')}</div>
        </div>
        <div class="item-actions">
          <button class="link-button danger" data-action="delete-sale" data-id="${escapeHtml(s.id)}" type="button">Excluir</button>
        </div>
      </article>
    `).join('') : '<p class="empty-state">Nenhuma venda cadastrada.</p>';
  }

  function renderSettings() {
    const form = $('#settingsForm');
    for (const [key, value] of Object.entries(state.settings)) {
      if (form.elements[key]) form.elements[key].value = value;
    }
  }

  function upsertProduct(data, id = null) {
    const product = {
      id: id || uid('prod'),
      sku: normalizeKey(data.sku),
      name: String(data.name || '').trim(),
      category: String(data.category || '').trim(),
      realStock: Math.max(0, Math.round(numberOr(data.realStock))),
      shopeeAdvertisedStock: Math.max(0, Math.round(numberOr(data.shopeeAdvertisedStock))),
      salePrice: Math.max(0, numberOr(data.salePrice)),
      estimatedMargin: Math.max(0, numberOr(data.estimatedMargin)),
      active: true,
      recipe: {
        material: String(data.material || '').trim(),
        color: String(data.color || '').trim(),
        gramsPerUnit: Math.max(0, numberOr(data.gramsPerUnit)),
        wastePercent: Math.max(0, numberOr(data.wastePercent)),
        printTimeMinutes: Math.max(0, Math.round(numberOr(data.printTimeMinutes)))
      }
    };
    if (!product.sku || !product.name) throw new Error('Preencha SKU e nome do produto.');
    const idx = state.products.findIndex((p) => p.id === id || normalizeKey(p.sku) === product.sku);
    if (idx >= 0) state.products[idx] = { ...state.products[idx], ...product, id: state.products[idx].id };
    else state.products.push(product);
    state.recommendations = [];
    state.lastSummary = '';
  }

  function upsertFilament(data, id = null) {
    const filament = {
      id: id || uid('fil'),
      material: String(data.material || '').trim(),
      color: String(data.color || '').trim(),
      brand: String(data.brand || '').trim(),
      currentWeightGrams: Math.max(0, numberOr(data.currentWeightGrams)),
      active: true
    };
    if (!filament.material || !filament.color) throw new Error('Preencha material e cor.');
    const idx = state.filaments.findIndex((f) => f.id === id);
    if (idx >= 0) state.filaments[idx] = filament;
    else state.filaments.push(filament);
    state.recommendations = [];
    state.lastSummary = '';
  }

  function addSale(data) {
    const sale = {
      id: uid('sale'),
      sku: normalizeKey(data.sku),
      quantity: Math.max(1, Math.round(numberOr(data.quantity, 1))),
      price: Math.max(0, numberOr(data.price)),
      soldAt: data.soldAt || todayIso()
    };
    if (!sale.sku) throw new Error('Preencha o SKU da venda.');
    state.sales.push(sale);
    state.recommendations = [];
    state.lastSummary = '';
  }

  function fillProductForm(product) {
    const form = $('#productForm');
    form.dataset.editId = product.id;
    form.sku.value = product.sku || '';
    form.name.value = product.name || '';
    form.category.value = product.category || '';
    form.realStock.value = product.realStock || 0;
    form.shopeeAdvertisedStock.value = product.shopeeAdvertisedStock || 0;
    form.salePrice.value = product.salePrice || 0;
    form.estimatedMargin.value = product.estimatedMargin || 0;
    form.material.value = product.recipe?.material || '';
    form.color.value = product.recipe?.color || '';
    form.gramsPerUnit.value = product.recipe?.gramsPerUnit || 0;
    form.wastePercent.value = product.recipe?.wastePercent || 0;
    form.printTimeMinutes.value = product.recipe?.printTimeMinutes || 0;
    form.querySelector('button[type="submit"]').textContent = 'Atualizar produto';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function fillFilamentForm(filament) {
    const form = $('#filamentForm');
    form.dataset.editId = filament.id;
    form.material.value = filament.material || '';
    form.color.value = filament.color || '';
    form.brand.value = filament.brand || '';
    form.currentWeightGrams.value = filament.currentWeightGrams || 0;
    form.querySelector('button[type="submit"]').textContent = 'Atualizar filamento';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetProductForm() {
    const form = $('#productForm');
    form.reset();
    delete form.dataset.editId;
    form.querySelector('button[type="submit"]').textContent = 'Salvar produto';
  }

  function resetFilamentForm() {
    const form = $('#filamentForm');
    form.reset();
    delete form.dataset.editId;
    form.querySelector('button[type="submit"]').textContent = 'Salvar filamento';
  }

  function importSalesJson() {
    const raw = $('#salesJson').value.trim();
    if (!raw) throw new Error('Cole o JSON de vendas antes de importar.');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('O JSON precisa ser uma lista.');
    rows.forEach(addSale);
    $('#salesJson').value = '';
    saveState();
    render();
    toast(`${rows.length} venda(s) importada(s).`);
  }

  function simulateShopeePull() {
    const products = state.products;
    if (!products.length) return toast('Cadastre produtos antes de simular vendas.');
    const samples = products.slice(0, 4).map((p) => ({
      id: uid('sale'),
      sku: p.sku,
      quantity: Math.floor(Math.random() * 4) + 1,
      price: numberOr(p.salePrice),
      soldAt: daysAgo(Math.floor(Math.random() * Math.max(1, numberOr(state.settings.demandWindowDays))))
    }));
    state.sales.push(...samples);
    state.recommendations = [];
    state.lastSummary = '';
    saveState();
    render();
    toast('Vendas simuladas adicionadas.');
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), app: 'FreoStock AI PWA', ...state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `freostock-backup-${todayIso()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(String(reader.result || '{}'));
        state = migrateState(imported);
        saveState();
        render();
        toast('Backup importado.');
      } catch (error) {
        toast(`Erro no backup: ${error.message}`);
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    $('#runBtn').addEventListener('click', runRecommendations);
    $('#seedBtn').addEventListener('click', () => {
      if (confirm('Isso substitui os dados atuais pelos dados de exemplo. Continuar?')) {
        state = defaultState();
        saveState();
        render();
        toast('Dados de exemplo carregados.');
      }
    });
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#importBackupInput').addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
      event.target.value = '';
    });
    $('#mockShopeeBtn').addEventListener('click', simulateShopeePull);
    $('#importSalesBtn').addEventListener('click', () => {
      try { importSalesJson(); } catch (error) { toast(error.message); }
    });

    $('#productForm').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const form = event.currentTarget;
        upsertProduct(formToObject(form), form.dataset.editId || null);
        saveState();
        resetProductForm();
        render();
        toast('Produto salvo.');
      } catch (error) { toast(error.message); }
    });

    $('#filamentForm').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        const form = event.currentTarget;
        upsertFilament(formToObject(form), form.dataset.editId || null);
        saveState();
        resetFilamentForm();
        render();
        toast('Filamento salvo.');
      } catch (error) { toast(error.message); }
    });

    $('#saleForm').addEventListener('submit', (event) => {
      event.preventDefault();
      try {
        addSale(formToObject(event.currentTarget));
        saveState();
        event.currentTarget.reset();
        render();
        toast('Venda adicionada.');
      } catch (error) { toast(error.message); }
    });

    $('#settingsForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const data = formToObject(event.currentTarget);
      state.settings = {
        demandWindowDays: Math.max(1, Math.round(numberOr(data.demandWindowDays, 7))),
        targetCoverageDays: Math.max(1, Math.round(numberOr(data.targetCoverageDays, 10))),
        minStockBuffer: Math.max(0, Math.round(numberOr(data.minStockBuffer, 3))),
        shopeeAdvertisedStockLowAlert: Math.max(0, Math.round(numberOr(data.shopeeAdvertisedStockLowAlert, 5))),
        maxBatchUnits: Math.max(1, Math.round(numberOr(data.maxBatchUnits, 60)))
      };
      state.recommendations = [];
      state.lastSummary = '';
      saveState();
      render();
      toast('Regras salvas.');
    });

    document.body.addEventListener('click', (event) => {
      const button = event.target.closest('[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      if (action === 'edit-product') {
        const product = state.products.find((p) => p.id === id);
        if (product) fillProductForm(product);
      }
      if (action === 'delete-product') {
        const product = state.products.find((p) => p.id === id);
        if (product && confirm(`Excluir produto "${product.name}"?`)) {
          state.products = state.products.filter((p) => p.id !== id);
          state.recommendations = [];
          state.lastSummary = '';
          saveState();
          render();
        }
      }
      if (action === 'edit-filament') {
        const filament = state.filaments.find((f) => f.id === id);
        if (filament) fillFilamentForm(filament);
      }
      if (action === 'delete-filament') {
        const filament = state.filaments.find((f) => f.id === id);
        if (filament && confirm(`Excluir filamento "${filament.material} ${filament.color}"?`)) {
          state.filaments = state.filaments.filter((f) => f.id !== id);
          state.recommendations = [];
          state.lastSummary = '';
          saveState();
          render();
        }
      }
      if (action === 'delete-sale') {
        state.sales = state.sales.filter((s) => s.id !== id);
        state.recommendations = [];
        state.lastSummary = '';
        saveState();
        render();
      }
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch((error) => console.warn('Service worker não registrado.', error));
    });
  }

  function setupInstallPrompt() {
    const bar = $('#installBar');
    const installBtn = $('#installBtn');
    const dismissBtn = $('#dismissInstallBtn');
    const dismissed = localStorage.getItem('freostock-install-dismissed') === 'true';

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      if (!dismissed) bar.hidden = false;
    });

    installBtn.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      bar.hidden = true;
    });

    dismissBtn.addEventListener('click', () => {
      localStorage.setItem('freostock-install-dismissed', 'true');
      bar.hidden = true;
    });
  }

  bindEvents();
  render();
  registerServiceWorker();
  setupInstallPrompt();
})();
