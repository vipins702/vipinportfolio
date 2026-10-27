// Articles that ship with the site. boot() inserts them once (kv 'postsSeeded'), and
// ON CONFLICT (slug) DO NOTHING means an article you already have is never overwritten.
// After that they are ordinary posts: edit or delete them in Admin → Articles.
module.exports = [
  {
    slug: 'multi-source-sap-s4hana-data-migration',
    title: 'Seven sources, one S/4HANA: the real work in a multi-source data migration',
    summary: 'Moving one ERP is a migration. Moving seven systems into one S/4HANA is a reconciliation problem. Why it matters, where the complexity hides, and how the match job decides the outcome.',
    tags: 'SAP S/4HANA, Data Migration, Syniti ADMM, Data Quality',
    cover: '/img/articles/multi-source-s4hana-cover.jpg',
    cover_alt: 'Seven source systems flowing through a match, join and dedupe stage into a single SAP S/4HANA target',
    seo_title: 'Multi-source S/4HANA migration: match, join and dedupe',
    seo_description: 'A multi-source S/4HANA migration is a reconciliation problem. Where the complexity hides, and how a match job builds one record the business trusts.',
    keywords: 'multi-source S/4HANA migration, SAP S/4HANA data migration, match and merge, data deduplication, Syniti ADMM',
    featured: true,
    body: `Moving one SAP ECC system to S/4HANA is a migration. A multi-source S/4HANA migration, where SAP ECC plus a GIS platform, a facilities system, an asset system, a mobile field app and a folder of spreadsheets all land in one S/4HANA, is something else: it is a reconciliation problem that happens to end in a load.

The difference matters, because most programme plans are written for the first case and staffed for it. The extract, transform and load steps look the same on a slide. The work that decides whether you go live on time sits between them, in the part where seven systems disagree about what a customer, a site or an asset actually is.

This article walks through that part: why multi-source consolidation is becoming the normal case, where the complexity really comes from, and how the match job turns seven partial truths into one record the business will sign off.

## Why this is the normal case now

There are three forces pushing organisations toward one S/4HANA fed by many sources, rather than a clean one-to-one conversion.

- **The ECC deadline.** SAP's mainstream maintenance for ECC 6.0 ends in 2027, with optional extended maintenance to 2030. Programmes that have been deferred for years are now running in parallel with everything else.
- **Mergers, acquisitions and carve-outs.** Two businesses that merge rarely run the same stack. The S/4HANA programme becomes the moment the combined company decides which customer list, which material master and which chart of accounts is the real one.
- **Systems that grew up around the ERP.** Facilities, geospatial, asset maintenance and field mobility platforms each hold master data the ERP never had. A greenfield or selective S/4HANA design is the first chance in a decade to bring that data under one model.

The result is that the "source" in a source-to-target mapping is rarely one system. It is a set of systems, each correct about something and wrong about something else.

## The architecture, end to end

Here is the shape of a multi-source programme I use as a reference. Seven sources on the left, a staging and transformation layer in the middle, and S/4HANA on the right.

![Multi-source migration architecture: SAP ECC, Geo World, Oasis, Archibus, Files, Mobility and Hexagon flow through data scan, Syniti source DB, design, mapping, transforms, pre-load, load file and post-load into SAP S/4HANA](/img/articles/multi-source-s4hana-architecture.webp)

Read it left to right:

1. **Data scan and snapshot.** Every source is extracted into a staging database (here, the Syniti source DB) as a point-in-time snapshot. Nothing is transformed yet. The point is to have one place where all seven sources can be queried together, with the extract timestamp recorded.
2. **Data analysis, profiling and deduplication.** Before anyone writes a mapping rule, each source is profiled: completeness, formats, key uniqueness, code values, orphans. This is also where cross-source matching starts. Its output, the match and join result, feeds the transforms directly.
3. **Design and mapping.** The target data set design (what S/4HANA needs, object by object) is the reference. Mapping says, field by field, which source wins and how its value is converted.
4. **Transforms.** Mapping rules and match results are applied to build target-shaped records in the Syniti target DB.
5. **Pre-load validation.** The business team reviews what will be loaded before it is loaded. This is the cheapest point to catch a wrong decision.
6. **Load file and load.** Validated records are written to load files and loaded through the S/4HANA Migration Cockpit (LTMC in older releases), with master data quality checks on the target side.
7. **Post-load reconciliation.** What landed in S/4HANA is compared back to what was meant to land, and the business signs off against the reconciliation, not against a feeling.

None of these boxes is unusual. What makes the multi-source version hard is box 2, and how much of everything downstream depends on it.

## Where the complexity actually hides

When you migrate one ERP, the source has already solved identity for you. A customer number is a customer. When you have seven sources, nobody has solved it. That shows up in five ways.

### 1. Every source has its own key, and none of them is shared

The ERP knows a functional location by its SAP ID. The facilities system knows the same building by a site code. The GIS platform knows it by a polygon and a parcel reference. The asset system knows a pump inside it by an asset tag, and the mobile app knows that pump by whatever the technician scanned. There is no column you can join on. The join has to be built.

### 2. The same word means different things

"Site" in one system is a campus. In another it is a building. In a third it is a cost centre with an address attached. "Active" might mean "in service", "not deleted" or "has had a transaction this year". If the mapping workshop does not pin these down, the load will succeed and the data will still be wrong.

### 3. Each source is the best source for something

The ERP is usually right about financial attributes. The facilities system is usually right about floor areas and occupancy. The GIS platform is right about location. The field app is the most recent about condition. So survivorship cannot be "system A wins". It has to be decided attribute by attribute, and written down.

### 4. Quality varies by source and by year

Older records are thinner. Free-text fields were used as workarounds. One source enforces mandatory fields and another never did. Profiling each source separately is what tells you which matching approach will work for it, and which records will need a human.

### 5. The sources keep changing while you migrate

A multi-source programme runs several mock loads over months. Every source keeps taking transactions in the meantime. Your match results have to be repeatable on a fresh snapshot, or each mock load becomes a new manual exercise.

## The match job: how seven partial truths become one record

The match job is the heart of the programme. Its output is a cross-reference: for every target record, which source records it was built from, and why. Get it right and transforms are straightforward. Get it wrong and you find out in post-load reconciliation, when it is expensive.

A match job that holds up through several mock loads has five stages.

### Stage 1: standardise before you compare

Matching raw values finds almost nothing. Normalise first: case, whitespace, punctuation, legal-form suffixes on company names, address abbreviations, phone and postcode formats, and code values mapped to one list. Keep the original value next to the standardised one, so every match can be explained.

### Stage 2: block, so you are not comparing everything with everything

Seven sources with tens of thousands of records each cannot be compared pairwise. Blocking limits comparisons to plausible candidates, for example the same postcode, the same city and first letters of the name, or the same asset class and site. Good blocking is the difference between a match job that runs in minutes and one that never finishes.

### Stage 3: match in passes, strongest evidence first

Run deterministic passes before fuzzy ones, and record which pass produced each match:

- **Pass 1, shared identifiers.** Where a source already stores another system's key (an ERP number held in the facilities system, say), use it. These are your highest-confidence links.
- **Pass 2, exact match on standardised attributes.** Name plus address, or asset tag plus site.
- **Pass 3, fuzzy match with a score.** Similarity on names and addresses, weighted, with a threshold.

Here is the shape of a fuzzy pass in SQL. The specifics change by platform; the structure does not.

\`\`\`sql
-- candidates from the same block, scored on name and address similarity
SELECT a.src AS src_a, a.rec_id AS id_a,
       b.src AS src_b, b.rec_id AS id_b,
       0.6 * similarity(a.name_std, b.name_std)
     + 0.4 * similarity(a.addr_std, b.addr_std) AS score
FROM   stg_site a
JOIN   stg_site b
  ON   a.block_key = b.block_key        -- blocking: postcode + city
 AND  (a.src, a.rec_id) < (b.src, b.rec_id)
WHERE  NOT EXISTS (SELECT 1 FROM xref x  -- already linked by passes 1 and 2
                   WHERE x.src = a.src AND x.rec_id = a.rec_id)
\`\`\`

### Stage 4: decide with three bands, not one threshold

A single threshold forces a bad trade between false merges and missed duplicates. Use three bands instead:

- **Auto-match** above a high score. Linked without review.
- **Review** in the middle band. Sent to a data steward with both records side by side.
- **No match** below a low score. Treated as distinct.

Set the bands from a labelled sample, not from intuition, and re-check them after each mock load. A false merge is usually worse than a missed duplicate, because it silently combines two real things into one, so set the auto-match band conservatively.

### Stage 5: survivorship, written down per attribute

Once records are grouped, decide which value each attribute takes in the golden record: name from the ERP, address from the GIS platform, floor area from the facilities system, condition from the most recent field visit. Store these rules as data, not in someone's head, so the same rules run on every mock load and the business can audit them.

> Fuzzy matching only finds candidates. Deciding which record survives is a business decision, and it should be recorded like one.

## What the business has to own

The technical team can build the match job. Only the business can make the calls it raises. Three of them come up on every programme:

- **The survivorship matrix.** Which source wins for each attribute, and what happens when the winner is blank.
- **The review queue.** Someone with authority has to clear the middle band before each load, against a deadline.
- **Sign-off criteria.** What reconciliation result counts as done: record counts per object, key financial totals, and the number of open exceptions the business accepts at go-live.

Put these in the plan with names next to them. In my experience, when a multi-source programme slips, it is rarely the load tooling. It is an unowned decision waiting in a queue.

## Reconciliation closes the loop

Post-load reconciliation in a multi-source programme has to answer two questions, not one:

1. **Did everything we meant to load arrive?** Counts and checksums per object, from load file to S/4HANA.
2. **Can every target record be traced back?** For any customer, site or asset in S/4HANA, you should be able to list the source records it came from, which match pass linked them, and which rule chose each value.

The second question is what auditors and the business ask after go-live. The cross-reference built by the match job is what lets you answer it in minutes instead of weeks.

## A short checklist before your first mock load

- Every source is profiled separately, with results the business has seen.
- Shared vocabulary is agreed: site, asset, active, customer.
- Blocking keys and match passes are defined per object, with the pass recorded on every link.
- Match bands are set from a labelled sample, with a named owner for the review queue.
- The survivorship matrix is written down and stored as data.
- Reconciliation reports trace target records back to sources, not just counts.

---

Multi-source consolidation is where data migration stops being a technical exercise and becomes a business one. The tooling to extract, transform and load is mature. The part that still decides success is matching and survivorship: getting seven systems to agree on what is true, and being able to show how you decided.

If you are planning a consolidation into S/4HANA and want a second view on the match approach or the reconciliation design, get in touch.`
  }
];
