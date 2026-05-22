---
description: Pull all template field positions from the production API and update templateSeedData.json
argument-hint: [prod-api-url] [staff-email] [staff-password]
---

# Sync Field Positions from Production

Pull all template fields and groups from the live production API into
`apps/api/src/seeds/templateSeedData.json` so that future deploys
preserve any edits made in the production admin UI.

---

## Step 1 — Resolve connection details

From `$ARGUMENTS` extract (all optional — fall back to defaults):
- `PROD_API_URL` — base URL of the production API, e.g. `http://3.15.224.150:4000`
  Default: `http://3.15.224.150:4000`
- `STAFF_EMAIL` — Default: `admin@nurturekidspediatrics.com`
- `STAFF_PASSWORD` — Default: `Admin@12345`

If arguments are blank, use the defaults above.

---

## Step 2 — Discover the API URL (if not provided)

If `PROD_API_URL` is unknown, probe common ports on the host:

```bash
for port in 4000 3000 8080 5000; do
  result=$(curl -s --connect-timeout 3 "http://<HOST>:$port/health" 2>/dev/null)
  echo "$port: $result"
done
```

Use the port that returns `{"status":"ok",...}`.

---

## Step 3 — Log in and get a token

```bash
PROD_TOKEN=$(curl -s -X POST "$PROD_API_URL/api/staff/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$STAFF_EMAIL\",\"password\":\"$STAFF_PASSWORD\"}" \
  | python3 -c "import json,sys; print(json.loads(sys.stdin.read())['data']['token'])")
echo "Token: ${PROD_TOKEN:0:40}..."
```

---

## Step 4 — List templates

```bash
curl -s "$PROD_API_URL/api/staff/templates" \
  -H "Authorization: Bearer $PROD_TOKEN" \
  | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
data=d.get('data',d)
ts=data if isinstance(data,list) else data.get('templates',[])
for t in ts: print(t['id'], t.get('template_key'), t.get('name'))
"
```

Note every template ID returned.

---

## Step 5 — Pull and write the seed file

Run this Python script (replace the `template_ids` list with what Step 4 returned):

```python
python3 << 'EOF'
import json, subprocess

PROD_API_URL = "http://3.15.224.150:4000"
PROD_TOKEN   = "<TOKEN_FROM_STEP_3>"
SEED_FILE    = "apps/api/src/seeds/templateSeedData.json"

template_ids = [
    # paste IDs from Step 4
]

# Load local seed to preserve template-level metadata (keys, versions, timestamps)
with open(SEED_FILE) as f:
    local_seed = json.load(f)
local_tmpl_map = {t['id']: t for t in local_seed['templates']}

new_templates, new_fields, new_groups = [], [], []

FIELD_COLS = ['id','template_id','field_id','field_name','field_type','acro_field_name',
              'required','page_number','x','y','width','height','options_json',
              'validation_json','section_key','display_order','font_size',
              'group_id','group_value','parent_field_id','created_at','updated_at']
GROUP_COLS = ['id','template_id','group_type','group_name','acro_group_name','created_at']

for tid in template_ids:
    r = subprocess.run(
        ['curl','-s', f'{PROD_API_URL}/api/staff/templates/{tid}',
         '-H', f'Authorization: Bearer {PROD_TOKEN}'],
        capture_output=True, text=True)
    data = json.loads(r.stdout)['data']
    local_t = local_tmpl_map.get(tid, {})

    new_templates.append({
        'id':           data['id'],
        'template_key': local_t.get('template_key', data['template_key']),
        'version':      local_t.get('version', data['version']),
        'name':         data['name'],
        'status':       data['status'],
        'created_at':   local_t.get('created_at', data['created_at']),
        'updated_at':   local_t.get('updated_at', data['updated_at']),
    })

    for f in data['fields']:
        row = {k: f.get(k) for k in FIELD_COLS}
        # Normalise types expected by the SQLite seed
        row['required'] = 1 if row['required'] else 0
        for col in ('options_json', 'validation_json'):
            if not isinstance(row[col], str):
                row[col] = json.dumps(row[col]) if row[col] is not None else ('[]' if col == 'options_json' else '{}')
        new_fields.append(row)

    for g in data['groups']:
        new_groups.append({k: g.get(k) for k in GROUP_COLS})

    # Reconstruct any group records missing from the DB but referenced by radio fields.
    # This happens when a template was originally seeded without its group records.
    existing_group_ids = {g['id'] for g in new_groups}
    from collections import defaultdict
    orphans = defaultdict(list)
    for f in data['fields']:
        gid = f.get('group_id')
        if gid and gid not in existing_group_ids:
            orphans[gid].append(f['field_id'])
    for gid, field_ids in orphans.items():
        parts = field_ids[0].rsplit('_', 1)
        group_name = parts[0] if len(parts) > 1 else field_ids[0]
        new_groups.append({
            'id': gid, 'template_id': tid,
            'group_type': 'radio', 'group_name': group_name, 'acro_group_name': group_name,
            'created_at': '2026-01-01T00:00:00.000Z',
        })

    recovered = len(orphans)
    print(f"  {data['name']}: {len(data['fields'])} fields, {len(data['groups'])} groups" +
          (f" (+{recovered} reconstructed)" if recovered else ""))

with open(SEED_FILE, 'w') as f:
    json.dump({'templates': new_templates, 'fields': new_fields, 'groups': new_groups}, f, indent=2)

print(f"\nWrote {len(new_templates)} templates, {len(new_fields)} fields, {len(new_groups)} groups → {SEED_FILE}")
EOF
```

---

## Step 6 — Verify locally

Restart the API and confirm seed succeeds:

```bash
lsof -ti:4000 | xargs kill -9 2>/dev/null; sleep 1
npm run dev --workspace=apps/api &
sleep 6 && curl -s http://localhost:4000/health
```

The startup log must print `bootstrapped N new template(s) with M field(s) and K group(s)` on a fresh DB, or `all templates already seeded` on a warm DB — **not** `template seed failed`.

---

## Step 7 — Commit and push

```bash
git add apps/api/src/seeds/templateSeedData.json
git commit -m "Sync field positions from production"
git push origin main
```

---

## Key facts to remember

| Thing | Value |
|---|---|
| Production API | `http://3.15.224.150:4000` |
| Frontend | `http://3.15.224.150:3001` |
| Staff login | `admin@nurturekidspediatrics.com` / `Admin@12345` |
| Seed file | `apps/api/src/seeds/templateSeedData.json` |
| Seed behaviour | Fields are only inserted once — seeder skips a template if it already has fields (DB is source of truth) |
| SQLite quirks | `required` must be `0`/`1`; `options_json`/`validation_json` must be JSON strings |
