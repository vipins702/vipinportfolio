// Default site copy. Everything here is editable from Admin → Edit website.
// Employers and client names are deliberately omitted — engagements are described by sector and scope only.
module.exports = {
  brand: { name: 'Vipin Singh', role: 'Data Transformation Strategy · Migration, M&A & Integration', linkedin: 'https://www.linkedin.com/in/vipin-s-1132182b', email: 'vipinsingh498@gmail.com', location: 'Greater Noida, India · Working globally' },
  seo: { title: 'Vipin Singh — Enterprise Data Transformation, Migration & Integration Lead', description: 'Data transformation lead with 14+ years in migration strategy, ETL architecture and data quality. S/4HANA, Oracle, Snowflake and CRM integration, M&A and carve-out data consolidation, deduplication and cutover.' },
  hero: {
    chapters: [
      { label: 'Strategy', title: 'Transformation, planned around the data.', text: '14+ years leading enterprise data strategy, migration architecture and the teams that deliver it.' },
      { label: 'Consolidate', title: 'Two companies, one master record.', text: 'Mergers, carve-outs and multi-platform estates, consolidated without losing the audit trail.' },
      { label: 'Quality', title: 'Duplicates are found before the load.', text: 'Profiling, fuzzy matching and cleansing across supplier, customer and material from five source systems.' },
      { label: 'Land', title: 'Every load reconciles, and the business signs it.', text: 'Cutover sequencing, rehearsals and reconciliation reports a data owner can put their name to.' }
    ],
    badges: ['Migration Strategy', 'M&A & Carve-outs', 'SAP S/4HANA', 'Oracle · Snowflake · CRM', 'Data Quality & Dedupe']
  },
  story: { line1: 'Every transformation is a data problem wearing a business case.', line2: 'The data decides whether it lands.', text: 'Vipin Singh leads enterprise data transformation — migration strategy and ETL architecture, master data consolidation across merging or separating businesses, and integration between SAP, Oracle, cloud warehouses and CRM. 14+ years in data architecture, complex SQL and offshore delivery leadership.' },
  services: {
    heading: 'Where Vipin helps', intro: 'Six places a transformation programme meets its data, and where the risk actually sits.',
    items: [
      { title: 'Transformation & migration strategy', text: 'Approach, scope and sequencing — greenfield, brownfield or selective — with the data effort sized honestly up front rather than discovered in the first mock cycle.' },
      { title: 'M&A, carve-out & divestiture data', text: 'Merging two master data estates into one, or separating one cleanly into two. Entity matching, survivorship rules, Day 1 readiness and the reconciliation evidence auditors will ask for.' },
      { title: 'Platform migration & integration', text: 'Moving and connecting data across SAP S/4HANA and ECC, Oracle, cloud data warehouses such as Snowflake, CRM platforms and legacy systems — with mappings the business can actually review.' },
      { title: 'Data quality & deduplication', text: 'Profiling, cleansing and fuzzy duplicate detection for supplier, customer and material consolidated from multiple systems. Match logic and confidence scores presented to data owners for merge decisions.' },
      { title: 'Cutover, reconciliation & go-live', text: 'Load sequencing, mock cycles and dress rehearsals, preload validation and postload reconciliation reports that business owners sign before and after every load.' },
      { title: 'AI & automation in data work', text: 'API-based fuzzy matching, RAG search across mapping and migration documents, and SQL automation that replaces manual status consolidation and wave-to-wave comparison.' }
    ]
  },
  platforms: {
    heading: 'Platforms and tooling', intro: 'Where the data comes from, where it lands, and what moves it.',
    items: [
      { name: 'SAP S/4HANA & ECC', note: 'Migration Cockpit (DMC), LTMOM, load strategy and TR movement' },
      { name: 'Syniti ADMM & Replicate', note: 'ETL architecture, scans, mapping, transforms; admin and access management' },
      { name: 'Oracle', note: 'PL/SQL, extraction and reconciliation against legacy estates' },
      { name: 'Cloud data warehouses', note: 'Snowflake and HANA targets for analytics and reporting layers' },
      { name: 'CRM platforms', note: 'Five years implementing enterprise CRM for banks and financial institutions' },
      { name: 'SQL Server & SSIS', note: 'T-SQL automation, custom ETL pipelines, tracking and status reporting' },
      { name: 'Python & AI APIs', note: 'Fuzzy matching, RAG architecture and vector search over migration documents' },
      { name: 'Git, TFS & Jira', note: 'Version control and delivery tracking across offshore teams' }
    ]
  },
  impact: {
    heading: 'What good looks like', intro: 'Figures from recent delivery. Update these in the CMS as programmes close.',
    metrics: [
      { value: '14', suffix: '+', label: 'Years in data architecture & ETL', note: 'Migration, integration, delivery leadership' },
      { value: '72', suffix: '', label: 'Migration objects delivered', note: 'Across STP, OTC, FIN, PTD, ATR and DTS' },
      { value: '20', suffix: '', label: 'Offshore engineers led', note: 'Planning, allocation, quality and delivery' }
    ]
  },
  engagements: {
    heading: 'Selected engagements', intro: 'Described by sector and scope. Client and employer names are withheld.',
    // `stage` picks the card's colour on the site. One of: source, stage, profile,
    // map, verify, load. It must name the stage the work actually centred on - the
    // hue is an index, not decoration. Omit it and the card falls back to the brand
    // accent rather than guessing.
    items: [
      { stage: 'verify', client: 'Offshore data lead — S/4HANA transformation', sector: 'Energy & industrial', scope: 'Led a 20-person offshore team delivering 72 migration objects across STP, OTC, FIN, PTD, ATR and DTS. Owned the ETL architecture end to end, contributed to functional and technical design, and defined the transport movement strategy across environments.', outcome: 'Mock cycle and dress rehearsal readiness owned end to end, with preload and postload reports signed off by business owners before each load.' },
      { stage: 'map', client: 'Technical lead — multi-country platform migration', sector: 'Energy', scope: 'Multi-country migration waves from extraction and transformation through load and reconciliation. Designed the migration architecture and reusable mapping frameworks, and built wave-to-wave comparison and mapping validation automation.', outcome: 'Reusable standards cut development effort across waves; automated validation replaced manual wave comparison.' },
      { stage: 'profile', client: 'Master data consolidation across five systems', sector: 'Cross-industry', scope: 'Designed the duplicate-finding solution for supplier, customer and material where source data arrived from five different systems — the same problem shape as a post-merger master data merge. Built API-based fuzzy matching and presented match logic with confidence scores for merge decisions.', outcome: 'Duplicates resolved as a business decision with named data owners, before load rather than after go-live.' },
      { stage: 'load', client: 'Enterprise CRM delivery', sector: 'Banking & financial services', scope: 'Five years designing and delivering enterprise CRM implementations for banks and financial institutions, including integration, workflow and reporting components. Led implementation teams and tuned database performance for higher transaction volumes.', outcome: 'Customer data integration and reporting delivered into regulated banking environments.' }
    ]
  },
  process: {
    heading: 'How an engagement runs', intro: 'A simple, transparent sequence, so you always know what happens next.',
    steps: [
      { title: 'Scan & profile', text: 'Snapshot every source system, then profile it. You cannot map what you have not measured.' },
      { title: 'Design & map', text: 'Target structure, survivorship rules and a mapping document the business can read and challenge.' },
      { title: 'Transform & reconcile', text: 'Iterative load cycles with cleansing, validation and reconciliation reports after every run.' },
      { title: 'Cutover & hypercare', text: 'Dress rehearsal, sequenced go-live and support through the first period close.' }
    ]
  },
  // Both sections stay hidden on the site until an item is filled in: a testimonial needs
  // a quote and a name, a certification needs a name. Photo, image and links are optional.
  testimonials: { heading: 'What colleagues and clients say', intro: 'From people Vipin has delivered programmes with.', items: [] },
  certifications: { heading: 'Certifications', intro: 'Current credentials, each with a link to verify it.', items: [] },
  about: { heading: 'About Vipin', text: 'Vipin Singh is a data transformation lead with 14+ years in data architecture, ETL design and complex SQL. He leads offshore delivery teams on enterprise programmes, owns the migration and integration architecture, and designs the data quality and deduplication approach that decides whether a load can be signed off. His background spans SAP S/4HANA migration, Oracle and SQL Server estates, cloud reporting layers and five years of enterprise CRM delivery in banking — the combination that matters when two businesses merge, one is carved out, or a platform estate has to be consolidated. He also builds AI and RAG tooling into data work: fuzzy matching, knowledge search and automated status reporting. B.Tech, Uttar Pradesh Technical University.', photo: '/img/vipin.jpg', stats: [{ value: 'Strategy', label: 'Migration & integration architecture' }, { value: 'M&A', label: 'Consolidation & carve-out data' }, { value: 'Quality', label: 'Profiling, matching & dedupe' }, { value: 'AI', label: 'Fuzzy matching & RAG search' }] },
  booking: { heading: 'Book a discovery call', text: 'Pick a time that suits you. Vipin will confirm by email.', topics: ['Transformation & migration strategy', 'M&A, carve-out or divestiture data', 'Platform migration & integration', 'Data quality & deduplication', 'Cutover & go-live readiness', 'Something else'] },
  contact: { heading: 'Let us start with the data.', text: 'Tell Vipin about the programme and where the data risk sits. You will get a reply within one business day.' },
  footer: { note: 'Website developed by VSM Tech & AI Solutions Agency' }
};
