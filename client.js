/**
 * dsh-ccusage 的 Web 客户端。
 *
 * 不经过构建：由 DSH 的 ModuleLoader 直接执行，唯一外部依赖是 shell 提供的 react。
 * UI 目标是在 DSH 主面板里复刻 `ccusage daily|weekly|monthly|session|blocks` 的信息，
 * 并加上筛选、图表和 model 明细。
 */

window.__ModuleLoader__.load({
  id: 'dsh-ccusage',
  factory(require) {
    const module = { exports: {} }
    const React = require('react')
    const {
      createElement: h,
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
    } = React

    const NS = 'dsh-ccusage'
    const PANEL_ID = 'ccusage'
    const API = '/api/dsh-ccusage'
    const SOURCE_LIST = ['claude', 'codex', 'opencode', 'kimi', 'grok', 'pi', 'dsh']

    const messages = {
      zh: {
        nav: 'CCUsage 用量',
        title: '用量概览',
        subtitle: '跨工具追踪 Token 与缓存效率',
        refresh: '刷新',
        refreshing: '刷新中…',
        cost: '费用',
        tokens: 'Token',
        totalTokens: '总 Token',
        input: '输入',
        output: '输出',
        cacheRead: '缓存读',
        cacheWrite: '缓存写',
        sessions: '会话',
        dailyTokens: '每日 Token',
        chartHint: '最近 30 天',
        peak: '最高',
        daily: '按天',
        weekly: '按周',
        monthly: '按月',
        session: '会话',
        blocks: '5 小时块',
        today: '今天',
        days7: '近 7 天',
        days30: '近 30 天',
        thisMonth: '本月',
        allTime: '全部',
        auto: '自动',
        calculate: '按 Token',
        display: '日志价',
        date: '日期',
        week: '周起始',
        month: '月份',
        models: '模型',
        agent: '来源',
        allSources: '全部',
        lastActivity: '最后活动',
        active: '进行中',
        gap: '空档',
        window: '窗口',
        burnRate: '燃尽速率',
        projection: '预计',
        tokensPerMin: 'token/分',
        costPerHour: '$/小时',
        remaining: '剩余',
        minutes: '分钟',
        noData: '这段范围内没有用量记录。',
        loadFailed: '加载失败',
        retry: '重试',
        unpriced: '未定价模型',
        project: '项目',
        projectPlaceholder: '按项目路径过滤…',
        entries: '条记录',
        total: '合计',
        showMore: '显示更多',
        modelBreakdown: '模型明细',
        filters: '筛选',
        emptyBlocks: '还没有 5 小时会话块。',
        blocksNote: '5 小时块只统计 Claude Code 的订阅计费窗口；其它来源不计入。',
        cacheHit: '缓存命中率',
        generated: '生成于',
        timezone: '时区',
        sourceAll: '全部来源',
        costNote: '只统计本地日志里的 Token，不估算费用。',
        loading: '正在扫描本地日志…',
        blockWindow: '{0} → {1}',
        blockTokens: '{0} tokens',
        blockEntries: '{0} 条',
        blockModels: '模型',
        scrollHint: '点击行展开模型明细',
        moreRows: '还有 {0} 行',
        clearFilter: '清除',
        overview: 'USAGE ANALYTICS',
        localOnly: '仅本地分析',
        costMode: '计价方式',
        costTrend: 'Token 趋势',
        sourceDistribution: '来源 Token 占比',
        dailyAverage: '活跃日均',
        activeDays: '活跃天数',
        modelCount: '个模型',
        sourceCount: '个来源',
        blocksCount: '个计费块',
        currentRange: '当前范围',
        noCostData: '当前范围还没有 Token 记录。',
        expand: '展开模型明细',
        collapse: '收起模型明细',
        tableHint: '点击行查看模型明细',
        allTimeShort: '全部时间',
        noCost: '$0.00',
        localData: '数据不会离开本机',

      },
      en: {
        nav: 'CCUsage',
        title: 'Usage overview',
        subtitle: 'Track tokens and cache efficiency across your AI tools',
        refresh: 'Refresh',
        refreshing: 'Refreshing…',
        cost: 'Cost',
        tokens: 'Tokens',
        totalTokens: 'Total Tokens',
        input: 'Input',
        output: 'Output',
        cacheRead: 'Cache read',
        cacheWrite: 'Cache write',
        sessions: 'Sessions',
        dailyTokens: 'Daily tokens',
        chartHint: 'Last 30 days',
        peak: 'peak',
        daily: 'Daily',
        weekly: 'Weekly',
        monthly: 'Monthly',
        session: 'Sessions',
        blocks: '5h blocks',
        today: 'Today',
        days7: 'Last 7 days',
        days30: 'Last 30 days',
        thisMonth: 'This month',
        allTime: 'All time',
        auto: 'Auto',
        calculate: 'From tokens',
        display: 'Logged',
        date: 'Date',
        week: 'Week of',
        month: 'Month',
        models: 'Models',
        agent: 'Source',
        allSources: 'All',
        lastActivity: 'Last activity',
        active: 'Active',
        gap: 'Gap',
        window: 'Window',
        burnRate: 'Burn rate',
        projection: 'Projection',
        tokensPerMin: 'tok/min',
        costPerHour: '$/hour',
        remaining: 'remaining',
        minutes: 'min',
        noData: 'No usage in this range.',
        loadFailed: 'Failed to load',
        retry: 'Retry',
        unpriced: 'Unpriced models',
        project: 'Project',
        projectPlaceholder: 'Filter by project path…',
        entries: 'entries',
        total: 'Total',
        showMore: 'Show more',
        modelBreakdown: 'Model breakdown',
        filters: 'Filters',
        emptyBlocks: 'No 5-hour session blocks yet.',
        blocksNote: '5-hour blocks cover Claude Code subscription windows only; other sources are excluded.',
        cacheHit: 'Cache hit rate',
        generated: 'Generated',
        timezone: 'Timezone',
        sourceAll: 'All sources',
        costNote: 'Counts tokens from local logs only; cost is not estimated.',
        loading: 'Scanning local logs…',
        blockWindow: '{0} → {1}',
        blockTokens: '{0} tokens',
        blockEntries: '{0} entries',
        blockModels: 'Models',
        scrollHint: 'Click a row for model breakdown',
        moreRows: '{0} more rows',
        clearFilter: 'Clear',
        overview: 'USAGE ANALYTICS',
        localOnly: 'Local analysis',
        costMode: 'Cost mode',
        costTrend: 'Token trend',
        sourceDistribution: 'Tokens by source',
        dailyAverage: 'Avg. active day',
        activeDays: 'Active days',
        modelCount: 'models',
        sourceCount: 'sources',
        blocksCount: 'billing blocks',
        currentRange: 'Current range',
        noCostData: 'No token usage in this range yet.',
        expand: 'Expand model breakdown',
        collapse: 'Collapse model breakdown',
        tableHint: 'Select a row for model details',
        allTimeShort: 'All time',
        noCost: '$0.00',
        localData: 'Your data never leaves this device',

      },
    }

    const CSS = `
.ccu-root{--ccu-accent:var(--dsw-alias-state-success-primary,#5eead4);--ccu-text:var(--dsw-alias-label-primary,#edf2ef);--ccu-muted:var(--dsw-alias-label-secondary,#96a19b);--ccu-faint:var(--dsw-alias-label-tertiary,#6f7b75);--ccu-panel:var(--dsw-alias-bg-layer-1,#171b19);--ccu-raised:var(--dsw-alias-bg-layer-2,#1d2320);--ccu-border:var(--dsw-alias-border-l2,#2a322e);position:relative;display:flex;flex:1 1 auto;flex-direction:column;align-self:stretch;gap:18px;width:100%;max-width:1680px;min-height:0;height:100%;max-height:100%;max-height:calc(100dvh - 44px);margin:0 auto;padding:26px clamp(16px,2.4vw,36px) 32px;box-sizing:border-box;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;scrollbar-width:thin;color:var(--ccu-text);font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:13px;line-height:1.5}
.ccu-root *{box-sizing:border-box}
.ccu-root > *{flex-shrink:0}
.ccu-root button,.ccu-root input,.ccu-root select{font:inherit}
.ccu-root button:focus-visible,.ccu-root input:focus-visible,.ccu-root select:focus-visible,.ccu-root tr:focus-visible{outline:2px solid var(--ccu-accent);outline-offset:2px}
.ccu-head{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 2px}
.ccu-brand{display:flex;align-items:center;gap:13px;min-width:0}
.ccu-brand-mark{display:grid;place-items:center;flex:0 0 44px;width:44px;height:44px;border:1px solid color-mix(in srgb,var(--ccu-accent) 28%,transparent);border-radius:13px;color:var(--ccu-accent);background:linear-gradient(145deg,color-mix(in srgb,var(--ccu-accent) 15%,transparent),color-mix(in srgb,var(--ccu-accent) 3%,transparent));box-shadow:0 8px 28px color-mix(in srgb,var(--ccu-accent) 7%,transparent)}
.ccu-brand-mark svg{width:23px;height:23px}
.ccu-eyebrow{margin-bottom:1px;color:var(--ccu-accent);font-size:9px;font-weight:750;letter-spacing:1.8px}
.ccu-title{margin:0;font-size:25px;font-weight:680;line-height:1.25;letter-spacing:-.5px}
.ccu-sub{margin-top:4px;color:var(--ccu-muted);font-size:12px;font-weight:400}
.ccu-local-badge{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid var(--ccu-border);border-radius:999px;color:var(--ccu-muted);background:color-mix(in srgb,var(--ccu-panel) 82%,transparent);font-size:11px;white-space:nowrap}
.ccu-local-badge svg{color:var(--ccu-accent)}
.ccu-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px;border:1px solid var(--ccu-border);border-radius:13px;background:var(--ccu-panel);box-shadow:0 1px 0 color-mix(in srgb,var(--ccu-text) 2%,transparent)}
.ccu-seg{display:inline-flex;align-items:center;gap:2px;max-width:100%;overflow-x:auto;border-radius:9px;background:color-mix(in srgb,var(--ccu-text) 3%,transparent);scrollbar-width:none}
.ccu-seg::-webkit-scrollbar{display:none}
.ccu-seg button{min-height:32px;padding:6px 12px;border:0;border-radius:7px;background:transparent;color:var(--ccu-muted);font-size:12px;line-height:1.2;white-space:nowrap;cursor:pointer;transition:background .16s,color .16s}
.ccu-seg button:hover{color:var(--ccu-text)}
.ccu-seg button.on{color:var(--ccu-text);background:var(--ccu-raised);box-shadow:0 1px 4px #0003,0 0 0 1px var(--ccu-border);font-weight:600}
.ccu-toolbar-right{display:flex;align-items:center;gap:8px}
.ccu-select-wrap{display:flex;align-items:center;gap:7px;padding-left:8px;color:var(--ccu-faint);font-size:11px;white-space:nowrap}
.ccu-input{min-width:0;padding:7px 10px;border:1px solid var(--ccu-border);border-radius:8px;outline:none;color:var(--ccu-text);background:var(--ccu-raised);font-size:12px;transition:border-color .16s,box-shadow .16s}
.ccu-input:hover{border-color:var(--dsw-alias-border-l3,#46524b)}
.ccu-input:focus{border-color:color-mix(in srgb,var(--ccu-accent) 55%,transparent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ccu-accent) 8%,transparent)}
.ccu-select{min-width:108px;cursor:pointer}
.ccu-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:7px 11px;border:1px solid var(--ccu-border);border-radius:8px;color:var(--ccu-text);background:var(--ccu-raised);font-size:12px;font-weight:550;white-space:nowrap;cursor:pointer;transition:border-color .16s,background .16s}
.ccu-btn:hover{border-color:var(--dsw-alias-border-l3,#526058);background:color-mix(in srgb,var(--ccu-raised) 88%,var(--ccu-text))}
.ccu-btn.primary{border-color:color-mix(in srgb,var(--ccu-accent) 55%,transparent);color:#102019;background:var(--ccu-accent)}
.ccu-btn.primary:hover{background:color-mix(in srgb,var(--ccu-accent) 88%,#fff)}
.ccu-btn:disabled{opacity:.55;cursor:wait}
.ccu-refreshing svg{animation:ccu-spin .9s linear infinite}
@keyframes ccu-spin{to{transform:rotate(360deg)}}
.ccu-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.ccu-card{position:relative;min-width:0;overflow:hidden;padding:17px 18px 16px;border:1px solid var(--ccu-border);border-radius:14px;background:linear-gradient(145deg,color-mix(in srgb,var(--ccu-raised) 92%,transparent),var(--ccu-panel));box-shadow:0 8px 24px #0000000a}
.ccu-card:after{position:absolute;top:-44px;right:-38px;width:110px;height:110px;border-radius:50%;background:var(--ccu-card-color,var(--ccu-accent));opacity:.035;content:"";pointer-events:none}
.ccu-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.ccu-card .k{color:var(--ccu-muted);font-size:11px;font-weight:550;letter-spacing:.15px}
.ccu-card-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:8px;color:var(--ccu-card-color,var(--ccu-accent));background:color-mix(in srgb,var(--ccu-card-color,var(--ccu-accent)) 10%,transparent)}
.ccu-card.blue{--ccu-card-color:#7dd3fc}.ccu-card.violet{--ccu-card-color:#c4b5fd}.ccu-card.amber{--ccu-card-color:#fbbf24}
.ccu-card .v{margin-top:10px;overflow:hidden;color:var(--ccu-text);font-size:clamp(23px,2vw,29px);font-weight:680;line-height:1.2;letter-spacing:-.7px;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.ccu-card .s{min-height:18px;margin-top:6px;overflow:hidden;color:var(--ccu-faint);font-size:11px;text-overflow:ellipsis;white-space:nowrap}
.ccu-card .s strong{color:var(--ccu-muted);font-weight:550}
.ccu-mini-progress{height:3px;margin-top:10px;overflow:hidden;border-radius:999px;background:color-mix(in srgb,var(--ccu-text) 7%,transparent)}
.ccu-mini-progress span{display:block;height:100%;border-radius:inherit;background:var(--ccu-card-color,var(--ccu-accent))}
.ccu-overview-grid{display:grid;grid-template-columns:minmax(0,1.85fr) minmax(290px,.85fr);gap:14px}
.ccu-panel{min-width:0;border:1px solid var(--ccu-border);border-radius:14px;background:var(--ccu-panel);box-shadow:0 8px 28px #00000008}
.ccu-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ccu-panel-title{color:var(--ccu-text);font-size:13px;font-weight:650;letter-spacing:.05px}
.ccu-panel-kicker{margin-top:2px;color:var(--ccu-faint);font-size:10.5px}
.ccu-range-pill{display:inline-flex;align-items:center;padding:3px 8px;border:1px solid var(--ccu-border);border-radius:999px;color:var(--ccu-muted);background:color-mix(in srgb,var(--ccu-text) 2%,transparent);font-size:10px;white-space:nowrap}
.ccu-chart{padding:17px 18px 13px}
.ccu-chart-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ccu-chart-value{text-align:right;font-variant-numeric:tabular-nums}
.ccu-chart-value b{display:block;color:var(--ccu-text);font-size:16px;font-weight:650}
.ccu-chart-value span{display:block;margin-top:1px;color:var(--ccu-faint);font-size:10px}
.ccu-chart-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
.ccu-chart-svg{display:block;width:100%;height:auto;margin-top:4px;overflow:visible}
.ccu-chart-svg text{fill:var(--ccu-faint);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px}
.ccu-chart-grid{stroke:var(--ccu-border);stroke-width:1;stroke-dasharray:3 5;opacity:.65}
.ccu-chart-hit{fill:transparent;cursor:crosshair}
.ccu-chart-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;border-top:1px solid color-mix(in srgb,var(--ccu-border) 65%,transparent);color:var(--ccu-faint);font-size:10px}
.ccu-chart-legend{display:inline-flex;align-items:center;gap:6px}
.ccu-chart-legend:before{width:14px;height:2px;border-radius:2px;background:var(--ccu-accent);content:""}
.ccu-chart-empty{display:grid;place-items:center;min-height:220px;color:var(--ccu-faint)}
.ccu-distribution{display:flex;flex-direction:column;padding:17px 18px}
.ccu-distribution-body{display:flex;flex:1;flex-direction:column;justify-content:center;gap:16px;padding-top:14px}
.ccu-donut-wrap{position:relative;flex:0 0 132px;width:132px;height:132px;margin:0 auto}
.ccu-donut-wrap svg{display:block;width:100%;height:100%;transform:rotate(0deg)}
.ccu-donut-center{position:absolute;inset:25px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.ccu-donut-center b{max-width:100%;overflow:hidden;color:var(--ccu-text);font-size:16px;font-weight:680;font-variant-numeric:tabular-nums;text-overflow:ellipsis;white-space:nowrap}
.ccu-donut-center span{margin-top:1px;color:var(--ccu-faint);font-size:9px}
.ccu-source-legend{display:flex;flex-direction:column;gap:8px}
.ccu-source-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;font-size:11px}
.ccu-source-row .ccu-source{min-width:0;overflow:hidden;text-overflow:ellipsis}
.ccu-source-share{color:var(--ccu-faint);font-variant-numeric:tabular-nums}
.ccu-source-cost{min-width:52px;color:var(--ccu-muted);font-weight:550;text-align:right;font-variant-numeric:tabular-nums}
.ccu-dot{display:inline-block;flex:0 0 6px;width:6px;height:6px;border-radius:50%}
.ccu-source{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.ccu-data-panel{overflow:visible}
.ccu-data-head{display:flex;align-items:center;min-height:50px;border-bottom:1px solid var(--ccu-border)}
.ccu-tabs{display:flex;align-items:stretch;gap:3px;min-width:0;padding:0 14px;overflow-x:auto;scrollbar-width:none}
.ccu-tabs::-webkit-scrollbar{display:none}
.ccu-tabs button{display:inline-flex;align-items:center;gap:6px;margin-bottom:-1px;padding:16px 11px 14px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--ccu-muted);font-size:12px;white-space:nowrap;cursor:pointer}
.ccu-tabs button:hover{color:var(--ccu-text)}
.ccu-tabs button.on{border-bottom-color:var(--ccu-accent);color:var(--ccu-text);font-weight:600}
.ccu-tab-count{display:inline-grid;place-items:center;min-width:18px;height:17px;padding:0 4px;border-radius:5px;color:var(--ccu-faint);background:color-mix(in srgb,var(--ccu-text) 5%,transparent);font-size:9px;font-variant-numeric:tabular-nums}
.ccu-tabs button.on .ccu-tab-count{color:var(--ccu-accent);background:color-mix(in srgb,var(--ccu-accent) 9%,transparent)}
.ccu-data-hint{margin-left:auto;padding:0 18px;color:var(--ccu-faint);font-size:10px;white-space:nowrap}
.ccu-filters{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--ccu-border);background:color-mix(in srgb,var(--ccu-raised) 42%,transparent)}
.ccu-filter-label{display:inline-flex;align-items:center;gap:5px;margin-right:2px;color:var(--ccu-faint);font-size:10px}
.ccu-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--ccu-border);border-radius:7px;background:transparent;color:var(--ccu-muted);font-size:10.5px;line-height:1.4;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.ccu-chip:hover{color:var(--ccu-text);border-color:var(--dsw-alias-border-l3,#4b5750)}
.ccu-chip.on{border-color:color-mix(in srgb,var(--ccu-accent) 35%,var(--ccu-border));color:var(--ccu-text);background:color-mix(in srgb,var(--ccu-accent) 8%,transparent)}
.ccu-chip:not(.on) .ccu-dot{opacity:.35}
.ccu-search{position:relative;margin-left:auto;min-width:190px}
.ccu-search svg{position:absolute;top:50%;left:10px;color:var(--ccu-faint);transform:translateY(-50%);pointer-events:none}
.ccu-search .ccu-input{width:100%;padding:6px 30px 6px 31px;background:var(--ccu-panel)}
.ccu-search-clear{position:absolute;top:50%;right:6px;display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:5px;color:var(--ccu-faint);background:transparent;cursor:pointer;transform:translateY(-50%)}
.ccu-search-clear:hover{color:var(--ccu-text);background:var(--ccu-raised)}
.ccu-data-body{position:relative;min-height:120px;transition:opacity .15s}
.ccu-data-body.is-refreshing{opacity:.62}
.ccu-loading-line{position:absolute;z-index:4;top:0;left:0;width:100%;height:2px;overflow:hidden;background:color-mix(in srgb,var(--ccu-accent) 8%,transparent)}
.ccu-loading-line:after{display:block;width:35%;height:100%;background:var(--ccu-accent);content:"";animation:ccu-load 1.1s ease-in-out infinite}
@keyframes ccu-load{from{transform:translateX(-110%)}to{transform:translateX(310%)}}
.ccu-table-wrap{overflow:visible;background:transparent}
table.ccu-table{width:100%;min-width:850px;border-collapse:collapse;font-size:11.5px}
.ccu-table th,.ccu-table td{padding:11px 13px;border-bottom:1px solid color-mix(in srgb,var(--ccu-border) 68%,transparent);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ccu-table th{color:var(--ccu-faint);background:var(--ccu-panel);font-size:9.5px;font-weight:600;letter-spacing:.45px;text-transform:uppercase}
.ccu-table th:first-child,.ccu-table td:first-child{padding-left:18px}
.ccu-table th:last-child,.ccu-table td:last-child{padding-right:18px}
.ccu-table .ccu-start{text-align:left}
.ccu-table tbody tr{transition:background .12s}
.ccu-table tbody tr:hover{background:color-mix(in srgb,var(--ccu-text) 2.5%,transparent)}
.ccu-table tbody tr.expandable{cursor:pointer}
.ccu-table tbody tr.expanded{background:color-mix(in srgb,var(--ccu-accent) 4%,transparent)}
.ccu-table tbody tr.expanded td{border-bottom-color:color-mix(in srgb,var(--ccu-accent) 15%,var(--ccu-border))}
.ccu-table tfoot td{border-top:1px solid var(--ccu-border);border-bottom:0;color:var(--ccu-text);background:color-mix(in srgb,var(--ccu-raised) 65%,transparent);font-weight:620}
.ccu-table .muted,.muted{color:var(--ccu-faint)}
.ccu-table .mono,.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:10.5px}
.ccu-table .cost-cell{color:var(--ccu-text);font-weight:620}
.ccu-period-cell{display:flex;align-items:center;gap:7px}
.ccu-period-text{display:flex;flex-direction:column;gap:1px}
.ccu-date-year{color:var(--ccu-faint);font-size:9px;font-weight:400}
.ccu-expand{display:grid;place-items:center;flex:0 0 23px;width:23px;height:23px;padding:0;border:0;border-radius:6px;color:var(--ccu-faint);background:transparent;cursor:pointer}
.ccu-expand:hover{color:var(--ccu-accent);background:color-mix(in srgb,var(--ccu-accent) 8%,transparent)}
.ccu-expand svg{transition:transform .16s}
.ccu-expand[aria-expanded="true"] svg{transform:rotate(90deg)}
.ccu-models{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.ccu-model{display:inline-flex;align-items:center;gap:5px;max-width:180px;overflow:hidden;padding:2px 7px;border:1px solid var(--ccu-border);border-radius:6px;color:var(--ccu-muted);background:color-mix(in srgb,var(--ccu-text) 2%,transparent);font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}
.ccu-agentrow td{color:var(--ccu-muted);background:color-mix(in srgb,var(--ccu-raised) 55%,transparent);font-size:11px}
.ccu-agentrow td:nth-child(2){padding-left:27px}
.ccu-agentrow:hover td{background:var(--ccu-raised)}
.ccu-subrow > td{padding:12px 18px 15px 47px;text-align:left;background:color-mix(in srgb,var(--ccu-accent) 3%,var(--ccu-panel));white-space:normal}
.ccu-subtable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:10.5px}
.ccu-table .ccu-subtable th,.ccu-table .ccu-subtable td{padding:6px 10px;border-bottom:1px solid var(--ccu-border);color:var(--ccu-muted);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
.ccu-table .ccu-subtable th{color:var(--ccu-faint);font-size:9px;font-weight:550;text-transform:uppercase}
.ccu-table .ccu-subtable .ccu-sub-name{width:22%;overflow:hidden;color:var(--ccu-text);text-align:left;text-overflow:ellipsis}
.ccu-table .ccu-subtable .ccu-sub-source{width:108px;text-align:left}
.ccu-table .ccu-subtable .ccu-sub-num{width:13%;text-align:right}
.ccu-table .ccu-subtable tr:last-child td{border-bottom:0}
.ccu-subtable-wrap{overflow-x:auto}
.ccu-blocks{display:flex;flex-direction:column;gap:10px;padding:14px}
.ccu-block{display:grid;grid-template-columns:minmax(190px,.65fr) minmax(0,1.35fr);gap:18px;padding:16px;border:1px solid var(--ccu-border);border-radius:11px;background:color-mix(in srgb,var(--ccu-raised) 45%,transparent)}
.ccu-block.active{border-color:color-mix(in srgb,var(--ccu-accent) 45%,var(--ccu-border));background:color-mix(in srgb,var(--ccu-accent) 4%,var(--ccu-panel))}
.ccu-block .time{display:flex;flex-direction:column;gap:4px;color:var(--ccu-text);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}
.ccu-block .time-range{display:flex;align-items:center;gap:7px}
.ccu-block .badge{display:inline-flex;align-items:center;gap:5px;width:max-content;margin-top:3px;padding:2px 7px;border:1px solid var(--ccu-border);border-radius:999px;color:var(--ccu-muted);font-family:inherit;font-size:9px}
.ccu-block .badge.live{border-color:color-mix(in srgb,var(--ccu-accent) 40%,transparent);color:var(--ccu-accent)}
.ccu-block .badge.gap{color:var(--ccu-faint)}
.ccu-block .meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;color:var(--ccu-muted);font-size:10px}
.ccu-block .meta b{display:block;margin-bottom:2px;color:var(--ccu-text);font-size:14px;font-weight:620;font-variant-numeric:tabular-nums}
.ccu-block .proj{margin-top:10px;color:var(--ccu-faint);font-size:10.5px;line-height:1.7}
.ccu-block-models{display:flex;gap:4px;flex-wrap:wrap;margin-top:10px}
.ccu-banner{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 35%,transparent);border-radius:10px;color:var(--ccu-muted);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f59e0b) 7%,transparent);font-size:11px}
.ccu-banner-title{color:var(--dsw-alias-state-warn-primary,#fbbf24);font-weight:600}
.ccu-error{display:flex;align-items:center;gap:10px;padding:11px 13px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 40%,transparent);border-radius:10px;color:var(--ccu-muted);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 7%,transparent);font-size:11px}
.ccu-error .ccu-btn{margin-left:auto}
.ccu-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:180px;padding:32px 16px;color:var(--ccu-faint);text-align:center}
.ccu-empty svg{opacity:.45}
.ccu-loading{padding:36px;color:var(--ccu-faint);text-align:center}
.ccu-skeleton{padding:14px 18px}
.ccu-skeleton-row{display:grid;grid-template-columns:1.2fr .8fr repeat(3,1fr);gap:28px;padding:13px 0;border-bottom:1px solid color-mix(in srgb,var(--ccu-border) 55%,transparent)}
.ccu-skeleton-row span{height:10px;border-radius:5px;background:linear-gradient(90deg,color-mix(in srgb,var(--ccu-text) 4%,transparent),color-mix(in srgb,var(--ccu-text) 8%,transparent),color-mix(in srgb,var(--ccu-text) 4%,transparent));background-size:200% 100%;animation:ccu-shimmer 1.4s linear infinite}
@keyframes ccu-shimmer{to{background-position:-200% 0}}
.ccu-more{display:flex;justify-content:center;padding:12px;border-top:1px solid var(--ccu-border)}
.ccu-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 3px;color:var(--ccu-faint);font-size:10px}
.ccu-foot-status{display:inline-flex;align-items:center;gap:6px}
.ccu-live-dot{width:5px;height:5px;border-radius:50%;background:var(--ccu-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--ccu-accent) 8%,transparent)}
@media(max-width:1100px){.ccu-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.ccu-overview-grid{grid-template-columns:1fr}.ccu-distribution-body{display:grid;grid-template-columns:160px minmax(0,1fr);align-items:center}.ccu-data-hint{display:none}}
@media(max-width:720px){.ccu-root{gap:14px;padding:17px 12px 26px}.ccu-head{align-items:flex-start}.ccu-local-badge{padding:5px 8px}.ccu-local-badge span{display:none}.ccu-brand-mark{flex-basis:38px;width:38px;height:38px}.ccu-title{font-size:22px}.ccu-sub{font-size:11px}.ccu-toolbar{align-items:stretch;flex-direction:column}.ccu-seg{width:100%}.ccu-seg button{flex:1 0 auto}.ccu-toolbar-right{justify-content:space-between}.ccu-select-wrap{flex:1}.ccu-select{flex:1}.ccu-overview-grid{gap:12px}.ccu-chart,.ccu-distribution{padding:14px}.ccu-distribution-body{display:flex}.ccu-data-head{padding:0}.ccu-tabs{width:100%;padding:0 8px}.ccu-tabs button{padding:14px 9px 12px}.ccu-filters{padding:10px}.ccu-filter-label{width:100%}.ccu-search{width:100%;margin-left:0}.ccu-block{grid-template-columns:1fr}.ccu-block .meta{grid-template-columns:repeat(3,minmax(0,1fr))}.ccu-foot{align-items:flex-start;flex-direction:column;gap:5px}}
@media(max-width:600px){.ccu-chart-svg{min-width:540px}}
@media(max-width:440px){.ccu-cards{gap:9px}.ccu-card{padding:14px}.ccu-card .v{font-size:22px}.ccu-card-icon{width:26px;height:26px}.ccu-card .s{font-size:9.5px}.ccu-toolbar-right{align-items:stretch;flex-direction:column}.ccu-select-wrap{padding-left:2px}.ccu-btn.primary{width:100%}}
@media(prefers-reduced-motion:reduce){.ccu-root *{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`

    function useStyles() {
      useEffect(() => {
        const id = 'dsh-ccusage-style'
        let element = document.getElementById(id)
        if (element === null) {
          element = document.createElement('style')
          element.id = id
          document.head.appendChild(element)
        }
        element.textContent = CSS
      }, [])
    }

    // ---------- 格式化 ----------

    function compact(value) {
      if (!Number.isFinite(value) || value === 0) return '0'
      const abs = Math.abs(value)
      const format = (number, digits) => number.toFixed(digits).replace(/\.0+$|(?<=\.[0-9])0+$/, '')
      if (abs >= 1e9) return `${format(value / 1e9, 2)}B`
      if (abs >= 1e6) return `${format(value / 1e6, 2)}M`
      if (abs >= 1e3) return `${format(value / 1e3, 1)}K`
      return String(Math.round(value))
    }

    function exact(value) {
      const number = Math.round(Number(value) || 0)
      return number.toLocaleString('en-US')
    }

    function percent(part, whole) {
      if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '0%'
      const value = (part / whole) * 100
      return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`
    }

    function hhmm(iso, timeZone) {
      if (typeof iso !== 'string' || iso === '') return '—'
      try {
        return new Intl.DateTimeFormat('zh-CN', {
          timeZone,
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      } catch {
        return iso.slice(5, 16).replace('T', ' ')
      }
    }

    function dayLabel(period) {
      if (typeof period !== 'string') return String(period)
      if (/^\d{4}-\d{2}-\d{2}$/.test(period)) return period.slice(5)
      return period
    }

    function hashHue(name) {
      let hash = 0
      for (let index = 0; index < name.length; index += 1) hash = (hash * 31 + name.charCodeAt(index)) % 360
      return hash
    }

    function modelColor(name) {
      return `hsl(${hashHue(name)} 62% 58%)`
    }

    function sourceLabel(agent) {
      if (agent === 'claude') return 'Claude'
      if (agent === 'codex') return 'Codex'
      if (agent === 'opencode') return 'OpenCode'
      if (agent === 'kimi') return 'Kimi'
      if (agent === 'grok') return 'Grok'
      if (agent === 'pi') return 'Pi'
      if (agent === 'dsh') return 'DSH'
      return agent ?? '—'
    }

    const SOURCE_COLORS = {
      claude: '#d97757',
      codex: '#10a37f',
      opencode: '#8b5cf6',
      kimi: '#3b82f6',
      grok: '#eab308',
      pi: '#ec4899',
      dsh: '#22c55e',
    }

    function SourceChip({ agent, detail }) {
      const color = SOURCE_COLORS[agent] ?? 'var(--dsw-alias-label-secondary)'
      return h('span', {
        className: 'ccu-source',
        title: detail ?? sourceLabel(agent),
      },
        h('span', { className: 'ccu-dot', style: { background: color } }),
        sourceLabel(agent))
    }

    function sumRows(rows) {
      const out = {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
      }
      for (const row of rows) {
        out.inputTokens += row.inputTokens ?? 0
        out.outputTokens += row.outputTokens ?? 0
        out.cacheCreationTokens += row.cacheCreationTokens ?? 0
        out.cacheReadTokens += row.cacheReadTokens ?? 0
        out.totalTokens += row.totalTokens ?? 0
      }
      return out
    }

    // ---------- 数据获取 ----------

    function buildQuery({ range, sources, project, timeZone }) {
      const params = new URLSearchParams()
      if (timeZone) params.set('timezone', timeZone)
      if (sources.length > 0 && sources.length < SOURCE_LIST.length) params.set('sources', sources.join(','))
      if (project.trim() !== '') params.set('project', project.trim())
      if (range === 'today') params.set('last', '1')
      else if (range === '7d') params.set('last', '7')
      else if (range === '30d') params.set('last', '30')
      else if (range === 'month') {
        try {
          const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
            timeZone: timeZone || undefined, year: 'numeric', month: '2-digit',
          }).formatToParts(new Date()).map((part) => [part.type, part.value]))
          if (parts.year && parts.month) params.set('since', `${parts.year}-${parts.month}-01`)
        } catch {
          const now = new Date()
          params.set('since', `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`)
        }
      }
      return params.toString()
    }

    function useReport({ range, sources, project, timeZone, refreshToken }) {
      const [state, setState] = useState({ loading: true, error: undefined, data: undefined })
      const abortRef = useRef(undefined)

      useEffect(() => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setState((previous) => ({ ...previous, loading: true, error: undefined }))
        const query = buildQuery({ range, sources, project, timeZone })
        fetch(`${API}/report?${query}`, { signal: controller.signal })
          .then(async (response) => {
            if (!response.ok) {
              const text = await response.text()
              throw new Error(`HTTP ${response.status} ${text.slice(0, 200)}`)
            }
            return response.json()
          })
          .then((data) => {
            if (!controller.signal.aborted) setState({ loading: false, error: undefined, data })
          })
          .catch((error) => {
            if (controller.signal.aborted || error?.name === 'AbortError') return
            setState((previous) => ({ loading: false, error, data: previous.data }))
          })
        return () => controller.abort()
      }, [range, sources.join(','), project, timeZone, refreshToken])

      return state
    }

    // ---------- 小组件 ----------

    function Icon({ size = 22 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' },
        h('path', { d: 'M4 20V11' }),
        h('path', { d: 'M10 20V5' }),
        h('path', { d: 'M16 20v-6' }),
        h('path', { d: 'M22 20H2' }),
      )
    }

    const GLYPH_PATHS = {
      dollar: ['M12 2v20', 'M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'],
      tokens: ['M4 6h16', 'M4 12h16', 'M4 18h9'],
      cache: ['M20 6c0 1.66-3.58 3-8 3S4 7.66 4 6s3.58-3 8-3 8 1.34 8 3Z', 'M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6', 'M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6'],
      sessions: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
      refresh: ['M21 12a9 9 0 0 1-15.5 6.2L3 16', 'M3 12a9 9 0 0 1 15.5-6.2L21 8', 'M21 3v5h-5', 'M3 21v-5h5'],
      shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
      search: ['M21 21l-4.35-4.35', 'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z'],
      chevron: ['m9 18 6-6-6-6'],
      filter: ['M4 5h16', 'M7 12h10', 'M10 19h4'],
      close: ['M18 6 6 18', 'M6 6l12 12'],
      calendar: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z'],
    }

    function Glyph({ name, size = 16 }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, (GLYPH_PATHS[name] ?? GLYPH_PATHS.tokens).map((path, index) => h('path', { key: index, d: path })))
    }

    function SidebarIcon() {
      return h(Icon, { size: 18 })
    }

    function StatCard({ label, value, sub, icon, tone = '', progress }) {
      return h('div', { className: `ccu-card${tone ? ` ${tone}` : ''}` },
        h('div', { className: 'ccu-card-head' },
          h('div', { className: 'k' }, h('span', null, label)),
          h('span', { className: 'ccu-card-icon' }, h(Glyph, { name: icon, size: 15 }))),
        h('div', { className: 'v', title: typeof value === 'string' ? value : undefined }, value),
        sub !== undefined ? h('div', { className: 's' }, sub) : null,
        progress !== undefined ? h('div', { className: 'ccu-mini-progress', 'aria-hidden': 'true' },
          h('span', { style: { width: `${Math.max(0, Math.min(100, progress))}%` } })) : null)
    }

    function Segmented({ value, options, onChange, label }) {
      return h('div', { className: 'ccu-seg', role: 'group', 'aria-label': label },
        options.map((option) => h('button', {
          key: option.value,
          type: 'button',
          className: value === option.value ? 'on' : '',
          'aria-pressed': value === option.value,
          onClick: () => onChange(option.value),
        }, option.label)))
    }

    function ModelChips({ breakdowns, limit = 3 }) {
      if (!Array.isArray(breakdowns) || breakdowns.length === 0) return h('span', { className: 'muted' }, '—')
      const shown = breakdowns.slice(0, limit)
      const rest = breakdowns.length - shown.length
      return h('div', { className: 'ccu-models' },
        shown.map((item) => h('span', { key: item.modelName, className: 'ccu-model', title: `${exact((item.inputTokens || 0) + (item.outputTokens || 0) + (item.cacheCreationTokens || 0) + (item.cacheReadTokens || 0))} tokens` },
          h('span', { className: 'ccu-dot', style: { background: modelColor(item.modelName) } }),
          item.modelName)),
        rest > 0 ? h('span', { className: 'ccu-model muted' }, `+${rest}`) : null)
    }

    function niceCeiling(value) {
      if (!Number.isFinite(value) || value <= 0) return 1
      const power = 10 ** Math.floor(Math.log10(value))
      const normalized = value / power
      return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power
    }

    function TokenChart({ rows, t, rangeLabel }) {
      const [hovered, setHovered] = useState(undefined)
      const scrollRef = useRef(undefined)
      const data = rows.slice(-30)
      useEffect(() => {
        const node = scrollRef.current
        if (!node) return
        const showLatest = () => { node.scrollLeft = node.scrollWidth }
        showLatest()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(showLatest)
        observer.observe(node)
        return () => observer.disconnect()
      }, [rows])
      if (data.length === 0) {
        return h('section', { className: 'ccu-panel ccu-chart' },
          h('div', { className: 'ccu-panel-head' },
            h('div', null, h('div', { className: 'ccu-panel-title' }, t('costTrend')), h('div', { className: 'ccu-panel-kicker' }, rangeLabel)),
            h('span', { className: 'ccu-range-pill' }, t('daily'))),
          h('div', { className: 'ccu-chart-empty' }, t('noData')))
      }
      const width = 760
      const height = 220
      const margin = { top: 18, right: 14, bottom: 30, left: 52 }
      const innerWidth = width - margin.left - margin.right
      const innerHeight = height - margin.top - margin.bottom
      const baseline = margin.top + innerHeight
      const maxTokens = Math.max(0, ...data.map((row) => row.totalTokens ?? 0))
      const max = niceCeiling(maxTokens)
      const step = innerWidth / data.length
      const x = (index) => margin.left + step * (index + 0.5)
      const y = (value) => margin.top + innerHeight - (Math.max(0, value) / max) * innerHeight
      const points = data.map((row, index) => [x(index), y(row.totalTokens ?? 0)])
      const line = points.map(([px, py], index) => `${index === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`).join(' ')
      const area = `${line} L ${points[points.length - 1][0]} ${baseline} L ${points[0][0]} ${baseline} Z`
      const activeIndex = Math.min(hovered ?? data.length - 1, data.length - 1)
      const selected = data[activeIndex]
      const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 2), data.length - 1])]
      return h('section', { className: 'ccu-panel ccu-chart' },
        h('div', { className: 'ccu-chart-head' },
          h('div', null,
            h('div', { className: 'ccu-panel-title' }, t('costTrend')),
            h('div', { className: 'ccu-panel-kicker' }, `${rangeLabel} · ${t('daily')}`)),
          h('div', { className: 'ccu-chart-value' },
            h('b', null, compact(selected.totalTokens)),
            h('span', null, `${selected.period} · ${exact(selected.totalTokens)} tokens`))),
        h('div', { className: 'ccu-chart-scroll', ref: scrollRef },
          h('svg', {
          className: 'ccu-chart-svg',
          viewBox: `0 0 ${width} ${height}`,
          role: 'img',
          'aria-label': `${t('costTrend')}: ${rangeLabel}`,
          onMouseLeave: () => setHovered(undefined),
        },
          h('defs', null,
            h('linearGradient', { id: 'ccu-token-gradient', x1: '0', y1: '0', x2: '0', y2: '1' },
              h('stop', { offset: '0%', stopColor: 'var(--ccu-accent)', stopOpacity: 0.25 }),
              h('stop', { offset: '100%', stopColor: 'var(--ccu-accent)', stopOpacity: 0.01 }))),
          [1, 0.5, 0].map((fraction) => {
            const py = margin.top + innerHeight * (1 - fraction)
            return h('g', { key: fraction },
              h('line', { className: 'ccu-chart-grid', x1: margin.left, x2: width - margin.right, y1: py, y2: py }),
              h('text', { x: margin.left - 9, y: py + 3, textAnchor: 'end' }, compact(max * fraction)))
          }),
          h('path', { d: area, fill: 'url(#ccu-token-gradient)' }),
          h('path', { d: line, fill: 'none', stroke: 'var(--ccu-accent)', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', vectorEffect: 'non-scaling-stroke' }),
          h('line', {
            x1: x(activeIndex), x2: x(activeIndex), y1: margin.top, y2: baseline,
            stroke: 'var(--ccu-accent)', strokeWidth: 1, strokeDasharray: '3 4', opacity: 0.45,
          }),
          points.map(([px, py], index) => h('circle', {
            key: data[index].period,
            cx: px, cy: py,
            r: index === activeIndex ? 4 : 2,
            fill: index === activeIndex ? 'var(--ccu-panel)' : 'var(--ccu-accent)',
            stroke: 'var(--ccu-accent)', strokeWidth: index === activeIndex ? 2.2 : 0,
          })),
          labelIndexes.map((index) => h('text', {
            key: `label-${data[index].period}`,
            x: x(index), y: height - 8,
            textAnchor: index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle',
          }, dayLabel(data[index].period))),
          data.map((row, index) => h('rect', {
            key: `hit-${row.period}`,
            className: 'ccu-chart-hit',
            x: margin.left + index * step, y: margin.top,
            width: step, height: innerHeight,
            onMouseEnter: () => setHovered(index),
          }, h('title', null, `${row.period} · ${exact(row.totalTokens)} tokens`))))),
        h('div', { className: 'ccu-chart-foot' },
          h('span', { className: 'ccu-chart-legend' }, t('dailyTokens')),
          h('span', null, `${t('peak')} ${compact(maxTokens)} · ${data.length} ${t('activeDays')}`)))
    }

    function summarizeSources(daily) {
      const sources = new Map()
      for (const row of daily) {
        for (const item of row.agentBreakdowns ?? []) {
          const current = sources.get(item.agent) ?? { agent: item.agent, totalTokens: 0 }
          current.totalTokens += item.totalTokens ?? 0
          sources.set(item.agent, current)
        }
      }
      return [...sources.values()].sort((a, b) => b.totalTokens - a.totalTokens)
    }

    function SourceDistribution({ stats, t }) {
      const total = stats.reduce((sum, item) => sum + item.totalTokens, 0)
      const radius = 46
      const circumference = 2 * Math.PI * radius
      let offset = 0
      return h('section', { className: 'ccu-panel ccu-distribution' },
        h('div', { className: 'ccu-panel-head' },
          h('div', null,
            h('div', { className: 'ccu-panel-title' }, t('sourceDistribution')),
            h('div', { className: 'ccu-panel-kicker' }, `${stats.length} ${t('sourceCount')}`)),
          h('span', { className: 'ccu-range-pill' }, t('tokens'))),
        total > 0
          ? h('div', { className: 'ccu-distribution-body' },
            h('div', { className: 'ccu-donut-wrap' },
              h('svg', { viewBox: '0 0 120 120', role: 'img', 'aria-label': t('sourceDistribution') },
                h('circle', { cx: 60, cy: 60, r: radius, fill: 'none', stroke: 'var(--ccu-border)', strokeWidth: 11 }),
                stats.map((item) => {
                  const fraction = item.totalTokens / total
                  const length = fraction * circumference
                  const circle = h('circle', {
                    key: item.agent, cx: 60, cy: 60, r: radius, fill: 'none',
                    stroke: SOURCE_COLORS[item.agent] ?? 'var(--ccu-accent)', strokeWidth: 11,
                    strokeDasharray: `${length} ${circumference - length}`,
                    strokeDashoffset: -offset * circumference,
                    transform: 'rotate(-90 60 60)',
                  }, h('title', null, `${sourceLabel(item.agent)} · ${exact(item.totalTokens)} · ${percent(item.totalTokens, total)}`))
                  offset += fraction
                  return circle
                })),
              h('div', { className: 'ccu-donut-center' },
                h('b', null, compact(total)),
                h('span', null, t('tokens')))),
            h('div', { className: 'ccu-source-legend' },
              stats.map((item) => h('div', { className: 'ccu-source-row', key: item.agent },
                h(SourceChip, { agent: item.agent }),
                h('span', { className: 'ccu-source-share' }, percent(item.totalTokens, total)),
                h('span', { className: 'ccu-source-cost' }, compact(item.totalTokens))))))
          : h('div', { className: 'ccu-chart-empty' }, t('noCostData')))
    }

    function modelRowsWithSource(row) {
      const agents = row.agentBreakdowns ?? []
      const items = []
      if (agents.length > 0) {
        for (const agent of agents) {
          for (const model of agent.modelBreakdowns ?? []) {
            items.push({ ...model, agent: agent.agent })
          }
        }
      } else {
        for (const model of row.modelBreakdowns ?? []) {
          items.push({ ...model, agent: row.agent })
        }
      }
      items.sort((left, right) => (
        (right.inputTokens || 0) + (right.outputTokens || 0) + (right.cacheReadTokens || 0) + (right.cacheCreationTokens || 0)
      ) - (
        (left.inputTokens || 0) + (left.outputTokens || 0) + (left.cacheReadTokens || 0) + (left.cacheCreationTokens || 0)
      ))
      return items
    }

    function ModelBreakdownTable({ breakdowns, t }) {
      const showSource = breakdowns.some((item) => item.agent)
      return h('div', { className: 'ccu-subtable-wrap' },
        h('table', { className: 'ccu-subtable' },
          h('colgroup', null,
            h('col', { className: 'ccu-sub-name' }),
            showSource ? h('col', { className: 'ccu-sub-source' }) : null,
            h('col', { className: 'ccu-sub-num' }),
            h('col', { className: 'ccu-sub-num' }),
            h('col', { className: 'ccu-sub-num' }),
            h('col', { className: 'ccu-sub-num' }),
            h('col', { className: 'ccu-sub-num' })),
          h('thead', null,
            h('tr', null,
              h('th', { className: 'ccu-sub-name' }, t('models')),
              showSource ? h('th', { className: 'ccu-sub-source' }, t('agent')) : null,
              h('th', { className: 'ccu-sub-num' }, t('input')),
              h('th', { className: 'ccu-sub-num' }, t('output')),
              h('th', { className: 'ccu-sub-num' }, t('cacheRead')),
              h('th', { className: 'ccu-sub-num' }, t('cacheWrite')),
              h('th', { className: 'ccu-sub-num' }, t('totalTokens')))),
          h('tbody', null,
            breakdowns.map((item) => h('tr', { key: `${item.agent ?? ''}:${item.modelName}` },
              h('td', { className: 'ccu-sub-name', title: item.modelName },
                h('span', { className: 'ccu-dot', style: { background: modelColor(item.modelName), marginRight: '6px' } }),
                item.modelName),
              showSource ? h('td', { className: 'ccu-sub-source' }, h(SourceChip, { agent: item.agent })) : null,
              h('td', { className: 'ccu-sub-num' }, exact(item.inputTokens)),
              h('td', { className: 'ccu-sub-num' }, exact(item.outputTokens)),
              h('td', { className: 'ccu-sub-num' }, exact(item.cacheReadTokens)),
              h('td', { className: 'ccu-sub-num' }, exact(item.cacheCreationTokens)),
              h('td', { className: 'ccu-sub-num' }, exact((item.inputTokens || 0) + (item.outputTokens || 0) + (item.cacheReadTokens || 0) + (item.cacheCreationTokens || 0))))))))
    }

    function ExpandButton({ open, onClick, t }) {
      return h('button', {
        type: 'button',
        className: 'ccu-expand',
        'aria-label': open ? t('collapse') : t('expand'),
        'aria-expanded': open,
        onClick: (event) => { event.stopPropagation(); onClick() },
      }, h(Glyph, { name: 'chevron', size: 13 }))
    }

    function EmptyState({ children }) {
      return h('div', { className: 'ccu-empty' }, h(Glyph, { name: 'calendar', size: 26 }), h('span', null, children))
    }

    function TableSkeleton() {
      return h('div', { className: 'ccu-skeleton', 'aria-label': 'Loading' },
        Array.from({ length: 6 }, (_, index) => h('div', { className: 'ccu-skeleton-row', key: index },
          Array.from({ length: 5 }, (_, cell) => h('span', { key: cell })))))
    }

    // ---------- 视图 ----------

    function PeriodCell({ period, open, onToggle, t }) {
      const daily = /^\d{4}-\d{2}-\d{2}$/.test(period)
      return h('div', { className: 'ccu-period-cell' },
        h(ExpandButton, { open, onClick: onToggle, t }),
        h('span', { className: 'ccu-period-text' },
          h('span', null, daily ? period.slice(5) : period),
          daily ? h('span', { className: 'ccu-date-year' }, period.slice(0, 4)) : null))
    }

    function onRowKeyDown(event, toggle) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggle()
      }
    }

    function PeriodTable({ rows, periodHeader, t, expanded, setExpanded }) {
      if (rows.length === 0) return h(EmptyState, null, t('noData'))
      const totals = sumRows(rows)
      return h('div', { className: 'ccu-table-wrap' },
        h('table', { className: 'ccu-table' },
            h('thead', null,
              h('tr', null,
                h('th', { className: 'ccu-start' }, periodHeader),
                h('th', null, t('totalTokens')),
                h('th', null, t('input')),
                h('th', null, t('output')),
                h('th', null, t('cacheRead')),
                h('th', null, t('cacheWrite')),
                h('th', { className: 'ccu-start' }, t('models')))),
            h('tbody', null,
              rows.map((row) => {
                const key = `${row.period}:${row.agent}`
                const open = expanded === key
                const toggle = () => setExpanded(open ? undefined : key)
                return [
                  h('tr', {
                    key,
                    className: `expandable${open ? ' expanded' : ''}`,
                    onClick: toggle,
                    onKeyDown: (event) => onRowKeyDown(event, toggle),
                    tabIndex: 0,
                    title: t('tableHint'),
                  },
                    h('td', { className: 'ccu-start' }, h(PeriodCell, { period: row.period, open, onToggle: toggle, t })),
                    h('td', null, exact(row.totalTokens)),
                    h('td', null, exact(row.inputTokens)),
                    h('td', null, exact(row.outputTokens)),
                    h('td', null, exact(row.cacheReadTokens)),
                    h('td', null, exact(row.cacheCreationTokens)),
                    h('td', { className: 'ccu-start' }, h(ModelChips, { breakdowns: row.modelBreakdowns }))),
                  open ? h('tr', { key: `${key}:detail`, className: 'ccu-subrow' },
                    h('td', { colSpan: 7 }, h(ModelBreakdownTable, { breakdowns: modelRowsWithSource(row), t }))) : null,
                ]
              })),
            h('tfoot', null,
              h('tr', null,
                h('td', { className: 'ccu-start' }, t('total')),
                h('td', null, exact(totals.totalTokens)),
                h('td', null, exact(totals.inputTokens)),
                h('td', null, exact(totals.outputTokens)),
                h('td', null, exact(totals.cacheReadTokens)),
                h('td', null, exact(totals.cacheCreationTokens)),
                h('td', null, '')))))
    }

    function SessionTable({ rows, t, expanded, setExpanded, timeZone }) {
      if (rows.length === 0) return h(EmptyState, null, t('noData'))
      const totals = sumRows(rows)
      return h('div', { className: 'ccu-table-wrap' },
        h('table', { className: 'ccu-table' },
          h('thead', null,
            h('tr', null,
              h('th', { className: 'ccu-start' }, t('session')),
              h('th', { className: 'ccu-start' }, t('agent')),
              h('th', null, t('lastActivity')),
              h('th', null, t('totalTokens')),
              h('th', null, t('cacheRead')),
              h('th', { className: 'ccu-start' }, t('models')))),
          h('tbody', null,
            rows.map((row) => {
              const key = `${row.period}:${row.agent}`
              const open = expanded === key
              const toggle = () => setExpanded(open ? undefined : key)
              return [
                h('tr', {
                  key,
                  className: `expandable${open ? ' expanded' : ''}`,
                  onClick: toggle,
                  onKeyDown: (event) => onRowKeyDown(event, toggle),
                  tabIndex: 0,
                  title: t('tableHint'),
                },
                  h('td', { className: 'mono ccu-start' },
                    h('div', { className: 'ccu-period-cell' },
                      h(ExpandButton, { open, onClick: toggle, t }),
                      h('span', { title: row.period }, String(row.period).slice(0, 34)))),
                  h('td', { className: 'ccu-start' }, h(SourceChip, { agent: row.agent, detail: `${exact(row.totalTokens)} tokens` })),
                  h('td', null, hhmm(row.metadata?.lastActivity, timeZone)),
                  h('td', null, exact(row.totalTokens)),
                  h('td', null, exact(row.cacheReadTokens)),
                  h('td', { className: 'ccu-start' }, h(ModelChips, { breakdowns: row.modelBreakdowns, limit: 2 }))),
                open ? h('tr', { key: `${key}:detail`, className: 'ccu-subrow' },
                  h('td', { colSpan: 6 }, h(ModelBreakdownTable, { breakdowns: modelRowsWithSource(row), t }))) : null,
              ]
            })),
          h('tfoot', null,
            h('tr', null,
              h('td', { className: 'ccu-start' }, `${rows.length} ${t('sessions')}`),
              h('td', null, ''),
              h('td', null, ''),
              h('td', null, compact(totals.totalTokens)),
              h('td', null, compact(totals.cacheReadTokens)),
              h('td', null, '')))))
    }

    function BlockCard({ block, t, timeZone }) {
      const active = block.isActive === true
      const gap = block.isGap === true
      return h('article', { className: `ccu-block${active ? ' active' : ''}` },
        h('div', { className: 'time' },
          h('span', { className: 'time-range' }, hhmm(block.startTime, timeZone)),
          h('span', { className: 'muted' }, '→ ', hhmm(block.actualEndTime ?? block.endTime, timeZone)),
          h('span', { className: `badge${active ? ' live' : gap ? ' gap' : ''}` },
            h('span', { className: 'ccu-dot' }),
            active ? t('active') : gap ? t('gap') : t('window'))),
        h('div', null,
          h('div', { className: 'meta' },
            h('span', null, h('b', null, compact(block.totalTokens)), ' tokens'),
            h('span', null, h('b', null, exact(block.entries)), ' ', t('entries'))),
          h('div', { className: 'ccu-block-models' },
            (block.models ?? []).slice(0, 4).map((model) => h('span', {
              key: model,
              className: 'ccu-model',
            }, model))),
          active && block.burnRate != null
            ? h('div', { className: 'proj' },
              `${t('burnRate')}: ${compact(block.burnRate.tokensPerMinute)} ${t('tokensPerMin')}`,
              block.projection != null
                ? ` · ${t('projection')}: ${compact(block.projection.totalTokens)} tokens (${block.projection.remainingMinutes} ${t('minutes')} ${t('remaining')})`
                : '')
            : null))
    }

    function BlocksView({ blocks, t, timeZone }) {
      const note = h('div', { className: 'ccu-foot', style: { marginBottom: '8px' } }, t('blocksNote'))
      if (!Array.isArray(blocks) || blocks.length === 0) return h('div', null, note, h(EmptyState, null, t('emptyBlocks')))
      const sorted = blocks.slice().sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))
      return h('div', null, note, h('div', { className: 'ccu-blocks' }, sorted.map((block) => h(BlockCard, { key: block.id, block, t, timeZone }))))
    }

    // ---------- 主面板 ----------

    function Panel({ t }) {
      useStyles()
      const [range, setRange] = useState('7d')
      const [sources, setSources] = useState(SOURCE_LIST)
      const [project, setProject] = useState('')
      const [projectInput, setProjectInput] = useState('')
      const [view, setView] = useState('daily')
      const [expanded, setExpanded] = useState(undefined)
      const [refreshToken, setRefreshToken] = useState(0)
      const [meta, setMeta] = useState(undefined)
      const timerRef = useRef(undefined)

      const timeZone = meta?.timezone
      const { loading, error, data } = useReport({ range, sources, project, timeZone, refreshToken })

      useEffect(() => {
        let active = true
        fetch(`${API}/meta`)
          .then((response) => (response.ok ? response.json() : undefined))
          .then((value) => { if (active) setMeta(value) })
          .catch(() => {})
        return () => { active = false }
      }, [])

      useEffect(() => {
        if (timerRef.current !== undefined) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setProject(projectInput.trim()), 350)
        return () => clearTimeout(timerRef.current)
      }, [projectInput])

      const toggleSource = useCallback((source) => {
        setSources((current) => {
          if (current.includes(source)) {
            const next = current.filter((item) => item !== source)
            return next.length === 0 ? current : next
          }
          return [...current, source]
        })
      }, [])

      const refresh = useCallback(() => {
        setRefreshToken((value) => value + 1)
      }, [])

      const changeView = useCallback((next) => {
        setView(next)
        setExpanded(undefined)
      }, [])

      const rangeOptions = useMemo(() => ([
        { value: 'today', label: t('today') },
        { value: '7d', label: t('days7') },
        { value: '30d', label: t('days30') },
        { value: 'month', label: t('thisMonth') },
        { value: 'all', label: t('allTime') },
      ]), [t])

      const totals = data?.totals
      const daily = data?.daily ?? []
      const rows = view === 'daily' ? daily
        : view === 'weekly' ? data?.weekly ?? []
          : view === 'monthly' ? data?.monthly ?? []
            : []
      const sourceStats = summarizeSources(daily)
      const modelCount = new Set(daily.flatMap((row) => row.modelsUsed ?? [])).size
      const dailyAverage = daily.length > 0 && totals !== undefined ? totals.totalTokens / daily.length : 0
      const cacheDenominator = (totals?.cacheReadTokens ?? 0) + (totals?.inputTokens ?? 0)
      const cacheHitValue = cacheDenominator > 0 ? ((totals?.cacheReadTokens ?? 0) / cacheDenominator) * 100 : 0
      const cacheHit = totals !== undefined ? percent(totals.cacheReadTokens, cacheDenominator) : '—'
      const warnings = data?.metadata?.warnings ?? []
      const rangeLabel = rangeOptions.find((option) => option.value === range)?.label ?? range
      const viewTabs = [
        ['daily', t('daily'), daily.length],
        ['weekly', t('weekly'), data?.weekly?.length ?? 0],
        ['monthly', t('monthly'), data?.monthly?.length ?? 0],
        ['session', t('session'), data?.session?.length ?? 0],
        ['blocks', t('blocks'), data?.blocks?.length ?? 0],
      ]

      let dataContent
      if (loading && data === undefined) {
        dataContent = h(TableSkeleton)
      } else if (view === 'blocks') {
        dataContent = h(BlocksView, { blocks: data?.blocks, t, timeZone })
      } else if (view === 'session') {
        dataContent = h(SessionTable, { rows: data?.session ?? [], t, expanded, setExpanded, timeZone })
      } else {
        dataContent = h(PeriodTable, {
          rows: rows.slice().reverse(),
          periodHeader: view === 'weekly' ? t('week') : view === 'monthly' ? t('month') : t('date'),
          t,
          expanded,
          setExpanded,
        })
      }

      return h('div', { className: 'ccu-root' },
        h('header', { className: 'ccu-head' },
          h('div', { className: 'ccu-brand' },
            h('div', { className: 'ccu-brand-mark' }, h(Icon)),
            h('div', null,
              h('div', { className: 'ccu-eyebrow' }, t('overview')),
              h('h1', { className: 'ccu-title' }, t('title')),
              h('div', { className: 'ccu-sub' }, t('subtitle')))),
          h('div', { className: 'ccu-local-badge', title: t('localData') },
            h(Glyph, { name: 'shield', size: 13 }),
            h('span', null, t('localOnly')))),

        h('section', { className: 'ccu-toolbar', 'aria-label': t('filters') },
          h(Segmented, {
            value: range,
            options: rangeOptions,
            onChange: (value) => { setRange(value); setExpanded(undefined) },
            label: t('currentRange'),
          }),
          h('div', { className: 'ccu-toolbar-right' },
            h('button', {
              className: 'ccu-btn primary',
              type: 'button',
              onClick: refresh,
              disabled: loading,
            },
              h('span', { className: loading ? 'ccu-refreshing' : '' }, h(Glyph, { name: 'refresh', size: 14 })),
              loading ? t('refreshing') : t('refresh')))),

        error !== undefined
          ? h('div', { className: 'ccu-error', role: 'alert' },
            h('span', null, `${t('loadFailed')}: ${error.message}`),
            h('button', { className: 'ccu-btn', type: 'button', onClick: refresh }, t('retry')))
          : null,

        warnings.length > 0
          ? h('div', { className: 'ccu-banner' }, warnings.map((warning) => h('div', { key: warning }, warning)))
          : null,

        h('section', { className: 'ccu-cards', 'aria-label': t('title') },
          h(StatCard, {
            label: t('totalTokens'),
            value: totals !== undefined ? compact(totals.totalTokens) : '—',
            sub: data !== undefined ? `${t('dailyAverage')} ${compact(dailyAverage)} · ${modelCount} ${t('modelCount')}` : '',
            icon: 'tokens',
            tone: 'blue',
          }),
          h(StatCard, {
            label: t('input'),
            value: totals !== undefined ? compact(totals.inputTokens) : '—',
            sub: totals !== undefined ? exact(totals.inputTokens) : '',
            icon: 'tokens',
          }),
          h(StatCard, {
            label: t('output'),
            value: totals !== undefined ? compact(totals.outputTokens) : '—',
            sub: totals !== undefined ? exact(totals.outputTokens) : '',
            icon: 'tokens',
            tone: 'amber',
          }),
          h(StatCard, {
            label: t('cacheRead'),
            value: totals !== undefined ? compact(totals.cacheReadTokens) : '—',
            sub: totals !== undefined ? `${t('cacheHit')} ${cacheHit}` : '',
            icon: 'cache',
            tone: 'violet',
            progress: cacheHitValue,
          })),

        h('section', { className: 'ccu-panel ccu-data-panel' },
          h('div', { className: 'ccu-data-head' },
            h('nav', { className: 'ccu-tabs', 'aria-label': t('overview') },
              viewTabs.map(([id, label, count]) => h('button', {
                key: id,
                type: 'button',
                className: view === id ? 'on' : '',
                'aria-pressed': view === id,
                onClick: () => changeView(id),
              }, label, h('span', { className: 'ccu-tab-count' }, count)))),
            h('span', { className: 'ccu-data-hint' }, t('tableHint'))),

          h('div', { className: 'ccu-filters' },
            h('span', { className: 'ccu-filter-label' }, h(Glyph, { name: 'filter', size: 12 }), t('filters')),
            SOURCE_LIST.map((source) => h('button', {
              key: source,
              type: 'button',
              className: `ccu-chip${sources.includes(source) ? ' on' : ''}`,
              'aria-pressed': sources.includes(source),
              onClick: () => toggleSource(source),
            },
              h('span', { className: 'ccu-dot', style: { background: SOURCE_COLORS[source] } }),
              sourceLabel(source))),
            h('div', { className: 'ccu-search' },
              h(Glyph, { name: 'search', size: 13 }),
              h('input', {
                className: 'ccu-input',
                placeholder: t('projectPlaceholder'),
                'aria-label': t('project'),
                value: projectInput,
                onChange: (event) => setProjectInput(event.target.value),
              }),
              projectInput !== ''
                ? h('button', {
                  type: 'button',
                  className: 'ccu-search-clear',
                  'aria-label': t('clearFilter'),
                  onClick: () => { setProjectInput(''); setProject('') },
                }, h(Glyph, { name: 'close', size: 12 }))
                : null)),

          h('div', { className: `ccu-data-body${loading && data !== undefined ? ' is-refreshing' : ''}`, 'aria-busy': loading },
            loading && data !== undefined ? h('div', { className: 'ccu-loading-line' }) : null,
            dataContent)),

        h('div', { className: 'ccu-overview-grid' },
          h(TokenChart, { rows: daily, t, rangeLabel }),
          h(SourceDistribution, { stats: sourceStats, t })),

        h('footer', { className: 'ccu-foot' },
          h('span', { className: 'ccu-foot-status', title: t('costNote') },
            h('span', { className: 'ccu-live-dot' }), t('localData')),
          h('span', null,
            meta !== undefined ? `${meta.timezone} · ` : '',
            data !== undefined
              ? `${data.metadata?.entries ?? 0} ${t('entries')} · ${t('generated')} ${hhmm(data.metadata?.generatedAt, timeZone)} · ${data.metadata?.durationMs ?? 0}ms`
              : t('loading'))))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, messages), 'ccusage: locale')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 32,
        label: () => t('nav'),
        locale: NS,
      }, SidebarIcon))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      }, Panel))
    }

    const inject = ['slots', 'locale']
    module.exports = { name: PANEL_ID, inject, apply }
    return module.exports
  },
})
