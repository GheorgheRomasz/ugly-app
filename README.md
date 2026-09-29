# UGLY local development

UGLY remains a static single-page app. The existing artwork, CSS, screens, ranking weights and price-sanity formula are preserved.

## Run

From this folder, run `node serve.cjs`, then open http://127.0.0.1:4173. The server listens only on this computer. No package installation is required.

Run `node --test tests/search.test.cjs` for the regression suite.

For explicitly labeled local-catalog browser tests, run `node serve.cjs --fixtures` and open http://127.0.0.1:4174. This uses the two local product files to return test responses. It does not simulate Typesense relevance or change the remote index. It is not a fallback in the normal app.

## Search flow

1. The home screen captures a query; the next screen chooses a preference.
2. The browser requests title matches from the configured Typesense collection using the existing search-only configuration in index.html.
3. Up to four pages of 250 candidates are loaded. Token dropping is disabled so a multiword query is not silently reduced to one word. A notice appears when more than 1,000 matches exist.
4. UGLY applies its existing title/alias matching, product-intent rules, 75th-percentile price-sanity cutoff and relevance weights.
5. Best Deal sorts by relevance then price; Cheapest sorts by price then relevance. Sorting now precedes duplicate-title removal. Up to ten results are shown.
6. Fastest retains its existing relevance order and explicitly says delivery data is unavailable.

Requests time out after 15 seconds. Leaving results or starting a new search cancels the prior request; late responses cannot overwrite newer results. Invalid titles/prices are rejected. Missing images/links are handled without inventing content.

## Verified on 2026-09-27

The corrected user-supplied key returns HTTP 200. The records visible through this key total five test products: three smartphones, a case and a replacement part. iPhone shows the three phones; gaming laptop, Nintendo and TV correctly return no matches. Test records lack image and link fields.

The two local JSON files contain 73,399 entries; products.json is empty. These files are not automatically imported into Typesense or used by live search. All four requested queries returned ten relevant products on the explicitly labeled local test server. All 24 automated tests passed.

## Remaining integration work

Populate or connect the intended production catalog in Typesense, including usable image/link fields. No remote data was imported or changed during this work. Do not put an admin key in index.html.

The candidate limit means Cheapest is cheapest among fetched candidates, not a guarantee across the entire catalog. Existing client-side aliases and exact text checks are still applied after Typesense retrieval; they are not server-side synonym configuration. Product condition is displayed as NEW as before; the provided local feed does not include an explicit condition field, and newness in the test index is not treated as condition.

Typesense parameter reference: https://typesense.org/docs/30.0/api/search.html
