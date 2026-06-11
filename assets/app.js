(() => {
  const $ = (selector) => document.querySelector(selector);

  const config = window.FREOSTOCK_SUPABASE || {};
  const hasSupabaseConfig = Boolean(config.url && config.anonKey && window.supabase);
  const db = hasSupabaseConfig ? window.supabase.createClient(config.url, config.anonKey) : null;

  const todayIso = () => new Date().toISOString().slice(0, 10);
  const daysAgo = (days) => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const numberOr = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const formatBRL = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(numberOr(value));
  const formatNumber = (value, digits = 0) => numberOr(value).toLocaleString('pt-BR', { maximumFractionDigits: digits });
  const formatGrams = (value) => `${formatNumber(value, 1)}g`;
  const normalizeKey = (value) => String(value || '').trim().toUpperCase();
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  const toDateInput = (value) => String(value || '').slice(0, 10) || todayIso();
  const toIsoFromDate = (value) => `${toDateInput(value)}T12:00:00.000Z`;

  const defaultSettings = () => ({
    demandWindowDays: 7,
    targetCoverageDays: 10,
    minStockBuffer: 3,
    shopeeAdvertisedStockLowAlert: 5,
    maxBatchUnits: 60,
    electricityCostKwh: 1.14,
    defaultMarkup: 2.5,
    shopeeFeePercent: 20,
    shopeeFixedFee: 5,
    expectedMonthlyRevenue: 2200,
    fixedMonthlyCosts: 0,
    failurePercent: 10
  });

  const emptyState = () => ({
    settings: defaultSettings(),
    products: [],
    filaments: [],
    sales: [],
    recommendations: [],
    alerts: [],
    lastSummary: ''
  });

  const demoState = () => ({
    settings: defaultSettings(),
    products: [
      {
        sku: 'EXU-CHAVEIRO-PRETO', name: 'Chaveiro Exu Tranca Ruas', category: 'Chaveiro',
        realStock: 5, shopeeAdvertisedStock: 999, salePrice: 24.9, estimatedMargin: 9.4, active: true,
        recipe: { material: 'PLA', color: 'Preto', gramsPerUnit: 18, wastePercent: 10, printTimeMinutes: 42, printerPowerWatts: 350, packagingCost: 1.5, extraCost: 0 }
      },
      {
        sku: 'SUP-CEL-BRANCO', name: 'Suporte de Celular Minimalista', category: 'Suporte',
        realStock: 12, shopeeAdvertisedStock: 200, salePrice: 34.9, estimatedMargin: 12.5, active: true,
        recipe: { material: 'PLA', color: 'Branco', gramsPerUnit: 65, wastePercent: 8, printTimeMinutes: 130, printerPowerWatts: 350, packagingCost: 2, extraCost: 0 }
      },
      {
        sku: 'MINI-VERMELHA', name: 'Miniatura Decorativa Vermelha', category: 'Miniatura',
        realStock: 2, shopeeAdvertisedStock: 4, salePrice: 39.9, estimatedMargin: 15.2, active: true,
        recipe: { material: 'PLA', color: 'Vermelho', gramsPerUnit: 42, wastePercent: 15, printTimeMinutes: 95, printerPowerWatts: 350, packagingCost: 2, extraCost: 0 }
      }
    ],
    filaments: [
      { material: 'PLA', color: 'Preto', brand: 'Genérico', currentWeightGrams: 720, initialWeightGrams: 1000, rollCost: 60, active: true },
      { material: 'PLA', color: 'Branco', brand: 'Genérico', currentWeightGrams: 430, initialWeightGrams: 1000, rollCost: 60, active: true },
      { material: 'PLA', color: 'Vermelho', brand: 'Genérico', currentWeightGrams: 1100, initialWeightGrams: 1000, rollCost: 65, active: true }
    ],
    sales: [
      { sku: 'EXU-CHAVEIRO-PRETO', quantity: 4, price: 24.9, soldAt: daysAgo(0) },
      { sku: 'EXU-CHAVEIRO-PRETO', quantity: 6, price: 24.9, soldAt: daysAgo(1) },
      { sku: 'EXU-CHAVEIRO-PRETO', quantity: 5, price: 24.9, soldAt: daysAgo(3) },
      { sku: 'SUP-CEL-BRANCO', quantity: 3, price: 34.9, soldAt: daysAgo(2) },
      { sku: 'MINI-VERMELHA', quantity: 7, price: 39.9, soldAt: daysAgo(1) },
      { sku: 'MINI-VERMELHA', quantity: 5, price: 39.9, soldAt: daysAgo(5) }
    ],
    recommendations: [],
    alerts: [],
    lastSummary: ''
  });

  let state = emptyState();
  let currentUser = null;
  let isBusy = false;
  let deferredInstallPrompt = null;

  function toast(message) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  function setBusy(value, label = 'Sincronizando...') {
    isBusy = value;
    const status = $('#syncStatus');
    if (status) status.textContent = value ? label : (currentUser ? 'Dados salvos no Supabase' : 'Faça login para usar');
    document.body.classList.toggle('is-busy', value);
  }

  function requireLogin() {
    if (!currentUser) throw new Error('Faça login antes de continuar.');
  }

  function handleError(error, fallback = 'Erro inesperado.') {
    console.error(error);
    toast(error?.message || fallback);
  }

  function unwrap(response) {
    if (response.error) throw response.error;
    return response.data;
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

  function roundUpMoney(value) {
    return Math.ceil(numberOr(value));
  }

  function filamentCostPerGram(filament) {
    const initialWeight = Math.max(0, numberOr(filament?.initialWeightGrams, 1000));
    const rollCost = Math.max(0, numberOr(filament?.rollCost));
    return initialWeight > 0 ? rollCost / initialWeight : 0;
  }

  function findBestFilament(material, color) {
    const key = filamentKey(material, color);
    const same = state.filaments.filter((f) => f.active !== false && filamentKey(f.material, f.color) === key);
    if (!same.length) return null;
    const withCost = same.find((f) => filamentCostPerGram(f) > 0);
    return withCost || same[0];
  }

  function calculatePricing(product) {
    const settings = state.settings || defaultSettings();
    const recipe = product.recipe || {};
    const filament = findBestFilament(recipe.material, recipe.color);
    const gramsEach = gramsPerUnitWithWaste(product);
    const costPerGram = filamentCostPerGram(filament);
    const filamentCost = gramsEach * costPerGram;
    const energyCost = (Math.max(0, numberOr(recipe.printerPowerWatts, 350)) / 1000)
      * (Math.max(0, numberOr(recipe.printTimeMinutes)) / 60)
      * Math.max(0, numberOr(settings.electricityCostKwh, 1.14));
    const packagingCost = Math.max(0, numberOr(recipe.packagingCost));
    const extraCost = Math.max(0, numberOr(recipe.extraCost));
    const directCost = filamentCost + energyCost + packagingCost + extraCost;
    const fixedRatio = Math.max(0, numberOr(settings.expectedMonthlyRevenue)) > 0
      ? Math.max(0, numberOr(settings.fixedMonthlyCosts)) / Math.max(1, numberOr(settings.expectedMonthlyRevenue))
      : 0;
    const indirectCost = directCost * fixedRatio;
    const failureCost = (directCost + indirectCost) * (Math.max(0, numberOr(settings.failurePercent, 10)) / 100);
    const totalCost = directCost + indirectCost + failureCost;
    const markup = Math.max(0, numberOr(settings.defaultMarkup, 2.5));
    const suggestedClientPrice = roundUpMoney(totalCost * markup);
    const shopeeFeePercent = Math.max(0, numberOr(settings.shopeeFeePercent, 20)) / 100;
    const shopeeFixedFee = Math.max(0, numberOr(settings.shopeeFixedFee));
    const suggestedShopeePrice = roundUpMoney((suggestedClientPrice * shopeeFeePercent) + suggestedClientPrice + shopeeFixedFee);
    const currentPrice = Math.max(0, numberOr(product.salePrice));
    const shopeeNetAtCurrent = currentPrice - (currentPrice * shopeeFeePercent) - shopeeFixedFee;
    const profitAtCurrent = shopeeNetAtCurrent - totalCost;
    const profitAtSuggested = suggestedShopeePrice - (suggestedShopeePrice * shopeeFeePercent) - shopeeFixedFee - totalCost;
    return {
      filament,
      gramsEach,
      costPerGram,
      filamentCost,
      energyCost,
      packagingCost,
      extraCost,
      directCost,
      indirectCost,
      failureCost,
      totalCost,
      markup,
      suggestedClientPrice,
      suggestedShopeePrice,
      shopeeFeePercent,
      shopeeFixedFee,
      currentPrice,
      profitAtCurrent,
      profitAtSuggested
    };
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

  function buildRecommendations() {
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
      const pricing = calculatePricing(product);
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

      const score = Math.round((dailyVelocity * 14) + Math.max(0, 10 - Math.min(daysOfStockLeft, 10)) * 7 + Math.max(0, pricing.profitAtSuggested) * 1.5);
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
      if (gramsEach > 0 && (!pricing.filament || pricing.costPerGram <= 0)) {
        alerts.push(`Cadastrar custo do filamento: ${product.name} usa ${recipe.material || '-'} ${recipe.color || ''}, mas o app não encontrou preço por kg/rolo.`);
      }
      if (pricing.currentPrice > 0 && pricing.profitAtCurrent < 0) {
        alerts.push(`Preço atual abaixo do custo: ${product.name} está com lucro negativo estimado de ${formatBRL(pricing.profitAtCurrent)} por unidade.`);
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
        estimatedMargin: pricing.profitAtSuggested,
        estimatedProfit: suggestedUnits * pricing.profitAtSuggested,
        pricing,
        score
      });
    }

    recommendations.sort((a, b) => {
      const rank = { produce: 3, buy_filament: 2, hold: 1 };
      const prio = { Alta: 3, Média: 2, Baixa: 1, 'Comprar filamento': 2 };
      return (rank[b.action] - rank[a.action]) || (prio[b.priority] - prio[a.priority]) || (b.score - a.score);
    });

    return { recommendations, alerts, summary: buildSummary(recommendations, alerts) };
  }

  function buildSummary(rows, alerts) {
    const toProduce = rows.filter((r) => r.action === 'produce');
    const toBuy = rows.filter((r) => r.action === 'buy_filament');
    const totalUnits = toProduce.reduce((sum, r) => sum + r.suggestedUnits, 0);
    const estimatedProfit = toProduce.reduce((sum, r) => sum + r.estimatedProfit, 0);
    if (!rows.length) return 'Cadastre produtos, filamentos e vendas para gerar recomendação.';

    const lines = [];
    if (toProduce.length) {
      lines.push(`Produzir ${totalUnits} peça${totalUnits === 1 ? '' : 's'} agora, com lucro estimado de ${formatBRL(estimatedProfit)} usando a precificação configurada.`);
      lines.push(`Prioridade: ${toProduce.slice(0, 3).map((r) => `${r.productName} (${r.suggestedUnits})`).join(', ')}.`);
    } else {
      lines.push('Nenhum produto precisa ser produzido agora pelas regras atuais.');
    }
    if (toBuy.length) lines.push(`Comprar filamento para: ${toBuy.map((r) => `${r.material || ''} ${r.color || ''}`.trim()).join(', ')}.`);
    if (alerts.length) lines.push(`${alerts.length} alerta${alerts.length === 1 ? '' : 's'} de estoque anunciado na Shopee.`);
    lines.push('Lembrete: o estoque da Shopee não foi usado como estoque real.');
    return lines.join('\n');
  }

  async function loadData() {
    requireLogin();
    setBusy(true, 'Carregando dados...');
    try {
      const [cfgRes, productRes, stockRes, recipeRes, filamentRes, salesRes] = await Promise.all([
        db.from('configuracoes').select('*').eq('user_id', currentUser.id).maybeSingle(),
        db.from('produtos').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
        db.from('estoque_real').select('*').eq('user_id', currentUser.id),
        db.from('receitas_producao').select('*').eq('user_id', currentUser.id),
        db.from('filamentos').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
        db.from('vendas').select('*').eq('user_id', currentUser.id).order('vendido_em', { ascending: false }).limit(500)
      ]);
      if (cfgRes.error && cfgRes.error.code !== 'PGRST116') throw cfgRes.error;
      const productRows = unwrap(productRes) || [];
      const stockRows = unwrap(stockRes) || [];
      const recipeRows = unwrap(recipeRes) || [];
      const filamentRows = unwrap(filamentRes) || [];
      const saleRows = unwrap(salesRes) || [];

      const stockByProduct = new Map(stockRows.map((row) => [row.produto_id, row]));
      const recipeByProduct = new Map(recipeRows.map((row) => [row.produto_id, row]));

      const settings = cfgRes.data ? {
        demandWindowDays: cfgRes.data.dias_analise ?? 7,
        targetCoverageDays: cfgRes.data.dias_cobertura_desejada ?? 10,
        minStockBuffer: cfgRes.data.estoque_minimo_padrao ?? 3,
        shopeeAdvertisedStockLowAlert: cfgRes.data.alerta_estoque_shopee_minimo ?? 5,
        maxBatchUnits: cfgRes.data.maximo_lote_recomendado ?? 60,
        electricityCostKwh: cfgRes.data.custo_kwh ?? 1.14,
        defaultMarkup: cfgRes.data.markup_padrao ?? 2.5,
        shopeeFeePercent: cfgRes.data.taxa_shopee_percentual ?? 20,
        shopeeFixedFee: cfgRes.data.taxa_fixa_shopee ?? 5,
        expectedMonthlyRevenue: cfgRes.data.faturamento_previsto_mensal ?? 2200,
        fixedMonthlyCosts: cfgRes.data.custos_fixos_mensais ?? 0,
        failurePercent: cfgRes.data.percentual_falhas_padrao ?? 10
      } : defaultSettings();

      state = {
        settings: { ...defaultSettings(), ...settings },
        products: productRows.map((p) => {
          const stock = stockByProduct.get(p.id) || {};
          const recipe = recipeByProduct.get(p.id) || {};
          return {
            id: p.id,
            sku: p.sku || '',
            name: p.nome || '',
            category: p.categoria || '',
            shopeeItemId: p.shopee_item_id || '',
            shopeeModelId: p.shopee_model_id || '',
            realStock: numberOr(stock.quantidade_pronta),
            reservedStock: numberOr(stock.quantidade_reservada),
            shopeeAdvertisedStock: numberOr(p.estoque_anunciado_shopee),
            salePrice: numberOr(p.preco_venda),
            estimatedMargin: numberOr(p.margem_estimada),
            active: p.ativo !== false,
            recipe: {
              id: recipe.id,
              material: recipe.material || '',
              color: recipe.cor || '',
              gramsPerUnit: numberOr(recipe.gramas_por_unidade),
              wastePercent: numberOr(recipe.perda_percentual, 10),
              printTimeMinutes: numberOr(recipe.tempo_impressao_minutos),
              printerPowerWatts: numberOr(recipe.potencia_impressora_w, 350),
              packagingCost: numberOr(recipe.custo_embalagem),
              extraCost: numberOr(recipe.custo_extra)
            }
          };
        }),
        filaments: filamentRows.map((f) => ({
          id: f.id,
          material: f.material || '',
          color: f.cor || '',
          brand: f.marca || '',
          currentWeightGrams: numberOr(f.peso_atual_g),
          initialWeightGrams: numberOr(f.peso_inicial_g, 1000),
          rollCost: numberOr(f.custo_rolo),
          active: f.ativo !== false
        })),
        sales: saleRows.map((s) => ({
          id: s.id,
          sku: s.sku || '',
          quantity: numberOr(s.quantidade, 1),
          price: numberOr(s.preco_unitario),
          grossValue: numberOr(s.valor_bruto),
          marketplaceFee: numberOr(s.taxa_shopee),
          netValue: numberOr(s.valor_liquido),
          soldAt: toDateInput(s.vendido_em),
          origin: s.origem || 'manual'
        })),
        recommendations: [],
        alerts: [],
        lastSummary: ''
      };
      render();
    } finally {
      setBusy(false);
    }
  }

  async function ensureSettings() {
    const payload = {
      user_id: currentUser.id,
      dias_analise: Math.max(1, Math.round(numberOr(state.settings.demandWindowDays, 7))),
      dias_cobertura_desejada: Math.max(1, Math.round(numberOr(state.settings.targetCoverageDays, 10))),
      estoque_minimo_padrao: Math.max(0, Math.round(numberOr(state.settings.minStockBuffer, 3))),
      alerta_estoque_shopee_minimo: Math.max(0, Math.round(numberOr(state.settings.shopeeAdvertisedStockLowAlert, 5))),
      maximo_lote_recomendado: Math.max(1, Math.round(numberOr(state.settings.maxBatchUnits, 60))),
      custo_kwh: Math.max(0, numberOr(state.settings.electricityCostKwh, 1.14)),
      markup_padrao: Math.max(0, numberOr(state.settings.defaultMarkup, 2.5)),
      taxa_shopee_percentual: Math.max(0, numberOr(state.settings.shopeeFeePercent, 20)),
      taxa_fixa_shopee: Math.max(0, numberOr(state.settings.shopeeFixedFee, 5)),
      faturamento_previsto_mensal: Math.max(0, numberOr(state.settings.expectedMonthlyRevenue, 2200)),
      custos_fixos_mensais: Math.max(0, numberOr(state.settings.fixedMonthlyCosts, 0)),
      percentual_falhas_padrao: Math.max(0, numberOr(state.settings.failurePercent, 10))
    };
    unwrap(await db.from('configuracoes').upsert(payload, { onConflict: 'user_id' }));
  }

  async function upsertProductRemote(data, id = null) {
    requireLogin();
    const sku = normalizeKey(data.sku);
    const name = String(data.name || '').trim();
    if (!sku || !name) throw new Error('Preencha SKU e nome do produto.');

    const productPayload = {
      user_id: currentUser.id,
      sku,
      nome: name,
      categoria: String(data.category || '').trim() || null,
      preco_venda: Math.max(0, numberOr(data.salePrice)),
      margem_estimada: Math.max(0, numberOr(data.estimatedMargin)),
      estoque_anunciado_shopee: Math.max(0, Math.round(numberOr(data.shopeeAdvertisedStock))),
      ativo: true
    };

    let productId = id;
    if (productId) {
      unwrap(await db.from('produtos').update(productPayload).eq('id', productId).eq('user_id', currentUser.id));
    } else {
      const existing = state.products.find((p) => normalizeKey(p.sku) === sku);
      if (existing?.id) {
        productId = existing.id;
        unwrap(await db.from('produtos').update(productPayload).eq('id', productId).eq('user_id', currentUser.id));
      } else {
        const created = unwrap(await db.from('produtos').insert(productPayload).select('id').single());
        productId = created.id;
      }
    }

    unwrap(await db.from('estoque_real').upsert({
      user_id: currentUser.id,
      produto_id: productId,
      quantidade_pronta: Math.max(0, Math.round(numberOr(data.realStock))),
      quantidade_reservada: 0
    }, { onConflict: 'user_id,produto_id' }));

    unwrap(await db.from('receitas_producao').upsert({
      user_id: currentUser.id,
      produto_id: productId,
      material: String(data.material || '').trim() || 'PLA',
      cor: String(data.color || '').trim() || 'Sem cor',
      gramas_por_unidade: Math.max(0, numberOr(data.gramsPerUnit)),
      perda_percentual: Math.max(0, numberOr(data.wastePercent, 10)),
      tempo_impressao_minutos: Math.max(0, Math.round(numberOr(data.printTimeMinutes))),
      potencia_impressora_w: Math.max(0, numberOr(data.printerPowerWatts, 350)),
      custo_embalagem: Math.max(0, numberOr(data.packagingCost)),
      custo_extra: Math.max(0, numberOr(data.extraCost)),
      ativo: true
    }, { onConflict: 'user_id,produto_id' }));
  }

  async function deleteProductRemote(id) {
    requireLogin();
    unwrap(await db.from('produtos').delete().eq('id', id).eq('user_id', currentUser.id));
  }

  async function upsertFilamentRemote(data, id = null) {
    requireLogin();
    const material = String(data.material || '').trim();
    const color = String(data.color || '').trim();
    if (!material || !color) throw new Error('Preencha material e cor.');
    const payload = {
      user_id: currentUser.id,
      material,
      cor: color,
      marca: String(data.brand || '').trim() || null,
      peso_inicial_g: Math.max(0, numberOr(data.initialWeightGrams, 1000)),
      peso_atual_g: Math.max(0, numberOr(data.currentWeightGrams)),
      custo_rolo: Math.max(0, numberOr(data.rollCost)),
      ativo: true
    };
    if (id) unwrap(await db.from('filamentos').update(payload).eq('id', id).eq('user_id', currentUser.id));
    else unwrap(await db.from('filamentos').insert(payload));
  }

  async function deleteFilamentRemote(id) {
    requireLogin();
    unwrap(await db.from('filamentos').delete().eq('id', id).eq('user_id', currentUser.id));
  }

  async function addSaleRemote(data, origin = 'manual') {
    requireLogin();
    const sku = normalizeKey(data.sku);
    const quantity = Math.max(1, Math.round(numberOr(data.quantity, 1)));
    const price = Math.max(0, numberOr(data.price));
    if (!sku) throw new Error('Preencha o SKU da venda.');
    const product = state.products.find((p) => normalizeKey(p.sku) === sku);
    unwrap(await db.from('vendas').insert({
      user_id: currentUser.id,
      origem: origin,
      produto_id: product?.id || null,
      sku,
      nome_produto_snapshot: product?.name || null,
      quantidade: quantity,
      preco_unitario: price,
      valor_bruto: quantity * price,
      valor_liquido: quantity * price,
      status: 'concluido',
      vendido_em: toIsoFromDate(data.soldAt || todayIso())
    }));
  }

  async function deleteSaleRemote(id) {
    requireLogin();
    unwrap(await db.from('vendas').delete().eq('id', id).eq('user_id', currentUser.id));
  }

  async function saveRecommendationsRemote(recommendations) {
    requireLogin();
    await db.from('recomendacoes').delete().eq('user_id', currentUser.id).eq('status', 'pendente');
    const periodEnd = todayIso();
    const periodStartDate = new Date();
    periodStartDate.setDate(periodStartDate.getDate() - Math.max(1, numberOr(state.settings.demandWindowDays, 7)));
    const periodStart = periodStartDate.toISOString().slice(0, 10);
    const rows = recommendations
      .filter((r) => r.productId)
      .map((r) => ({
        user_id: currentUser.id,
        produto_id: r.productId,
        periodo_inicio: periodStart,
        periodo_fim: periodEnd,
        vendas_periodo: Math.round(numberOr(r.recentSales)),
        estoque_real_atual: Math.round(numberOr(r.realStock)),
        quantidade_sugerida: Math.round(numberOr(r.suggestedUnits)),
        filamento_necessario_g: numberOr(r.filamentNeeded),
        filamento_disponivel_g: numberOr(r.availableFilamentBeforeAllocation),
        prioridade: r.priority === 'Alta' ? 'alta' : r.priority === 'Média' ? 'media' : r.action === 'buy_filament' ? 'urgente' : 'baixa',
        motivo: `${r.title}. ${r.reason}`,
        status: 'pendente'
      }));
    if (rows.length) unwrap(await db.from('recomendacoes').insert(rows));
  }

  async function wipeUserData() {
    requireLogin();
    const tables = ['recomendacoes', 'vendas', 'historico_producao', 'movimentacoes_filamento', 'receitas_producao', 'estoque_real', 'produtos', 'filamentos'];
    for (const table of tables) {
      unwrap(await db.from(table).delete().eq('user_id', currentUser.id));
    }
  }

  async function saveDemoDataRemote() {
    requireLogin();
    const demo = demoState();
    state.settings = demo.settings;
    await wipeUserData();
    await ensureSettings();
    for (const filament of demo.filaments) await upsertFilamentRemote(filament);
    await loadData();
    for (const product of demo.products) {
      await upsertProductRemote({
        sku: product.sku,
        name: product.name,
        category: product.category,
        realStock: product.realStock,
        shopeeAdvertisedStock: product.shopeeAdvertisedStock,
        salePrice: product.salePrice,
        estimatedMargin: product.estimatedMargin,
        material: product.recipe.material,
        color: product.recipe.color,
        gramsPerUnit: product.recipe.gramsPerUnit,
        wastePercent: product.recipe.wastePercent,
        printTimeMinutes: product.recipe.printTimeMinutes,
        printerPowerWatts: product.recipe.printerPowerWatts,
        packagingCost: product.recipe.packagingCost,
        extraCost: product.recipe.extraCost
      });
    }
    await loadData();
    for (const sale of demo.sales) await addSaleRemote(sale, 'manual');
    await loadData();
  }

  async function importBackupRemote(imported) {
    requireLogin();
    const data = {
      ...emptyState(),
      ...imported,
      settings: { ...defaultSettings(), ...(imported.settings || {}) },
      products: Array.isArray(imported.products) ? imported.products : [],
      filaments: Array.isArray(imported.filaments) ? imported.filaments : [],
      sales: Array.isArray(imported.sales) ? imported.sales : []
    };
    state.settings = data.settings;
    await wipeUserData();
    await ensureSettings();
    for (const filament of data.filaments) await upsertFilamentRemote(filament);
    await loadData();
    for (const product of data.products) {
      const recipe = product.recipe || {};
      await upsertProductRemote({
        sku: product.sku,
        name: product.name,
        category: product.category,
        realStock: product.realStock,
        shopeeAdvertisedStock: product.shopeeAdvertisedStock,
        salePrice: product.salePrice,
        estimatedMargin: product.estimatedMargin,
        material: recipe.material,
        color: recipe.color,
        gramsPerUnit: recipe.gramsPerUnit,
        wastePercent: recipe.wastePercent,
        printTimeMinutes: recipe.printTimeMinutes,
        printerPowerWatts: recipe.printerPowerWatts,
        packagingCost: recipe.packagingCost,
        extraCost: recipe.extraCost
      });
    }
    await loadData();
    for (const sale of data.sales) await addSaleRemote(sale, sale.origin || 'manual');
    await loadData();
  }

  async function runRecommendations() {
    try {
      requireLogin();
      const result = buildRecommendations();
      state.recommendations = result.recommendations;
      state.alerts = result.alerts;
      state.lastSummary = result.summary;
      render();
      setBusy(true, 'Salvando recomendação...');
      await saveRecommendationsRemote(state.recommendations);
      toast('Recomendação gerada e salva.');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  function render() {
    renderAuthState();
    if (!currentUser) return;
    renderMetrics();
    renderRecommendations();
    renderProducts();
    renderFilaments();
    renderSales();
    renderSettings();
  }

  function renderAuthState() {
    const auth = $('#authSection');
    const shell = $('#appShell');
    const email = $('#userEmail');
    const sync = $('#syncStatus');
    if (auth) auth.hidden = Boolean(currentUser);
    if (shell) shell.hidden = !currentUser;
    if (email) email.textContent = currentUser?.email || '';
    if (sync) sync.textContent = currentUser ? 'Dados salvos no Supabase' : 'Faça login para usar';
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
          <span>Custo unid. ${formatBRL(r.pricing?.totalCost)}</span>
          <span>Preço Shopee sugerido ${formatBRL(r.pricing?.suggestedShopeePrice)}</span>
          <span>Lucro estimado ${formatBRL(r.estimatedProfit)}</span>
        </div>
      </article>
    `).join('') : '<p class="empty-state">Nenhuma recomendação gerada ainda.</p>';

    $('#alerts').innerHTML = state.alerts.length ? state.alerts.map((a) => `<div class="alert-item">${escapeHtml(a)}</div>`).join('') : '';
  }

  function renderProducts() {
    const list = $('#productList');
    list.innerHTML = state.products.length ? state.products.map((p) => {
      const pricing = calculatePricing(p);
      return `
      <article class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(p.name)}</div>
          <div class="item-sub">
            SKU ${escapeHtml(p.sku)} · Real: ${formatNumber(p.realStock)} · Anunciado Shopee: ${formatNumber(p.shopeeAdvertisedStock)}<br />
            ${escapeHtml(p.recipe?.material || '-')} ${escapeHtml(p.recipe?.color || '')} · ${formatGrams(p.recipe?.gramsPerUnit)} + ${formatNumber(p.recipe?.wastePercent, 1)}% perda · ${formatBRL(p.salePrice)} atual<br />
            Custo unid.: ${formatBRL(pricing.totalCost)} · Cliente: ${formatBRL(pricing.suggestedClientPrice)} · Shopee sugerido: ${formatBRL(pricing.suggestedShopeePrice)} · Lucro no preço atual: ${formatBRL(pricing.profitAtCurrent)}
          </div>
        </div>
        <div class="item-actions">
          <button class="link-button" data-action="edit-product" data-id="${escapeHtml(p.id)}" type="button">Editar</button>
          <button class="link-button danger" data-action="delete-product" data-id="${escapeHtml(p.id)}" type="button">Excluir</button>
        </div>
      </article>`;
    }).join('') : '<p class="empty-state">Nenhum produto cadastrado.</p>';
  }

  function renderFilaments() {
    const list = $('#filamentList');
    list.innerHTML = state.filaments.length ? state.filaments.map((f) => `
      <article class="item">
        <div class="item-main">
          <div class="item-title">${escapeHtml(f.material)} ${escapeHtml(f.color)}</div>
          <div class="item-sub">${escapeHtml(f.brand || 'Sem marca')} · Disponível: ${formatGrams(f.currentWeightGrams)} · Rolo: ${formatGrams(f.initialWeightGrams)} por ${formatBRL(f.rollCost)} · ${formatBRL(filamentCostPerGram(f) * 1000)}/kg</div>
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
          <div class="item-sub">${formatNumber(s.quantity)} unid. · ${formatBRL(s.price)} cada · ${escapeHtml(s.soldAt || '-')} · ${escapeHtml(s.origin || 'manual')}</div>
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
    form.printerPowerWatts.value = product.recipe?.printerPowerWatts || 350;
    form.packagingCost.value = product.recipe?.packagingCost || 0;
    form.extraCost.value = product.recipe?.extraCost || 0;
    form.querySelector('button[type="submit"]').textContent = 'Atualizar produto';
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function fillFilamentForm(filament) {
    const form = $('#filamentForm');
    form.dataset.editId = filament.id;
    form.material.value = filament.material || '';
    form.color.value = filament.color || '';
    form.brand.value = filament.brand || '';
    form.initialWeightGrams.value = filament.initialWeightGrams || 1000;
    form.currentWeightGrams.value = filament.currentWeightGrams || 0;
    form.rollCost.value = filament.rollCost || 0;
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

  async function importSalesJson() {
    const raw = $('#salesJson').value.trim();
    if (!raw) throw new Error('Cole o JSON de vendas antes de importar.');
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) throw new Error('O JSON precisa ser uma lista.');
    setBusy(true, 'Importando vendas...');
    for (const row of rows) await addSaleRemote(row, row.origin || 'manual');
    $('#salesJson').value = '';
    await loadData();
    toast(`${rows.length} venda(s) importada(s).`);
  }

  async function simulateShopeePull() {
    if (!state.products.length) return toast('Cadastre produtos antes de simular vendas.');
    setBusy(true, 'Simulando vendas...');
    try {
      const samples = state.products.slice(0, 4).map((p) => ({
        sku: p.sku,
        quantity: Math.floor(Math.random() * 4) + 1,
        price: numberOr(p.salePrice),
        soldAt: daysAgo(Math.floor(Math.random() * Math.max(1, numberOr(state.settings.demandWindowDays))))
      }));
      for (const sale of samples) await addSaleRemote(sale, 'shopee');
      await loadData();
      toast('Vendas simuladas adicionadas no Supabase.');
    } finally {
      setBusy(false);
    }
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
    reader.onload = async () => {
      try {
        const imported = JSON.parse(String(reader.result || '{}'));
        if (!confirm('Isso substitui os dados do seu usuário no Supabase pelos dados do backup. Continuar?')) return;
        setBusy(true, 'Importando backup...');
        await importBackupRemote(imported);
        toast('Backup importado para o Supabase.');
      } catch (error) {
        handleError(error, 'Erro ao importar backup.');
      } finally {
        setBusy(false);
      }
    };
    reader.readAsText(file);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!hasSupabaseConfig) return toast('Supabase não foi configurado corretamente.');
    const form = event.currentTarget;
    const data = formToObject(form);
    const intent = event.submitter?.dataset.intent || 'login';
    const email = String(data.email || '').trim();
    const password = String(data.password || '');
    if (!email || !password) return toast('Preencha e-mail e senha.');
    setBusy(true, intent === 'signup' ? 'Criando conta...' : 'Entrando...');
    try {
      const response = intent === 'signup'
        ? await db.auth.signUp({ email, password })
        : await db.auth.signInWithPassword({ email, password });
      if (response.error) throw response.error;
      if (intent === 'signup' && !response.data.session) {
        toast('Conta criada. Confirme o e-mail se o Supabase pedir, depois entre.');
      } else {
        currentUser = response.data.user || response.data.session?.user || null;
        await loadData();
        toast('Login feito.');
      }
    } catch (error) {
      handleError(error, 'Erro de autenticação.');
    } finally {
      setBusy(false);
      renderAuthState();
    }
  }

  async function logout() {
    try {
      setBusy(true, 'Saindo...');
      await db.auth.signOut();
      currentUser = null;
      state = emptyState();
      renderAuthState();
      toast('Você saiu da conta.');
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    $('#authForm')?.addEventListener('submit', handleAuthSubmit);
    $('#logoutBtn')?.addEventListener('click', logout);
    $('#refreshBtn')?.addEventListener('click', async () => {
      try { await loadData(); toast('Dados atualizados.'); } catch (error) { handleError(error); }
    });

    $('#runBtn').addEventListener('click', runRecommendations);
    $('#seedBtn').addEventListener('click', async () => {
      if (!confirm('Isso substitui seus dados atuais no Supabase pelos dados de exemplo. Continuar?')) return;
      try {
        setBusy(true, 'Criando dados de exemplo...');
        await saveDemoDataRemote();
        toast('Dados de exemplo carregados.');
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
      }
    });
    $('#exportBtn').addEventListener('click', exportBackup);
    $('#importBackupInput').addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) importBackup(file);
      event.target.value = '';
    });
    $('#mockShopeeBtn').addEventListener('click', () => simulateShopeePull().catch(handleError));
    $('#importSalesBtn').addEventListener('click', () => importSalesJson().catch(handleError));

    $('#productForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const form = event.currentTarget;
        setBusy(true, 'Salvando produto...');
        await upsertProductRemote(formToObject(form), form.dataset.editId || null);
        resetProductForm();
        await loadData();
        toast('Produto salvo no Supabase.');
      } catch (error) { handleError(error); }
      finally { setBusy(false); }
    });

    $('#filamentForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const form = event.currentTarget;
        setBusy(true, 'Salvando filamento...');
        await upsertFilamentRemote(formToObject(form), form.dataset.editId || null);
        resetFilamentForm();
        await loadData();
        toast('Filamento salvo no Supabase.');
      } catch (error) { handleError(error); }
      finally { setBusy(false); }
    });

    $('#saleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        setBusy(true, 'Salvando venda...');
        await addSaleRemote(formToObject(event.currentTarget), 'manual');
        event.currentTarget.reset();
        await loadData();
        toast('Venda adicionada no Supabase.');
      } catch (error) { handleError(error); }
      finally { setBusy(false); }
    });

    $('#settingsForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = formToObject(event.currentTarget);
        state.settings = {
          demandWindowDays: Math.max(1, Math.round(numberOr(data.demandWindowDays, 7))),
          targetCoverageDays: Math.max(1, Math.round(numberOr(data.targetCoverageDays, 10))),
          minStockBuffer: Math.max(0, Math.round(numberOr(data.minStockBuffer, 3))),
          shopeeAdvertisedStockLowAlert: Math.max(0, Math.round(numberOr(data.shopeeAdvertisedStockLowAlert, 5))),
          maxBatchUnits: Math.max(1, Math.round(numberOr(data.maxBatchUnits, 60))),
          electricityCostKwh: Math.max(0, numberOr(data.electricityCostKwh, 1.14)),
          defaultMarkup: Math.max(0, numberOr(data.defaultMarkup, 2.5)),
          shopeeFeePercent: Math.max(0, numberOr(data.shopeeFeePercent, 20)),
          shopeeFixedFee: Math.max(0, numberOr(data.shopeeFixedFee, 5)),
          expectedMonthlyRevenue: Math.max(0, numberOr(data.expectedMonthlyRevenue, 2200)),
          fixedMonthlyCosts: Math.max(0, numberOr(data.fixedMonthlyCosts, 0)),
          failurePercent: Math.max(0, numberOr(data.failurePercent, 10))
        };
        state.recommendations = [];
        state.lastSummary = '';
        setBusy(true, 'Salvando regras...');
        await ensureSettings();
        await loadData();
        toast('Regras salvas no Supabase.');
      } catch (error) { handleError(error); }
      finally { setBusy(false); }
    });

    document.body.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-action]');
      if (!button || isBusy) return;
      const action = button.dataset.action;
      const id = button.dataset.id;
      try {
        if (action === 'edit-product') {
          const product = state.products.find((p) => p.id === id);
          if (product) fillProductForm(product);
        }
        if (action === 'delete-product') {
          const product = state.products.find((p) => p.id === id);
          if (product && confirm(`Excluir produto "${product.name}"?`)) {
            setBusy(true, 'Excluindo produto...');
            await deleteProductRemote(id);
            await loadData();
            toast('Produto excluído.');
          }
        }
        if (action === 'edit-filament') {
          const filament = state.filaments.find((f) => f.id === id);
          if (filament) fillFilamentForm(filament);
        }
        if (action === 'delete-filament') {
          const filament = state.filaments.find((f) => f.id === id);
          if (filament && confirm(`Excluir filamento "${filament.material} ${filament.color}"?`)) {
            setBusy(true, 'Excluindo filamento...');
            await deleteFilamentRemote(id);
            await loadData();
            toast('Filamento excluído.');
          }
        }
        if (action === 'delete-sale') {
          setBusy(true, 'Excluindo venda...');
          await deleteSaleRemote(id);
          await loadData();
          toast('Venda excluída.');
        }
      } catch (error) {
        handleError(error);
      } finally {
        setBusy(false);
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

  async function init() {
    bindEvents();
    setupInstallPrompt();
    registerServiceWorker();
    if (!hasSupabaseConfig) {
      renderAuthState();
      $('#authMessage').textContent = 'Supabase não foi carregado. Confira o arquivo config/supabase-config.js e sua conexão.';
      return;
    }

    db.auth.onAuthStateChange(async (_event, session) => {
      currentUser = session?.user || null;
      if (currentUser) {
        try { await loadData(); } catch (error) { handleError(error, 'Erro ao carregar dados.'); }
      } else {
        state = emptyState();
        renderAuthState();
      }
    });

    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      currentUser = data.session?.user || null;
      if (currentUser) await loadData();
      else renderAuthState();
    } catch (error) {
      handleError(error, 'Erro ao iniciar app.');
      renderAuthState();
    }
  }

  init();
})();
