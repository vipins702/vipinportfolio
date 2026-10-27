// Quick verification of font + UI changes
const http = require('http');
function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}
(async () => {
  console.log('=== Font & UI Verification ===\n');

  const html = await get('http://localhost:3000');
  const admin = await get('http://localhost:3000/admin');

  // Font checks
  const checks = [
    ['Inter font loaded (public)', html.includes('Inter')],
    ['Playfair Display loaded (public)', html.includes('Playfair Display')],
    ['No Instrument Serif left (public)', !html.includes('Instrument Serif')],
    ['No Manrope left (public)', !html.includes('Manrope')],
    ['Inter font loaded (admin)', admin.includes('Inter')],
    ['Playfair Display loaded (admin)', admin.includes('Playfair Display')],
    ['No Instrument Serif left (admin)', !admin.includes('Instrument Serif')],
    ['No Manrope left (admin)', !admin.includes('Manrope')],
    // UI enhancements
    ['Nav glassmorphism (backdrop-filter 20px)', html.includes('blur(20px)')],
    ['Service card hover lift', html.includes('translateY(-3px)')],
    ['Metric card hover', html.includes('translateY(-4px)')],
    ['Smooth reveal (cubic-bezier)', html.includes('cubic-bezier(.16,1,.3,1)')],
    ['Hero frame dual glow', html.includes('rgba(227,169,90,.12)')],
    ['Card layered shadow', html.includes('rgba(6,16,30,.04)')],
    // Admin UI
    ['Sidebar gradient', admin.includes('linear-gradient(180deg')],
    ['Stat card hover', admin.includes('.stat:hover')],
    ['Table row hover', admin.includes('tr:hover td')],
    ['Colored status pills', admin.includes('.pill.new{')],
    ['Pill class in dashboard (appts)', admin.includes('pill ${a.status}')],
    ['Pill class in dashboard (leads)', admin.includes('pill ${l.status}')],
    ['Login dual gradient', admin.includes('rgba(227,169,90,.06)')],
  ];

  let pass = 0, fail = 0;
  checks.forEach(([name, ok]) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
    ok ? pass++ : fail++;
  });

  console.log(`\n${pass}/${checks.length} passed${fail ? `, ${fail} FAILED` : ' — all good!'}`);
})();
