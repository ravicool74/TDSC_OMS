import requests

r = requests.post('http://127.0.0.1:8000/api/auth/login', json={'email': 'admin@triveni.com', 'password': 'admin123'})
tok = r.json()['session_token']
h = {'Authorization': f'Bearer {tok}'}

cat_res = requests.get('http://127.0.0.1:8000/api/reports/catalog', headers=h).json()
for cat in cat_res.get('categories', []):
    for rep in cat['reports']:
        rid = rep['id']
        res = requests.get(f'http://127.0.0.1:8000/api/reports/data?report_type={rid}', headers=h)
        if res.status_code != 200:
            print(f'ERROR {rid}: {res.status_code}')
            continue
        data = res.json()
        # check kpis
        for kpi in data.get('kpis', []):
            v = str(kpi.get('value', ''))
            l = str(kpi.get('label', ''))
            if any(w in l.lower() for w in ['total', 'sales', 'profit', 'amount', 'tax', 'cost', 'revenue', 'worth', 'valuation', 'dues', 'received', 'purchases', 'discount', 'balance', 'inflow', 'outflow', 'receivable', 'payable', 'gst', 'burden', 'consideration', 'collected']) and not any(w in l.lower() for w in ['count', 'items in catalog', 'units', 'accounts', 'slab', 'average profit margin', 'margin %', 'percentage']):
                if not v.startswith('₹') and not v.startswith('-₹'):
                    print(f'KPI MISSING ₹ in {rid}: [{l}] = "{v}"')
        # check rows
        rows = data.get('rows', [])
        cols = data.get('columns', [])
        col_keys = [c['key'] for c in cols]
        for row in rows[:3]:
            for ck in col_keys:
                cv = str(row.get(ck, ''))
                col_lbl = next((c['label'] for c in cols if c['key'] == ck), ck)
                if any(w in col_lbl.lower() for w in ['amount', 'price', 'rate', 'worth', 'value', 'tax', 'cost', 'profit', 'balance', 'debit', 'credit', 'paid', 'gst', 'itc', 'cgst', 'sgst', 'igst', 'subtotal', 'gross', 'net', 'dues']):
                    if not any(w in col_lbl.lower() for w in ['%', 'percent', 'margin', 'slab', 'code']):
                        if cv and cv != '—' and not cv.startswith('₹') and not cv.startswith('-₹'):
                            print(f'ROW CELL MISSING ₹ in {rid} col [{col_lbl}] ({ck}): "{cv}"')
