"""Which current metrics predict next-4-quarter CRE lending growth? Cross-sectional ICs, FE regressions, macro interactions, OOS test."""
import os, warnings, numpy as np, pandas as pd
from scipy import stats
import statsmodels.api as sm
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
warnings.filterwarnings('ignore')
D = os.path.join(os.path.dirname(__file__), '..', 'data'); OUT = '/mnt/user-data/outputs'
pd.set_option('display.width', 220); pd.set_option('display.max_columns', 40)

p = pd.read_parquet(f'{D}/model_panel.parquet')
p = p[p['y_cre_growth_assets'].notna() & (p['assets'] > 50e6)].copy()          # drop sub-$50M shells
fwd_asset_growth = (p['assets_f4'] / p['assets'] - 1) * 100
p = p[fwd_asset_growth.abs() < 30]                                              # drop merger/acquisition jumps
p['y'] = p.groupby('charter')['y_cre_growth_assets'].transform(lambda s: s.clip(s.quantile(.01), s.quantile(.99)))
p['brokered_or_nonmember_pct'] = np.where(p['charter'] == 'bank', p['brokered_pct'], p['nonmember_dep_pct'])
p['cap_headroom_pct'] = np.where(p['charter'] == 'bank', p['cre_cap_headroom_pct'], p['mbl_headroom_pct'])

FEATS = ['loan_to_deposit_pct', 'tier1_leverage_pct', 'funding_cost_pct', 'nim_pct', 'roa_pct', 'loan_yield_pct', 'npl_pct', 'cre_npl_pct',
         'cre_pct_capital', 'constr_pct_capital', 'cre_total_pct_loans', 'cap_headroom_pct', 'brokered_or_nonmember_pct',
         'log_assets', 'cre_growth_trail_assets', 'deposit_growth_trail_pct', 'asset_growth_trail_pct', 'cre_rate_pct']
MACRO = ['fedfunds', 'dgs5', 'dgs10', 'slope_10_2', 'd4_fedfunds', 'd4_dgs10', 'sloos_cre_tight', 'sloos_cre_demand', 'cre_price_yoy', 'unrate']

lines = []
def say(*a):
    s = ' '.join(str(x) for x in a); print(s); lines.append(s)

# ------------------------------------------------------------------ 1. cross-sectional information coefficients (per quarter Spearman, averaged)
say('# 1. Cross-sectional rank correlation (Spearman IC) between each metric at t and CRE growth over t..t+4 (as % of assets)')
say('   mean IC over quarters, t-stat of the mean, % of quarters with the same sign. Positive = higher metric -> more CRE growth next year.')
ic_rows = []
for ch in ['bank', 'cu']:
    d = p[p['charter'] == ch]
    for f in FEATS:
        ics = []
        for per, g in d.groupby('period'):
            g = g[[f, 'y']].dropna()
            if len(g) > 200: ics.append(stats.spearmanr(g[f], g['y'])[0])
        if len(ics) > 10:
            ics = np.array(ics); ic_rows.append((ch, f, ics.mean(), ics.mean() / ics.std() * np.sqrt(len(ics)), (np.sign(ics) == np.sign(ics.mean())).mean(), len(ics)))
IC = pd.DataFrame(ic_rows, columns=['charter', 'metric', 'mean_IC', 't_stat', 'sign_consistency', 'quarters'])
for ch in ['bank', 'cu']:
    say(f'\n## {ch}'); say(IC[IC.charter == ch].sort_values('mean_IC', key=abs, ascending=False).round(3).to_string(index=False))

# ------------------------------------------------------------------ 2. pooled regression with quarter fixed effects on within-quarter percentile ranks
say('\n# 2. Regression of forward CRE growth on within-quarter percentile ranks of each metric (quarter fixed effects absorb the macro cycle)')
say('   Coefficient = change in next-year CRE growth (pts of assets) moving a lender from the bottom to the top of the distribution, holding the others fixed.')
coef_rows = []
for ch in ['bank', 'cu']:
    d = p[p['charter'] == ch].copy()
    feats = [f for f in FEATS if d[f].notna().mean() > 0.5 and not (ch == 'bank' and f == 'cap_headroom_pct')]
    for f in feats: d[f + '_r'] = d.groupby('period')[f].rank(pct=True)
    X = d[[f + '_r' for f in feats]].copy()
    X = X.fillna(0.5)
    X = pd.concat([X, pd.get_dummies(d['period'].dt.strftime('%Y%m'), prefix='q', drop_first=True, dtype=float)], axis=1)
    X = sm.add_constant(X)
    fit = sm.OLS(d['y'], X).fit(cov_type='cluster', cov_kwds={'groups': pd.factorize(d['lender_id'])[0]})
    say(f'\n## {ch}: n={len(d):,}, R2={fit.rsquared:.3f}')
    tab = pd.DataFrame({'coef': fit.params, 't': fit.tvalues}).loc[[f + '_r' for f in feats]]
    tab.index = [i[:-2] for i in tab.index]
    say(tab.sort_values('coef', key=abs, ascending=False).round(2).to_string())
    for f, r in tab.iterrows(): coef_rows.append((ch, f, r['coef'], r['t']))
COEF = pd.DataFrame(coef_rows, columns=['charter', 'metric', 'coef_bottom_to_top', 't_stat'])

# ------------------------------------------------------------------ 2b. is there a ceiling effect near the regulatory caps?
say('\n# 2b. Next-year CRE growth (pts of assets, mean / median) by current concentration bucket')
d = p[p['charter'] == 'bank'].copy()
d['bucket'] = pd.cut(d['cre_pct_capital'], [-1, 50, 100, 150, 200, 250, 300, 350, 400, 500, 10000], labels=['0-50', '50-100', '100-150', '150-200', '200-250', '250-300', '300-350', '350-400', '400-500', '500+'])
t = d.groupby('bucket', observed=True)['y'].agg(['mean', 'median', 'size']); t['pct_growing>1pt'] = d.groupby('bucket', observed=True)['y'].apply(lambda s: (s > 1).mean())
say('## banks: investment CRE as % of capital'); say(t.round(2).to_string())
d['cb'] = pd.cut(d['constr_pct_capital'], [-1, 25, 50, 75, 100, 125, 150, 10000], labels=['0-25', '25-50', '50-75', '75-100', '100-125', '125-150', '150+'])
t = d.groupby('cb', observed=True)['y'].agg(['mean', 'median', 'size']); say('## banks: construction as % of capital'); say(t.round(2).to_string())
d = p[(p['charter'] == 'cu') & p['mbl_cap_used_pct'].notna()].copy()
d['bucket'] = pd.cut(d['mbl_cap_used_pct'], [-1, 10, 25, 50, 75, 90, 100, 10000], labels=['0-10', '10-25', '25-50', '50-75', '75-90', '90-100', '100+'])
t = d.groupby('bucket', observed=True)['y'].agg(['mean', 'median', 'size']); say('## credit unions (non-LICU): MBL cap used %'); say(t.round(2).to_string())
d = p[p['charter'] == 'cu'].copy()
t = d.groupby('licu')['y'].agg(['mean', 'median', 'size']); say('## credit unions: low-income designation (1 = exempt from MBL cap)'); say(t.round(2).to_string())

# ------------------------------------------------------------------ 3. macro: (a) aggregate CRE growth vs rates, (b) does each metric's IC vary with the rate environment?
say('\n# 3a. Macro main effects: aggregate forward 4Q CRE growth (sum of CRE, % of sum of assets) vs rate environment at t, by charter (time series, ~37 quarters)')
agg = p.groupby(['charter', 'period']).apply(lambda g: pd.Series({'y_agg': (g['cre_total_f4'].sum() - g['cre_total'].sum()) / g['assets'].sum() * 100, **{m: g[m].iloc[0] for m in MACRO}})).reset_index()
for ch in ['bank', 'cu']:
    a = agg[agg.charter == ch]
    cors = {m: stats.pearsonr(a[m].astype(float), a['y_agg'])[0] for m in MACRO if a[m].notna().all()}
    say(f'   {ch}: ' + ', '.join(f'{m} r={v:+.2f}' for m, v in sorted(cors.items(), key=lambda kv: -abs(kv[1]))))
say('\n# 3b. Macro interactions: regress each metric\'s quarterly IC on the rate environment. Coefficient sign tells whether the metric matters MORE (+) or LESS (-) when that macro variable is high.')
say('   Shown: slope of IC on each macro variable (standardized), with |t|>2 flagged *')
inter_rows = []
for ch in ['bank', 'cu']:
    d = p[p['charter'] == ch]
    mac = d.groupby('period')[MACRO].first()
    for f in FEATS:
        ics = {}
        for per, g in d.groupby('period'):
            g = g[[f, 'y']].dropna()
            if len(g) > 200: ics[per] = stats.spearmanr(g[f], g['y'])[0]
        if len(ics) < 15: continue
        s = pd.Series(ics)
        row = {'charter': ch, 'metric': f}
        for m in ['fedfunds', 'dgs10', 'slope_10_2', 'd4_dgs10', 'sloos_cre_tight', 'cre_price_yoy']:
            x = mac.loc[s.index, m].astype(float)
            if x.notna().sum() < 15: continue
            z = (x - x.mean()) / x.std()
            r = sm.OLS(s.values, sm.add_constant(z.values)).fit(cov_type='HAC', cov_kwds={'maxlags': 4})
            row[m] = f"{r.params[1]:+.3f}{'*' if abs(r.tvalues[1]) > 2 else ''}"
        inter_rows.append(row)
INTER = pd.DataFrame(inter_rows)
for ch in ['bank', 'cu']:
    say(f'\n## {ch}'); say(INTER[INTER.charter == ch].drop(columns='charter').to_string(index=False))

# ------------------------------------------------------------------ 4. out-of-sample test of a gradient-boosted model: train on t <= 2022Q2, test on t in 2023Q3..2025Q2
say('\n# 4. Out-of-sample test: gradient boosting on metrics + macro. Train targets end 2023Q2 (t <= 2022Q2); test t = 2023Q3..2025Q2 (targets through 2026Q2).')
res_rows = []
for ch in ['bank', 'cu']:
    d = p[p['charter'] == ch].copy()
    feats = [f for f in FEATS if d[f].notna().mean() > 0.5 and not (ch == 'bank' and f == 'cap_headroom_pct')] + MACRO
    tr = d[d['period'] <= '2022-06-30']; te = d[d['period'] >= '2023-09-30']
    gb = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.05, max_leaf_nodes=31, min_samples_leaf=200, l2_regularization=1.0, random_state=0)
    gb.fit(tr[feats], tr['y'])
    te = te.assign(pred=gb.predict(te[feats]))
    ics = te.groupby('period').apply(lambda g: stats.spearmanr(g['pred'], g['y'])[0])
    te['dec'] = te.groupby('period')['pred'].transform(lambda s: pd.qcut(s.rank(method='first'), 10, labels=False) + 1)
    dec = te.groupby('dec')['y'].mean()
    r2 = 1 - ((te['y'] - te['pred']) ** 2).sum() / ((te['y'] - te['y'].mean()) ** 2).sum()
    say(f'\n## {ch}: train n={len(tr):,}, test n={len(te):,}; OOS R2={r2:.3f}; mean OOS rank IC={ics.mean():.3f} (min {ics.min():.3f}, max {ics.max():.3f} across {len(ics)} test quarters)')
    say('   Actual next-year CRE growth (pts of assets) by predicted decile 1 (lowest) .. 10 (highest): ' + ', '.join(f'{v:.2f}' for v in dec.values))
    pi = permutation_importance(gb, te[feats], te['y'], n_repeats=3, random_state=0, n_jobs=-1)
    imp = pd.Series(pi.importances_mean, index=feats).sort_values(ascending=False)
    say('   Permutation importance (OOS), top 12: ' + ', '.join(f'{k}={v:.3f}' for k, v in imp.head(12).items()))
    for k, v in imp.items(): res_rows.append((ch, k, v))
    for dd, v in dec.items(): res_rows.append((ch, f'decile_{dd}_actual_growth', v))
    res_rows.append((ch, 'oos_R2', r2)); res_rows.append((ch, 'oos_mean_rank_IC', ics.mean()))
RES = pd.DataFrame(res_rows, columns=['charter', 'item', 'value'])

# ------------------------------------------------------------------ 5. CU originations cross-check: do the same metrics predict next-year CRE *granted* (true originations)?
say('\n# 5. Credit-union cross-check using true originations: Spearman IC of each metric at Dec 31 with next full-year CRE granted / assets')
d = p[(p['charter'] == 'cu') & (p['quarter'] == 4)].copy()
d['y_orig'] = d['cre_granted_ytd_f4'] / d['assets'] * 100
rows = []
for f in FEATS:
    ics = [stats.spearmanr(g[[f, 'y_orig']].dropna()[f], g[[f, 'y_orig']].dropna()['y_orig'])[0] for per, g in d.groupby('period') if g[[f, 'y_orig']].dropna().shape[0] > 200]
    if len(ics) > 5: rows.append((f, np.mean(ics), np.mean(ics) / np.std(ics) * np.sqrt(len(ics)), len(ics)))
ORIG = pd.DataFrame(rows, columns=['metric', 'mean_IC', 't_stat', 'years']).sort_values('mean_IC', key=abs, ascending=False)
say(ORIG.round(3).to_string(index=False))

with pd.ExcelWriter(f'{OUT}/model_results.xlsx', engine='openpyxl') as xw:
    IC.round(4).to_excel(xw, sheet_name='1 Rank correlations', index=False)
    COEF.round(4).to_excel(xw, sheet_name='2 FE regression', index=False)
    agg.round(3).to_excel(xw, sheet_name='3a Macro vs aggregate', index=False)
    INTER.to_excel(xw, sheet_name='3b Macro interactions', index=False)
    RES.round(4).to_excel(xw, sheet_name='4 OOS test', index=False)
    ORIG.round(4).to_excel(xw, sheet_name='5 CU originations check', index=False)
open(f'{OUT}/model_results.txt', 'w').write('\n'.join(lines))
