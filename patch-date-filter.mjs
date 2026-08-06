import fs from 'fs';

let code = fs.readFileSync('src/components/business-date-filter.tsx', 'utf8');

const replacements = [
  { search: 'label: `Today (${dateStr})`', replace: 'label: `${ml.labels.today} (${dateStr})`' },
  { search: 'label: `Yesterday (${yStr})`', replace: 'label: `${ml.labels.yesterday} (${yStr})`' },
  { search: 'label: `Last 7 Days (${startStr} - ${endStr})`', replace: 'label: `${ml.labels.last7} (${startStr} - ${endStr})`' },
  { search: 'label: `Date: ${dateStr}`', replace: 'label: `${ml.labels.specificDate}: ${dateStr}`' },
  { search: 'label: `Month: ${mStr}`', replace: 'label: `${ml.labels.specificMonth}: ${mStr}`' },
  { search: 'label: `Previous Month (${prevMStr})`', replace: 'label: `${ml.labels.previousMonth} (${prevMStr})`' },
  { search: 'label: `Range: ${from} to ${to}`', replace: 'label: `${ml.labels.customRange}: ${from} to ${to}`' },
  { search: 'label: "All Time"', replace: 'label: ml.labels.allTime' },
];

for (const {search, replace} of replacements) {
  code = code.replace(search, replace);
}

fs.writeFileSync('src/components/business-date-filter.tsx', code);
console.log("Patched business-date-filter.tsx");
