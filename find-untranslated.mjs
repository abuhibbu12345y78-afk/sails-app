import fs from 'fs';

const code = fs.readFileSync('src/components/tracker-app.tsx', 'utf8');

// A simple regex to find text inside JSX tags (very naive but can give clues)
const matches = code.match(/>([^<{}]+)</g);

if (matches) {
  const texts = matches
    .map(m => m.slice(1, -1).trim())
    .filter(t => t.length > 2)
    .filter(t => /[a-zA-Z]/.test(t)) // Contains English letters
    .filter(t => !t.startsWith('var(') && !t.includes('ml.')); // Filter out some code

  const unique = [...new Set(texts)];
  console.log("Potential untranslated strings in tracker-app.tsx:");
  console.log(unique.join('\n'));
} else {
  console.log("No matches found.");
}
