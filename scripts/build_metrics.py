"""Harmonize FDIC bank and NCUA credit-union call report data into one quarterly metrics table.

Units: all dollar amounts in actual dollars (FDIC reports thousands -> x1000). Ratios in percent.
"""
import os, numpy as np, pandas as pd

D = os.path.join(os.path.dirname(__file__), '..', 'data')

# ----------------------------------------------------------------------------- banks
def banks():
    f = pd.read_parquet(f'{D}/fdic_fin_raw.parquet')
    K = 1000.0
    o = pd.DataFrame({
        'lender_id': 'B' + f['CERT'].astype(str),
        'charter': 'bank',
        'name': f['NAME'],
        'state': f['STALP'],
        'period': pd.to_datetime(f['REPDTE'], format='%Y%m%d'),
        'assets': f['ASSET'] * K,
        'deposits': f['DEP'] * K,
        'loans': f['LNLSGR'] * K,
        'equity': f['EQ'] * K,
        'tier1_capital': f['RBCT1J'] * K,
        'total_rbc': np.where(f['RBC'] > 0, f['RBC'], f['RBCT1J'] + f['LNATRES'].fillna(0)) * K,   # CBLR banks report no RBC: use tier 1 + allowance (examiner convention)
        'cblr_bank': (~(f['RBC'] > 0)).astype(float),
        'borrowings': (f['FREPP'].fillna(0) + f['OTHBRF'].fillna(0) + f['SUBND'].fillna(0)) * K,
        'cre_oo': f['LNRENROW'] * K,
        'cre_nonoo': f['LNRENROT'] * K,
        'cre_multi': f['LNREMULT'] * K,
        'cre_constr': f['LNRECONS'] * K,
        'cre_constr_1to4': f['LNRECNFM'] * K,
        're_farm': f['LNREAG'] * K,
        'brokered': f['BRO'] * K,
        'brokered_flag': (f['BRO'] > 0).astype(float),
        'nonmember_deposits': np.nan,
        'int_income_ytd': f['INTINC'] * K,
        'int_expense_ytd': f['EINTEXP'] * K,
        'nii_ytd': f['NIM'] * K,
        'loan_income_ytd': f['ILNLS'] * K,
        'net_income_ytd': f['NETINC'] * K,
        'npl': f['NCLNLS'] * K,
        'cre_npl': (f['NCRENRES'].fillna(0) + f['NCREMULT'].fillna(0) + f['NCRECONS'].fillna(0)) * K,
        'tier1_leverage_pct': f['RBC1AAJ'],
        'nim_pct_published': f['NIMY'],
        'cost_funds_pct_published': f['INTEXPY'],
        'npl_pct_published': f['NCLNLSR'],
        'employees': f['NUMEMP'],
        'bkclass': f['BKCLASS'],
        'community_bank': f['CB'],
        'holding_co_rssd': f['RSSDHCR'],
    })
    o['cre_total'] = o[['cre_oo', 'cre_nonoo', 'cre_multi', 'cre_constr']].sum(axis=1, min_count=1)
    o['cre_investment'] = o[['cre_nonoo', 'cre_multi', 'cre_constr']].sum(axis=1, min_count=1)
    o['cre_granted_ytd'] = np.nan; o['cre_granted_ytd_n'] = np.nan; o['cre_rate_pct'] = np.nan
    o['mbl_balance'] = np.nan; o['licu'] = np.nan
    return o

# ----------------------------------------------------------------------------- credit unions
def cus():
    r = pd.read_parquet(f'{D}/ncua_raw.parquet')
    acct = [c for c in r.columns if c.startswith('ACCT_')]
    for c in acct: r[c] = pd.to_numeric(r[c], errors='coerce')
    r['period'] = pd.to_datetime(r['CYCLE'] + '-01') + pd.offsets.MonthEnd(0)
    # era: new commercial-lending schedule (FS220L) once Acct_400T1 is populated for the cycle
    tot = r.groupby('CYCLE')['ACCT_400T1'].sum()
    new_cycles = set(tot[tot > 0].index)
    r['new_form'] = r['CYCLE'].isin(new_cycles)
    n = r['new_form']
    def pick(new_cols, old_cols):
        newv = r[new_cols].sum(axis=1, min_count=1)
        oldv = r[old_cols].sum(axis=1, min_count=1)
        return newv.where(n, oldv)
    o = pd.DataFrame({
        'lender_id': 'C' + r['CU_NUMBER'].astype(str),
        'charter': 'cu',
        'name': r['CU_NAME'].str.strip(),
        'state': r['STATE'].str.strip(),
        'period': r['period'],
        'assets': r['ACCT_010'],
        'deposits': r['ACCT_018'],
        'loans': r['ACCT_025B'],
        'equity': r['ACCT_997'],
        'tier1_capital': r['ACCT_997'],
        'total_rbc': r['ACCT_997'],
        'cblr_bank': np.nan,
        'borrowings': r['ACCT_860C'].fillna(0),
        'cre_oo': pick(['ACCT_400H2', 'ACCT_400H3'], ['ACCT_400H']),
        'cre_nonoo': pick(['ACCT_400J2', 'ACCT_400J3'], ['ACCT_400J']),
        'cre_multi': pick(['ACCT_400M', 'ACCT_400M1'], ['ACCT_400G']),   # pre-2017: non-farm residential MBL (multifamily + 1-4 investor)
        'cre_constr': pick(['ACCT_143B3', 'ACCT_143B4'], ['ACCT_143B']),
        'cre_constr_1to4': np.nan,
        're_farm': pick(['ACCT_042A5', 'ACCT_042A7'], []),
        'brokered': np.nan,                       # NCUA reports no brokered-deposit dollar amount (Acct_788 = brokered CDs held as investments; Acct_879T = Y/N flag)
        'brokered_flag': pd.to_numeric(r['ACCT_879T'], errors='coerce'),
        'nonmember_deposits': r['ACCT_880'],
        'int_income_ytd': r['ACCT_115'],
        'int_expense_ytd': r['ACCT_350'],
        'nii_ytd': r['ACCT_115'] - r['ACCT_350'],
        'loan_income_ytd': r['ACCT_110'],
        'net_income_ytd': r['ACCT_661A'],
        'npl': r['ACCT_041B'],
        'cre_npl': np.nan,
        'tier1_leverage_pct': r['ACCT_997'] / r['ACCT_010'] * 100,
        'nim_pct_published': np.nan,
        'cost_funds_pct_published': np.nan,
        'npl_pct_published': np.nan,
        'employees': np.nan,
        'bkclass': 'CU',
        'community_bank': np.nan,
        'holding_co_rssd': np.nan,
        'cre_granted_ytd': pick(['ACCT_475K2'], ['ACCT_475K']),
        'cre_granted_ytd_n': pick(['ACCT_090K2'], ['ACCT_090K']),
        'cre_rate_pct': r['ACCT_525'].where(r['ACCT_525'] > 0) / 100.0,   # reported in basis points
        'mbl_balance': r['ACCT_400A'],
        'licu': pd.to_numeric(r['LIMITED_INC'], errors='coerce'),
        'tom_code': r['TOM_CODE'].str.strip(),
        'cu_type': r['CU_TYPE'].str.strip(),
        'new_form': n,
    })
    # CUs with no commercial lending leave the schedule blank -> zero exposure, not missing
    for c in ['cre_oo', 'cre_nonoo', 'cre_multi', 'cre_constr', 're_farm', 'cre_granted_ytd', 'cre_granted_ytd_n', 'mbl_balance', 'nonmember_deposits']:
        o[c] = o[c].fillna(0)
    o['cre_total'] = o[['cre_oo', 'cre_nonoo', 'cre_multi', 'cre_constr']].sum(axis=1, min_count=1)
    o['cre_investment'] = o[['cre_nonoo', 'cre_multi', 'cre_constr']].sum(axis=1, min_count=1)
    return o

# ----------------------------------------------------------------------------- metrics
def add_metrics(m):
    m = m.sort_values(['lender_id', 'period']).reset_index(drop=True)
    m['year'] = m['period'].dt.year
    m['quarter'] = m['period'].dt.quarter
    ann = 4.0 / m['quarter']                      # YTD -> annualized
    g = m.groupby('lender_id', sort=False)

    # prior year-end (Dec 31) balances for YTD change and averages
    ye = m[m['quarter'] == 4][['lender_id', 'year', 'cre_total', 'cre_investment', 'assets', 'loans', 'deposits', 'borrowings']].copy()
    ye['year'] = ye['year'] + 1
    ye = ye.rename(columns={c: c + '_pye' for c in ['cre_total', 'cre_investment', 'assets', 'loans', 'deposits', 'borrowings']})
    m = m.merge(ye, on=['lender_id', 'year'], how='left')

    # average balances over the YTD window: mean of prior Dec 31 and each quarter-end this year through current
    for col in ['assets', 'loans', 'deposits', 'borrowings']:
        s = m.groupby(['lender_id', 'year'])[col].cumsum()
        cnt = m.groupby(['lender_id', 'year']).cumcount() + 1
        pye = m[col + '_pye']
        m['avg_' + col] = np.where(pye.notna(), (s + pye) / (cnt + 1), s / cnt)
    m['avg_funding'] = m['avg_deposits'] + m['avg_borrowings']

    for c in ['deposits', 'assets', 'loans', 'total_rbc', 'avg_assets', 'avg_loans', 'avg_funding']:
        m[c] = m[c].where(m[c] > 0)                # zero/negative denominators -> NaN
    m['loan_to_deposit_pct'] = m['loans'] / m['deposits'] * 100
    m['net_worth_ratio_pct'] = m['equity'] / m['assets'] * 100
    m['funding_cost_pct'] = m['int_expense_ytd'] * ann / m['avg_funding'] * 100
    m['nim_pct'] = m['nii_ytd'] * ann / m['avg_assets'] * 100
    m['roa_pct'] = m['net_income_ytd'] * ann / m['avg_assets'] * 100
    m['loan_yield_pct'] = m['loan_income_ytd'] * ann / m['avg_loans'] * 100
    m['cre_pct_capital'] = m['cre_investment'] / m['total_rbc'] * 100
    m['constr_pct_capital'] = m['cre_constr'] / m['total_rbc'] * 100
    m['cre_total_pct_loans'] = m['cre_total'] / m['loans'] * 100
    m['brokered_pct'] = m['brokered'] / m['deposits'] * 100
    m['nonmember_dep_pct'] = m['nonmember_deposits'] / m['deposits'] * 100
    m['npl_pct'] = m['npl'] / m['loans'] * 100
    m['cre_npl_pct'] = m['cre_npl'] / m['cre_total'].where(m['cre_total'] > 0) * 100
    m['cre_net_change_ytd'] = m['cre_total'] - m['cre_total_pye']
    m['cre_investment_net_change_ytd'] = m['cre_investment'] - m['cre_investment_pye']
    m['cre_granted_avg_loan'] = m['cre_granted_ytd'] / m['cre_granted_ytd_n'].replace(0, np.nan)
    # regulatory headroom
    bank = m['charter'] == 'bank'
    m['cre_cap_remaining'] = np.where(bank, 3.0 * m['total_rbc'] - m['cre_investment'], np.nan)
    m['constr_cap_remaining'] = np.where(bank, 1.0 * m['total_rbc'] - m['cre_constr'], np.nan)
    mbl_cap = np.minimum(1.75 * m['equity'], 0.1225 * m['assets'])
    cu_nonlicu = (~bank) & (m['licu'] != 1)
    m['mbl_cap'] = np.where(cu_nonlicu, mbl_cap, np.nan)
    m['mbl_cap_remaining'] = np.where(cu_nonlicu, mbl_cap - m['mbl_balance'], np.nan)
    m['mbl_cap_used_pct'] = np.where(cu_nonlicu, m['mbl_balance'] / mbl_cap * 100, np.nan)
    # legal lending limit proxy: 15% of total capital (banks) / 15% of net worth (CUs, per 12 CFR 723)
    m['lending_limit_est'] = 0.15 * m['total_rbc']
    return m

if __name__ == '__main__':
    b = banks(); c = cus()
    print('banks', b.shape, 'cus', c.shape)
    m = pd.concat([b, c], ignore_index=True)
    m = add_metrics(m)
    m.to_parquet(f'{D}/metrics_quarterly.parquet', index=False)
    print(m.shape); print(m.groupby(['charter', 'period']).size().unstack(0).tail(3))
