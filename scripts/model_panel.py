"""Build the modelling panel: lender-quarter features at t, target = CRE growth over t -> t+4 quarters, macro at t."""
import os, numpy as np, pandas as pd
D = os.path.join(os.path.dirname(__file__), '..', 'data'); FRED = os.path.join(os.path.dirname(__file__), '..', 'raw', 'fred')

def macro():
    def q(series, how='mean'):
        s = pd.read_csv(f'{FRED}/{series}.csv', parse_dates=['observation_date']).set_index('observation_date').iloc[:, 0]
        s = pd.to_numeric(s, errors='coerce').dropna()
        return s.resample('QE').mean() if how == 'mean' else s.resample('QE').last()
    M = pd.DataFrame({'fedfunds': q('DFF'), 'sofr': q('SOFR'), 'dgs2': q('DGS2'), 'dgs5': q('DGS5'), 'dgs10': q('DGS10'),
                      'unrate': q('UNRATE'), 'sloos_cre_tight': q('DRTSCLCC', 'last'), 'sloos_cre_demand': q('SUBLPDRCSC', 'last'),
                      'cre_price_yoy': q('COMREPUSQ159N', 'last'), 'bbb_spread': q('BAMLC0A4CBBB')})
    M['slope_10_2'] = M['dgs10'] - M['dgs2']
    M['d4_fedfunds'] = M['fedfunds'].diff(4); M['d4_dgs10'] = M['dgs10'].diff(4); M['d4_dgs5'] = M['dgs5'].diff(4)
    M.index.name = 'period'
    return M.reset_index()

def panel():
    m = pd.read_parquet(f'{D}/metrics_quarterly.parquet')
    m = m.sort_values(['lender_id', 'period']).reset_index(drop=True)
    g = m.groupby('lender_id')
    # forward 4-quarter outcomes (must be exactly 4 quarters ahead)
    for c in ['cre_total', 'cre_investment', 'assets', 'period', 'cre_granted_ytd']:
        m[c + '_f4'] = g[c].shift(-4)
    ok = (m['period_f4'] - m['period']).dt.days.between(360, 370)
    m.loc[~ok, [c + '_f4' for c in ['cre_total', 'cre_investment', 'assets', 'cre_granted_ytd']]] = np.nan
    m['y_cre_growth_assets'] = (m['cre_total_f4'] - m['cre_total']) / m['assets'] * 100          # pts of assets
    m['y_cre_growth_pct'] = (m['cre_total_f4'] / m['cre_total'] - 1) * 100
    m['y_inv_growth_assets'] = (m['cre_investment_f4'] - m['cre_investment']) / m['assets'] * 100
    # trailing 4-quarter momentum
    for c in ['cre_total', 'deposits', 'assets']:
        m[c + '_b4'] = g[c].shift(4)
    okb = (m['period'] - g['period'].shift(4)).dt.days.between(360, 370)
    m.loc[~okb, [c + '_b4' for c in ['cre_total', 'deposits', 'assets']]] = np.nan
    m['cre_growth_trail_assets'] = (m['cre_total'] - m['cre_total_b4']) / m['assets_b4'] * 100
    m['deposit_growth_trail_pct'] = (m['deposits'] / m['deposits_b4'] - 1) * 100
    m['asset_growth_trail_pct'] = (m['assets'] / m['assets_b4'] - 1) * 100
    m['log_assets'] = np.log10(m['assets'])
    m['cre_cap_headroom_pct'] = 300 - m['cre_pct_capital']                 # bank guidance headroom in pts of capital
    m['mbl_headroom_pct'] = 100 - m['mbl_cap_used_pct']
    m['is_cu'] = (m['charter'] == 'cu').astype(int)
    M = macro()
    m = m.merge(M, on='period', how='left')
    return m

if __name__ == '__main__':
    p = panel()
    p.to_parquet(f'{D}/model_panel.parquet', index=False)
    print(p.shape, p['y_cre_growth_assets'].notna().sum(), 'rows with target')
    print(p.groupby('period')[['fedfunds', 'dgs5', 'dgs10', 'slope_10_2', 'sloos_cre_tight', 'cre_price_yoy']].first().iloc[::4].round(2))
