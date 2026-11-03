import { STRINGS } from "../src/i18n.js";

const langs = Object.keys(STRINGS);
const base = Object.keys(STRINGS.en).sort();
let missing = 0;
for (const lang of langs) {
  const keys = Object.keys(STRINGS[lang]).sort();
  const absent = base.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !base.includes(k));
  if (absent.length > 0) {
    console.log(`MISSING in ${lang}: ${absent.join(", ")}`);
    missing += absent.length;
  }
  if (extra.length > 0) {
    console.log(`EXTRA in ${lang}: ${extra.join(", ")}`);
  }
}
const total = base.length * langs.length;
console.log(`i18n check: ${langs.join("/")} ${base.length}/${base.length} keys, ${missing} missing.`);
if (missing > 0) process.exit(1);
