import prisma from "../app/db.server";

const EXPECTED_VARIABLES: Record<string, string[]> = {
  'placement_set_generator': ['resolvedFactsJson', 'materialPrimary', 'materialRules', 'scaleGuardrails', 'variantIntentsJson'],
  'composite_instruction': ['productDescription', 'placementInstruction'],
  'product_fact_extractor': ['shopifyProductJson', 'sourceImagesCount'],
};

async function validateTemplates() {
  const definitions = await prisma.promptDefinition.findMany({
    where: { shopId: "SYSTEM" },
    include: {
      versions: {
        where: { status: "ACTIVE" },
        take: 1,
      },
    },
  });

  let hasErrors = false;

  for (const def of definitions) {
    const version = def.versions[0];
    if (!version) continue;

    const template = [version.systemTemplate, version.developerTemplate, version.userTemplate].join(" ");
    const foundVars = template.match(/\{\{([\w.]+)\}\}/g) || [];
    const cleanVars = foundVars.map(v => v.replace(/[\{\}]/g, ''));

    const expected = EXPECTED_VARIABLES[def.name] || [];
    const missing = cleanVars.filter(v => !expected.includes(v));

    if (missing.length > 0) {
      console.error(`❌ ${def.name}: Unknown variables: ${missing.join(", ")}`);
      hasErrors = true;
    } else {
      console.log(`✅ ${def.name}: All variables recognized`);
    }
  }

  process.exit(hasErrors ? 1 : 0);
}

validateTemplates();
