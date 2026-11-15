const { test, expect } = require('@playwright/test');

// Note: MutantRead has no general RefSeq-transcript-to-isoform resolver (confirmed
// absent in both our file and the collaborator's repo during the Phase 1 review), so
// "the real case" here is tested at the protein level (p.) against a synthetic UniProt
// accession, which is the actually-supported path - not a c.-transcript resolution.

const UNIPROT_URL = 'https://rest.uniprot.org/uniprotkb/TESTACC1.json';
const ALPHAFOLD_API_URL = 'https://alphafold.ebi.ac.uk/api/prediction/TESTACC1';
const ALPHAFOLD_PDB_URL = 'https://alphafold.ebi.ac.uk/files/AF-TESTACC1-F1-model_v6.pdb';
const THREEDMOL_URL = 'https://cdn.jsdelivr.net/npm/3dmol@2.0.4/build/3Dmol-min.js';

const SEQ_LEN = 250;
function buildSequence() {
  var arr = new Array(SEQ_LEN).fill('A');
  arr[199] = 'R'; // 1-indexed residue 200
  return arr.join('');
}

// A Repeat ending at 199 and a Domain (EF-hand) starting at 202, with the variant at
// 200 - squarely in the gap the old padding-only logic would land in without fully
// covering the domain. Reproduces the original EF-hand bisection bug as a fixture.
const FEATURES = [
  { type: 'Repeat', description: 'Spectrin repeat X', location: { start: { value: 180 }, end: { value: 199 } } },
  { type: 'Domain', description: 'EF-hand 1', location: { start: { value: 202 }, end: { value: 225 } } }
];

const UNIPROT_BODY = {
  primaryAccession: 'TESTACC1',
  proteinDescription: { recommendedName: { fullName: { value: 'Synthetic Test Protein' } } },
  genes: [{ geneName: { value: 'TESTGENE' } }],
  sequence: { value: buildSequence() },
  features: FEATURES
};

const FAKE_PDB = 'ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N\nEND\n';

// Stub out the real 3Dmol.js CDN script so tests don't depend on network access to
// jsdelivr or on WebGL being available in the test environment.
const THREEDMOL_STUB = `
  window.$3Dmol = {
    createViewer: function () {
      return {
        addModel: function () {},
        setStyle: function () {},
        zoomTo: function () {},
        render: function () {}
      };
    }
  };
`;

async function mockCommonRoutes(page) {
  await page.route(THREEDMOL_URL, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: THREEDMOL_STUB })
  );
  await page.route(UNIPROT_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(UNIPROT_BODY)
    })
  );
  await page.route(ALPHAFOLD_API_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify([{ pdbUrl: ALPHAFOLD_PDB_URL }])
    })
  );
  await page.route(ALPHAFOLD_PDB_URL, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/plain',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: FAKE_PDB
    })
  );
}

async function resolveTarget(page) {
  await page.goto('/mutantread/index.html');
  await page.fill('#accessionInput', 'TESTACC1');
  await page.click('#resolveBtn');
  await expect(page.locator('#resolveChip')).toHaveText('Resolved');
}

test.describe('MutantRead', () => {
  test('real case: protein-level variant validates and the window fully covers the adjacent EF-hand domain', async ({ page }) => {
    await mockCommonRoutes(page);
    await resolveTarget(page);

    await page.fill('#variantInput', 'p.Arg200Gly');
    await page.click('#validateBtn');

    await expect(page.locator('#variantChip')).toHaveText('Resolved');
    await expect(page.locator('#checklistChip')).not.toHaveText('Failed');

    const start = parseInt(await page.inputValue('#windowStart'), 10);
    const end = parseInt(await page.inputValue('#windowEnd'), 10);
    // Domain (EF-hand 1) spans 202-225 - the window must cover it fully, never bisect it.
    expect(start).toBeLessThanOrEqual(202);
    expect(end).toBeGreaterThanOrEqual(225);

    await expect(page.locator('#structureChip')).toHaveText('AlphaFold DB model');
  });

  test('keeps structure and domain map populated after a failed validation', async ({ page }) => {
    await mockCommonRoutes(page);
    await resolveTarget(page);
    await expect(page.locator('#structureChip')).toHaveText('AlphaFold DB model');
    const domainMapBefore = await page.locator('#domainMapHost').innerHTML();
    expect(domainMapBefore).toContain('<svg');

    await page.fill('#variantInput', 'not a real variant');
    await page.click('#validateBtn');

    await expect(page.locator('#variantChip')).toHaveText('Invalid');
    // Structure load is independent of validation - must still show the loaded model,
    // not be reset to idle by the failed validation.
    await expect(page.locator('#structureChip')).toHaveText('AlphaFold DB model');
    const domainMapAfter = await page.locator('#domainMapHost').innerHTML();
    expect(domainMapAfter).toContain('<svg');
  });

  test('His6 tag backtranslation has no tandem repeat of 12bp or longer', async ({ page }) => {
    await mockCommonRoutes(page);
    await page.goto('/mutantread/index.html');
    const longestRun = await page.evaluate(() => {
      const MR = window.__MR__;
      const orf = MR.backtranslateSmart(MR.TAGS.his6.peptide, MR.ECOLI_CODON, MR.ECOLI_SECONDARY);
      return MR.longestIdenticalCodonRun(orf);
    });
    // A run of 4 identical codons is 12bp; the mixed-codon tag must stay below that.
    expect(longestRun).toBeLessThan(4);
  });

  test('verification manifest invariant list covers every codon but the mutated one, and the checker flags a silent change', async ({ page }) => {
    await mockCommonRoutes(page);
    await page.goto('/mutantread/index.html');
    const result = await page.evaluate(() => {
      const MR = window.__MR__;
      const peptide = 'MAVLKQSTGH'; // 10 residues, arbitrary
      const orf = MR.backtranslate(peptide, MR.ECOLI_CODON);
      const variantCodonStart = 2 * 3; // mutate residue index 2 (0-based) == 'V', protein position 3
      const ctx = {
        orf: orf,
        translation: peptide,
        geneName: 'TESTGENE',
        start: 1,
        end: peptide.length,
        proteinPos: 3,
        variantCodonStart: variantCodonStart,
        table: MR.ECOLI_CODON,
        mutations: [{ refAA: 'V', newAA: 'G', role: 'test', enabled: true }]
      };
      const manifest = MR.buildVerificationManifest(ctx);
      const construct = manifest.constructs[0];
      const totalCodons = Math.floor(orf.length / 3);
      const mutCodonPos1 = variantCodonStart / 3 + 1;

      const coversAllButMutated =
        construct.invariant.length === totalCodons - 1 && construct.invariant.indexOf(mutCodonPos1) === -1;

      // Correct candidate: no violations.
      const okCheck = MR.checkInvariants(construct.expectedOrf, construct, orf);

      // Introduce a silent (synonymous) single-base change at codon position 2, an
      // invariant position: Ala's GCG -> GCA, same amino acid, different nucleotide.
      const tampered = construct.expectedOrf.slice(0, 5) + 'A' + construct.expectedOrf.slice(6);
      const badCheck = MR.checkInvariants(tampered, construct, orf);

      return {
        coversAllButMutated: coversAllButMutated,
        okCheckOk: okCheck.ok,
        badCheckOk: badCheck.ok,
        badViolationCount: badCheck.violations.length
      };
    });

    expect(result.coversAllButMutated).toBe(true);
    expect(result.okCheckOk).toBe(true);
    expect(result.badCheckOk).toBe(false);
    expect(result.badViolationCount).toBeGreaterThan(0);
  });

  test('no horizontal overflow at 1280 and 400 wide, and no console or page errors', async ({ page }) => {
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await mockCommonRoutes(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await resolveTarget(page);
    await page.fill('#variantInput', 'p.Arg200Gly');
    await page.click('#validateBtn');
    await expect(page.locator('#buildBtn')).toBeEnabled();
    await page.click('#buildBtn');
    await expect(page.locator('#outputsBody')).toBeVisible();

    let scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    let viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);

    await page.setViewportSize({ width: 400, height: 900 });
    scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(scrollWidth).toBeLessThanOrEqual(viewportWidth);

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
