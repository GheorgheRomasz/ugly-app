# UGLY offline DWYN importer

This folder is separate from the frontend. It uses Node.js built-ins only (Node 20+), requires no package installation or credentials, and makes no network requests. It has no upload or schema-alter command. It does not load index.html or the full product files.

## Run the reviewed sample

From the Ugly.com project folder:

```powershell
node catalog-import/import.cjs --input catalog-import/input/dwyn-sample-100.json --out catalog-import/runs/review-001
node --test catalog-import/test/import.test.cjs
```

The output directory must be new. The importer refuses raw catalog arrays, sample envelopes other than exactly 100 records, malformed fields and duplicate source identities. A validation failure writes an error report but no partial JSONL. It reads each entry's original record, not values guessed in mapping_preview.

## Outputs

- products.jsonl: one Typesense-shaped product per line. Null optionals are omitted. No live schema compatibility or publication readiness is implied.
- normalized.json: all 100 normalized records with explicit null placeholders for unknown values.
- audit.json: original records, source file/index traces, identity tuples, normalized values and warnings.
- validation.json: counts, errors, unresolved currency and publication blockers.
- proposed-schema.json: proposed explicit collection schema, not an ALTER request.
- schema-review.json: unresolved schema notes, or a comparison against a supplied offline schema snapshot.
- example-product.json: the first JSONL document, formatted for review.
- manifest.json: input/output and normalizer checksums.

To compare an exported schema locally, add `--schema path/to/schema.json`. No schema is fetched automatically. Comparison findings need manual review, especially existing default_sorting_field, dynamic fields and schema changes affecting existing records. Never POST proposed-schema.json over an existing collection or treat it as an automatic migration.

## Mapping and unknowns

Required local source values: nonempty title, merchant equal to dwyn.ro, finite positive numeric price, and supported 2Performant product-store link with a single campaign_unique and unique parameter. Image/description and future fields are optional. Titles receive text entity decoding, Unicode NFC normalization and whitespace cleanup; no brand is inferred from titles. URLs stay exactly as supplied.

Future source fields supported: brand, category, merchant_category, merchant_product_id, country (two-letter format), regions (string array), currency (supported ISO currency code), product_url, availability, condition, source_exported_at, source_updated_at, product_released_at, first_seen_at, last_seen_at, imported_at. Source timestamps must be explicit ISO UTC strings, e.g. 2026-09-27T12:00:00Z; output timestamps are Unix seconds. Numeric legacy dates are rejected as ambiguous. No timestamps are fabricated. The existing legacy newness field is left null/omitted until its meaning is defined.

Missing availability and condition become unknown. Other missing values remain null in normalized.json and are omitted from JSONL. An empty description is omitted. No category, brand, RO delivery coverage, currency or newness is inferred from merchant names, title words, UI labels, model years, image paths or filesystem timestamps.

RON is accepted only when an explicit source currency field says RON. There is no --currency RON default. Currency labels such as lei are rejected rather than guessed. All current sample records have currency_status=unresolved.

## Stable identity

```
identity = ["dwyn-affiliate-v1", "dwyn.ro", "2performant", campaign_unique, unique]
id = "dwyn_" + SHA256(JSON.stringify(identity))
```

Use the full lowercase SHA-256 hex digest. Source tokens are case-sensitive. ID excludes title, price, image URL, file position, affiliate aff_code, query ordering and unrelated tracking parameters. Thus changes to those values do not create a new identity. The original outbound link is preserved independently.

This represents a merchant offer/source item, not a cross-store product identifier. Stability is conditional on the source retaining the same campaign/item tokens. A changed campaign or item token generates a new ID. Reject missing/ambiguous tokens; do not silently switch to a title or URL hash. If verified merchant SKUs arrive later, use an explicit identity crosswalk/migration instead of changing IDs silently.

## Schema and credentials

The proposed schema uses title:string, price:float and merchant:string; future/missing metadata is optional. URL and provenance fields are unindexed stored fields. The built-in id is not declared in the field list. No legacy newness type change is proposed; make it optional if it is currently required and absence must be allowed, after checking any default sort dependency.

Current preprocessing requires filesystem access only. A later read-only schema check needs collections:get scoped to ugly_products. A future approved bulk upload would use a separate local credential with documents:import for ugly_products, and action=upsert; verify action-specific permissions on the deployed server before that step. That key must not be placed in the frontend, sample, logs or generated artifacts. Schema management remains a separate explicitly approved operator action, never a permission bundled into this converter. The frontend keeps its search-only key.

## Publication limitation

All current sample offers are blocked for publication because currency and source freshness are unresolved and condition is unknown. UGLY currently labels every price RON and every offer NEW. Do not upload these review records into its live collection without resolving those facts or agreeing a separate display policy. This work does not change that UI. JSONL serialization readiness is not merchant data verification or approval to upload.

A future uploader must inspect every Typesense import response line rather than treating HTTP 200 as complete success. No full catalog import, deletion, reconciliation or scheduling is implemented.

References:
- https://typesense.org/docs/30.0/api/collections.html
- https://typesense.org/docs/30.0/api/documents.html#index-multiple-documents
- https://typesense.org/docs/30.0/api/api-keys.html
