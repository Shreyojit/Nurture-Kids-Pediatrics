# PediForm Pro - Release 1

PediForm Pro is a template-driven pediatric intake platform with an integrated AcroForm builder.

## Release 1 Features

- Staff template builder inside the same app (no separate application)
- Upload source PDF and author form fields (`field_id`, `field_name`, type, coordinates, etc.)
- Generate AcroForm PDF and publish template versions
- Parent intake renderer driven by published template fields
- Autosave and submission persistence in SQLite
- Parent account creation/login (Gmail + password)
- Staff patient workspace with editable normalized tables
- Export canonical JSON and filled PDF (`<patient>_patientregistration.pdf`)
- DB helper scripts for inspect/query/reset/migrate/seed

## Project Structure

- `apps/api`: Express + TypeScript + SQLite backend
- `apps/web`: React + Vite frontend
- `docs`: product/technical docs and manuals

## Quick Start

Install dependencies:

```bash
npm install
```

Run backend + frontend:

```bash
npm run dev
```

URLs:

- Web: `http://localhost:5173`
- API: `http://localhost:4000`

## Seeded Defaults

- Staff email: `admin@sunshineclinic.com`
- Staff password: `Admin@12345`
- Practice slug: `sunshine-pediatrics`

## First-Time Setup Requirement

Parent intake requires a published template.

1. Login as staff
2. Open `Template Builder`
3. Upload PDF with `template_key = patient_registration`
4. Add fields and coordinates
5. Generate AcroForm
6. Publish template

Then parent intake can begin.

## DB Helper Scripts

From repository root:

```bash
npm run db:status
npm run db:tables
npm run db:counts
npm run db:schema -- patients
npm run db:view -- submissions 10
npm run db:query -- "select id,status,created_at from submissions order by created_at desc limit 5"
npm run db:migrate
npm run db:seed
npm run db:reset -- --yes
```

## Full User Manual

See:

- `docs/User_Manual_Release1.md`

## Dummy note (BulkExcel-uploads)

This paragraph is placeholder text for branch workflow testing only. Lorem ipsum dolor sit amet, consectetur adipiscing elit. It has no product meaning and can be removed when real documentation is added.
